import { Hono } from "hono";
import {
  createSharePassword,
  deleteSharePassword,
  listSharePasswords,
  updateSharePassword,
  type SharePasswordPatch
} from "../db/sharePasswords";
import { readJson } from "../lib/json";
import { deletePresetsForSid, ensureBuiltinArtists } from "../db/presets";
import { invalidateSid } from "../pool/sessionCheck";
import { requireOrigin, requireOwner } from "./guard";
import type { AppEnv } from "../types";

export const sharePasswords = new Hono<AppEnv>();

sharePasswords.use("*", requireOwner);

interface AssetStat {
  owner_sid: string;
  used_bytes: number;
  count: number;
}

async function assetStats(env: AppEnv["Bindings"]): Promise<Map<string, { used_bytes: number; count: number }>> {
  const { results } = await env.DB.prepare(
    "SELECT owner_sid, COALESCE(SUM(size_bytes),0) AS used_bytes, COUNT(*) AS count FROM assets GROUP BY owner_sid"
  ).all<AssetStat>();
  const map = new Map<string, { used_bytes: number; count: number }>();
  for (const row of results ?? []) {
    map.set(row.owner_sid, { used_bytes: row.used_bytes ?? 0, count: row.count ?? 0 });
  }
  return map;
}

sharePasswords.get("/", async (c) => {
  const [items, stats] = await Promise.all([listSharePasswords(c.env), assetStats(c.env)]);
  // 为尚未种过内置画师串的分享密码补齐一份（幂等）。
  await Promise.all(items.map((item) => ensureBuiltinArtists(c.env, item.id)));
  return c.json({
    items: items.map((item) => {
      const stat = stats.get(item.id);
      return {
        ...item,
        used_bytes: stat?.used_bytes ?? 0,
        count: stat?.count ?? 0
      };
    })
  });
});

sharePasswords.post("/", requireOrigin, async (c) => {
  const body = await readJson<{
    label?: string;
    password?: string;
    quota_bytes?: number;
  }>(c);
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 4) {
    return c.json({ error: "invalid_password", message: "密码至少 4 位" }, 400);
  }
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const quota =
    body.quota_bytes === undefined ? undefined : Number(body.quota_bytes);
  if (quota !== undefined && (!Number.isFinite(quota) || quota < 0)) {
    return c.json({ error: "invalid_quota", message: "配额必须为非负数字" }, 400);
  }
  const created = await createSharePassword(c.env, { label, password, quota_bytes: quota });
  // 新分享密码立即获得一份内置画师串。
  await ensureBuiltinArtists(c.env, created.id);
  return c.json(created, 201);
});

sharePasswords.patch("/:id", requireOrigin, async (c) => {
  const id = c.req.param("id");
  const body = await readJson<SharePasswordPatch>(c);
  if (body.password !== undefined && body.password !== "" && body.password.length < 4) {
    return c.json({ error: "invalid_password", message: "密码至少 4 位" }, 400);
  }
  if (body.quota_bytes !== undefined && (!Number.isFinite(body.quota_bytes) || body.quota_bytes < 0)) {
    return c.json({ error: "invalid_quota", message: "配额必须为非负数字" }, 400);
  }
  const patch: SharePasswordPatch = {};
  if (typeof body.label === "string") patch.label = body.label.trim();
  if (typeof body.password === "string" && body.password !== "") patch.password = body.password;
  if (body.quota_bytes !== undefined) patch.quota_bytes = body.quota_bytes;
  if (body.enabled !== undefined) patch.enabled = body.enabled === true;
  const updated = await updateSharePassword(c.env, id, patch);
  if (!updated) return c.json({ error: "not_found" }, 404);
  // 无论改密码还是改启用状态，都清缓存让其下次重新判定有效性。
  await invalidateSid(c.env, id);
  return c.json(updated);
});

// 删除仅使密码失效：级联清理该 sid 的预设与种子标记，
// 但不删除该画廊图片（既有约定：画廊仍保留，等待 owner 手动清理）。
sharePasswords.delete("/:id", requireOrigin, async (c) => {
  const id = c.req.param("id");
  await deleteSharePassword(c.env, id);
  await deletePresetsForSid(c.env, id);
  await invalidateSid(c.env, id);
  return c.json({ ok: true });
});
