import { Hono } from "hono";
import {
  createPreset,
  deletePreset,
  ensureBuiltinArtists,
  getPreset,
  isPresetKind,
  listPresets,
  updatePreset,
  type PresetKind
} from "../db/presets";
import { listSharePasswords } from "../db/sharePasswords";
import { readJson } from "../lib/json";
import { requireSession, requireOrigin, requireOwner } from "./guard";
import type { AppEnv } from "../types";

export const presets = new Hono<AppEnv>();

presets.use("*", requireSession);

const OWNER_SID = "owner";

// owner 总览：owner 一行 + 每个分享密码一行，附配方/画师串数量。
presets.get("/overview", requireOwner, async (c) => {
  const shares = await listSharePasswords(c.env);
  const { results } = await c.env.DB.prepare(
    "SELECT owner_sid, kind, COUNT(*) AS c FROM presets GROUP BY owner_sid, kind"
  ).all<{ owner_sid: string; kind: string; c: number }>();

  const counts = new Map<string, { recipe_count: number; artist_count: number }>();
  for (const row of results ?? []) {
    const entry = counts.get(row.owner_sid) ?? { recipe_count: 0, artist_count: 0 };
    if (row.kind === "recipe") entry.recipe_count = row.c ?? 0;
    else if (row.kind === "artist") entry.artist_count = row.c ?? 0;
    counts.set(row.owner_sid, entry);
  }

  const ownerCount = counts.get(OWNER_SID) ?? { recipe_count: 0, artist_count: 0 };
  const items = [
    {
      sid: OWNER_SID,
      label: "所有者",
      role: "owner",
      recipe_count: ownerCount.recipe_count,
      artist_count: ownerCount.artist_count
    },
    ...shares.map((share) => {
      const count = counts.get(share.id) ?? { recipe_count: 0, artist_count: 0 };
      return {
        sid: share.id,
        label: share.label || "未命名",
        role: share.role,
        recipe_count: count.recipe_count,
        artist_count: count.artist_count
      };
    })
  ];
  return c.json({ items });
});

// 列表：默认自己的 sid；owner 可传 sid 查看任一 sid（含 owner）；friend 忽略传入 sid。
presets.get("/", async (c) => {
  const kindRaw = c.req.query("kind");
  if (!isPresetKind(kindRaw)) {
    return c.json({ error: "invalid_kind", message: "kind 必须为 recipe 或 artist" }, 400);
  }
  const kind: PresetKind = kindRaw;

  const role = c.get("role");
  const ownSid = c.get("sid") ?? (role === "owner" ? OWNER_SID : undefined);
  if (!ownSid) return c.json({ error: "unauthorized" }, 401);

  const requestedSid = c.req.query("sid");
  const targetSid = role === "owner" && requestedSid ? requestedSid : ownSid;

  if (kind === "artist") await ensureBuiltinArtists(c.env, targetSid);

  const items = await listPresets(c.env, { sid: targetSid, kind });
  return c.json({ items });
});

// 新建：只能建在自己的 sid 下。
presets.post("/", requireOrigin, async (c) => {
  const body = await readJson<{
    kind?: string;
    name?: string;
    content?: string;
    payload?: Record<string, unknown>;
  }>(c);
  if (!isPresetKind(body.kind)) {
    return c.json({ error: "invalid_kind", message: "kind 必须为 recipe 或 artist" }, 400);
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "invalid_name", message: "名称不能为空" }, 400);

  const role = c.get("role");
  const sid = c.get("sid") ?? (role === "owner" ? OWNER_SID : undefined);
  if (!sid) return c.json({ error: "unauthorized" }, 401);

  const created = await createPreset(c.env, {
    sid,
    kind: body.kind,
    name,
    content: typeof body.content === "string" ? body.content : "",
    payload: body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {}
  });
  return c.json(created, 201);
});

// 修改：只能改自己 sid 的记录（owner 亦不能改他人）。
presets.patch("/:id", requireOrigin, async (c) => {
  const id = c.req.param("id");
  const body = await readJson<{ name?: string; content?: string; payload?: Record<string, unknown> }>(c);

  const role = c.get("role");
  const sid = c.get("sid") ?? (role === "owner" ? OWNER_SID : undefined);
  if (!sid) return c.json({ error: "unauthorized" }, 401);

  const patch: { name?: string; content?: string; payload?: Record<string, unknown> } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return c.json({ error: "invalid_name", message: "名称不能为空" }, 400);
    patch.name = name;
  }
  if (typeof body.content === "string") patch.content = body.content;
  if (body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) {
    patch.payload = body.payload;
  }

  const updated = await updatePreset(c.env, id, sid, patch);
  if (!updated) {
    const exists = await getPreset(c.env, id);
    return exists ? c.json({ error: "forbidden" }, 403) : c.json({ error: "not_found" }, 404);
  }
  return c.json(updated);
});

// 删除：只能删自己 sid 的记录。
presets.delete("/:id", requireOrigin, async (c) => {
  const id = c.req.param("id");
  const role = c.get("role");
  const sid = c.get("sid") ?? (role === "owner" ? OWNER_SID : undefined);
  if (!sid) return c.json({ error: "unauthorized" }, 401);

  const ok = await deletePreset(c.env, id, sid);
  if (!ok) {
    const exists = await getPreset(c.env, id);
    return exists ? c.json({ error: "forbidden" }, 403) : c.json({ error: "not_found" }, 404);
  }
  return c.json({ ok: true });
});
