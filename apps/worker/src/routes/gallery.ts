import { Hono } from "hono";
import { readJson } from "../lib/json";
import { requireSession, requireOrigin, requireOwner } from "./guard";
import { listSharePasswords } from "../db/sharePasswords";
import type { AppEnv } from "../types";

export const gallery = new Hono<AppEnv>();

gallery.use("*", requireSession);

const PAGE_MAX = 60;
const DEFAULT_LIMIT = 24;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const OWNER_SID = "owner";

interface AssetRow {
  id: string;
  generation_id: string | null;
  r2_key: string;
  thumb_r2_key: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  owner_sid: string;
  size_bytes: number;
  created_at: string;
}

function assetUrl(id: string, thumb: boolean): string {
  return `/api/gallery/i/${id}${thumb ? "?t=thumb" : ""}`;
}

function clampLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), PAGE_MAX);
}

function clampOffset(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// friend 只能访问自己 sid 的资源；owner 任意。
function canAccess(c: import("hono").Context<AppEnv>, row: AssetRow): boolean {
  if (c.get("role") === "owner") return true;
  return row.owner_sid === c.get("sid");
}

async function deleteByPrefix(env: AppEnv["Bindings"], prefix: string): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const list = await env.BUCKET.list({ prefix, cursor });
    if (list.objects.length) {
      await env.BUCKET.delete(list.objects.map((obj) => obj.key));
      deleted += list.objects.length;
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return deleted;
}

async function deleteAssetKeys(env: AppEnv["Bindings"], keys: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    if (!chunk.length) continue;
    await env.BUCKET.delete(chunk);
    deleted += chunk.length;
  }
  return deleted;
}

