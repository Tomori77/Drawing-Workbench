import { Hono } from "hono";
import { readJson } from "../lib/json";
import { requireSession, requireOrigin } from "./guard";
import type { AppEnv } from "../types";

export const gallery = new Hono<AppEnv>();

gallery.use("*", requireSession);

const PAGE_MAX = 60;
const DEFAULT_LIMIT = 24;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

interface AssetRow {
  id: string;
  generation_id: string | null;
  r2_key: string;
  thumb_r2_key: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
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

gallery.get("/", async (c) => {
  const limit = clampLimit(c.req.query("limit"));
  const offset = clampOffset(c.req.query("offset"));
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM assets ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?"
  )
    .bind(limit, offset)
    .all<AssetRow>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS c FROM assets").first<{ c: number }>();
  const items = (results ?? []).map((row) => ({
    id: row.id,
    generation_id: row.generation_id,
    mime: row.mime,
    width: row.width,
    height: row.height,
    created_at: row.created_at,
    url: assetUrl(row.id, false),
    thumb_url: row.thumb_r2_key ? assetUrl(row.id, true) : null
  }));
  return c.json({ items, total: total?.c ?? items.length, limit, offset });
});

gallery.get("/i/:id", async (c) => {
  const id = c.req.param("id");
  const kind = c.req.query("t") === "thumb" ? "thumb" : "img";
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(id).first<AssetRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
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
  if (!row) return c.json({ error: "not_found" }, 404);

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
  await c.env.DB.prepare("UPDATE assets SET thumb_r2_key=?, mime=COALESCE(mime, ?) WHERE id=?")
    .bind(thumbKey, mime, id)
    .run();
  return c.json({ ok: true, id, thumb_url: assetUrl(id, true) });
});

gallery.delete("/:id", requireOrigin, async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(id).first<AssetRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
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
  const body = await readJson<{ confirm?: boolean }>(c);
  if (body.confirm !== true) return c.json({ error: "confirm_required" }, 400);
  const images = await deleteByPrefix(c.env, "img/");
  const thumbs = await deleteByPrefix(c.env, "thumb/");
  await c.env.DB.prepare("DELETE FROM assets").run();
  await c.env.DB.prepare("DELETE FROM generations").run();
  return c.json({ ok: true, deleted_images: images, deleted_thumbs: thumbs });
});