gallery.get("/", async (c) => {
  const limit = clampLimit(c.req.query("limit"));
  const offset = clampOffset(c.req.query("offset"));
  const role = c.get("role");
  const sid = c.get("sid");

  let where = "";
  let params: unknown[] = [];
  if (role === "owner") {
    const filterSid = c.req.query("sid");
    if (filterSid) {
      where = "WHERE owner_sid=?";
      params = [filterSid];
    }
  } else {
    where = "WHERE owner_sid=?";
    params = [sid ?? ""];
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM assets ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all<AssetRow>();
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM assets ${where}`)
    .bind(...params)
    .first<{ c: number }>();
  const items = (results ?? []).map((row) => ({
    id: row.id,
    generation_id: row.generation_id,
    mime: row.mime,
    width: row.width,
    height: row.height,
    owner_sid: row.owner_sid,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    url: assetUrl(row.id, false),
    thumb_url: row.thumb_r2_key ? assetUrl(row.id, true) : null
  }));
  return c.json({ items, total: totalRow?.c ?? items.length, limit, offset });
});

// owner 总览：owner 一行 + 每个分享密码一行。
gallery.get("/overview", requireOwner, async (c) => {
  const shares = await listSharePasswords(c.env);
  const { results } = await c.env.DB.prepare(
    "SELECT owner_sid, COALESCE(SUM(size_bytes),0) AS used_bytes, COUNT(*) AS count FROM assets GROUP BY owner_sid"
  ).all<{ owner_sid: string; used_bytes: number; count: number }>();
  const stats = new Map<string, { used_bytes: number; count: number }>();
  for (const row of results ?? []) {
    stats.set(row.owner_sid, { used_bytes: row.used_bytes ?? 0, count: row.count ?? 0 });
  }
  const ownerStat = stats.get(OWNER_SID);
  const items = [
    {
      sid: OWNER_SID,
      label: "所有者",
      role: "owner",
      quota_bytes: null as number | null,
      used_bytes: ownerStat?.used_bytes ?? 0,
      count: ownerStat?.count ?? 0
    },
    ...shares.map((share) => {
      const stat = stats.get(share.id);
      return {
        sid: share.id,
        label: share.label || "未命名",
        role: share.role,
        quota_bytes: share.quota_bytes as number | null,
        used_bytes: stat?.used_bytes ?? 0,
        count: stat?.count ?? 0
      };
    })
  ];
  return c.json({ items });
});

gallery.get("/i/:id", async (c) => {
  const id = c.req.param("id");
  const kind = c.req.query("t") === "thumb" ? "thumb" : "img";
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(id).first<AssetRow>();
  if (!row || !canAccess(c, row)) return c.json({ error: "not_found" }, 404);
  const key = kind === "thumb" ? row.thumb_r2_key : row.r2_key;
  if (!key) return c.json({ error: "not_found" }, 404);
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", row.mime ?? "application/octet-stream");
  headers.set("Cache-Control", IMMUTABLE_CACHE);
  headers.set("ETag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

gallery.post("/:id/thumb", requireOrigin, async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(id).first<AssetRow>();
  if (!row || !canAccess(c, row)) return c.json({ error: "not_found" }, 404);

  const contentType = c.req.header("Content-Type") ?? "";
  let bytes: Uint8Array | null = null;
  let mime = "image/webp";
  if (contentType.includes("application/json")) {
    const body = await readJson<{ image?: string; mime?: string }>(c);
    if (body.image) {
      const comma = body.image.indexOf(",");
      const b64 = body.image.startsWith("data:") && comma >= 0 ? body.image.slice(comma + 1) : body.image;
      mime = body.mime ?? "image/webp";
      bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      if (body.image.startsWith("data:")) {
        const meta = body.image.slice(5, comma);
        const parsed = meta.split(";")[0]!;
        if (parsed.startsWith("image/")) mime = parsed;
      }
    }
  } else {
    bytes = new Uint8Array(await c.req.arrayBuffer());
  }
  if (!bytes || !bytes.byteLength) return c.json({ error: "empty_body" }, 400);

  const thumbKey = `thumb/${id}`;
  await c.env.BUCKET.put(thumbKey, bytes, { httpMetadata: { contentType: mime } });
  await c.env.DB.prepare(
    "UPDATE assets SET thumb_r2_key=?, mime=COALESCE(mime, ?), size_bytes=size_bytes+? WHERE id=?"
  )
    .bind(thumbKey, mime, bytes.byteLength, id)
    .run();
  return c.json({ ok: true, id, thumb_url: assetUrl(id, true) });
});

gallery.delete("/:id", requireOrigin, async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(id).first<AssetRow>();
  if (!row || !canAccess(c, row)) return c.json({ error: "not_found" }, 404);
  const keys = [row.r2_key];
  if (row.thumb_r2_key) keys.push(row.thumb_r2_key);
  await c.env.BUCKET.delete(keys);
  await c.env.DB.prepare("DELETE FROM assets WHERE id=?").bind(id).run();
  if (row.generation_id) {
    const remaining = await c.env.DB.prepare(
      "SELECT COUNT(*) AS c FROM assets WHERE generation_id=?"
    )
      .bind(row.generation_id)
      .first<{ c: number }>();
    if (!remaining?.c) {
      await c.env.DB.prepare("DELETE FROM generations WHERE id=?").bind(row.generation_id).run();
    }
  }
  return c.json({ ok: true, id });
});

gallery.post("/clear", requireOrigin, async (c) => {
  const body = await readJson<{ confirm?: boolean; sid?: string }>(c);
  if (body.confirm !== true) return c.json({ error: "confirm_required" }, 400);

  const role = c.get("role");
  let targetSid: string | undefined;
  if (role === "owner") {
    targetSid = body.sid;
  } else {
    targetSid = c.get("sid");
  }

  if (targetSid) {
    const { results } = await c.env.DB.prepare(
      "SELECT r2_key, thumb_r2_key FROM assets WHERE owner_sid=?"
    )
      .bind(targetSid)
      .all<{ r2_key: string; thumb_r2_key: string | null }>();
    const keys: string[] = [];
    for (const row of results ?? []) {
      keys.push(row.r2_key);
      if (row.thumb_r2_key) keys.push(row.thumb_r2_key);
    }
    const deleted = await deleteAssetKeys(c.env, keys);
    await c.env.DB.prepare("DELETE FROM assets WHERE owner_sid=?").bind(targetSid).run();
    await c.env.DB.prepare("DELETE FROM generations WHERE owner_sid=?").bind(targetSid).run();
    return c.json({ ok: true, sid: targetSid, deleted_objects: deleted });
  }

  const images = await deleteByPrefix(c.env, "img/");
  const thumbs = await deleteByPrefix(c.env, "thumb/");
  await c.env.DB.prepare("DELETE FROM assets").run();
  await c.env.DB.prepare("DELETE FROM generations").run();
  return c.json({ ok: true, deleted_images: images, deleted_thumbs: thumbs });
});
