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

interface GenerationRow {
  id: string;
  role: string | null;
  upstream_id: string | null;
  account_id: string | null;
  params_json: string | null;
  cost_gems: number | null;
  created_at: string | null;
}

interface ParsedParams {
  model: string | null;
  action: string | null;
  positive: string;
  negative: string;
  n: number | null;
  params: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// 兼容新格式（完整 canonical：{model,action,prompt,params,references,n}）
// 与旧格式（仅扁平 params，可能内含 negative_prompt）。
function parseParamsJson(raw: string | null): ParsedParams {
  let data: Record<string, unknown> = {};
  try {
    data = asRecord(JSON.parse(raw ?? "{}")) ?? {};
  } catch {
    data = {};
  }

  const prompt = asRecord(data.prompt);
  const isCanonical = prompt !== null || typeof data.model === "string" || typeof data.action === "string";

  if (isCanonical) {
    const params = asRecord(data.params) ?? {};
    return {
      model: typeof data.model === "string" ? data.model : null,
      action: typeof data.action === "string" ? data.action : null,
      positive: prompt && typeof prompt.positive === "string" ? prompt.positive : "",
      negative: prompt && typeof prompt.negative === "string" ? prompt.negative : "",
      n: numberOrNull(data.n),
      params
    };
  }

  // 旧格式：整对象即参数集合，positive 无从得知，negative 取自 negative_prompt。
  return {
    model: null,
    action: null,
    positive: "",
    negative: typeof data.negative_prompt === "string" ? data.negative_prompt : "",
    n: numberOrNull(data.n_samples),
    params: data
  };
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

// owner 总览：owner 一行 + 每个分享密码一行，附图片用量与配方/画师串数量。
gallery.get("/overview", requireOwner, async (c) => {
  const shares = await listSharePasswords(c.env);
  const [assetRes, presetRes] = await Promise.all([
    c.env.DB.prepare(
      "SELECT owner_sid, COALESCE(SUM(size_bytes),0) AS used_bytes, COUNT(*) AS count FROM assets GROUP BY owner_sid"
    ).all<{ owner_sid: string; used_bytes: number; count: number }>(),
    c.env.DB.prepare(
      "SELECT owner_sid, kind, COUNT(*) AS c FROM presets GROUP BY owner_sid, kind"
    ).all<{ owner_sid: string; kind: string; c: number }>()
  ]);
  const stats = new Map<string, { used_bytes: number; count: number }>();
  for (const row of assetRes.results ?? []) {
    stats.set(row.owner_sid, { used_bytes: row.used_bytes ?? 0, count: row.count ?? 0 });
  }
  const presetCounts = new Map<string, { recipe_count: number; artist_count: number }>();
  for (const row of presetRes.results ?? []) {
    const entry = presetCounts.get(row.owner_sid) ?? { recipe_count: 0, artist_count: 0 };
    if (row.kind === "recipe") entry.recipe_count = row.c ?? 0;
    else if (row.kind === "artist") entry.artist_count = row.c ?? 0;
    presetCounts.set(row.owner_sid, entry);
  }
  const ownerStat = stats.get(OWNER_SID);
  const ownerPresets = presetCounts.get(OWNER_SID) ?? { recipe_count: 0, artist_count: 0 };
  const items = [
    {
      sid: OWNER_SID,
      label: "所有者",
      role: "owner",
      quota_bytes: null as number | null,
      used_bytes: ownerStat?.used_bytes ?? 0,
      count: ownerStat?.count ?? 0,
      recipe_count: ownerPresets.recipe_count,
      artist_count: ownerPresets.artist_count
    },
    ...shares.map((share) => {
      const stat = stats.get(share.id);
      const preset = presetCounts.get(share.id) ?? { recipe_count: 0, artist_count: 0 };
      return {
        sid: share.id,
        label: share.label || "未命名",
        role: share.role,
        quota_bytes: share.quota_bytes as number | null,
        used_bytes: stat?.used_bytes ?? 0,
        count: stat?.count ?? 0,
        recipe_count: preset.recipe_count,
        artist_count: preset.artist_count
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

// 单图信息：合并 assets 与关联 generations，供画廊「图片信息 / 复现」使用。
gallery.get("/:id/meta", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id=?").bind(id).first<AssetRow>();
  if (!row || !canAccess(c, row)) return c.json({ error: "not_found" }, 404);

  let generation: GenerationRow | null = null;
  if (row.generation_id) {
    generation = await c.env.DB.prepare("SELECT id, role, upstream_id, account_id, params_json, cost_gems, created_at FROM generations WHERE id=?")
      .bind(row.generation_id)
      .first<GenerationRow>();
  }

  const parsed = parseParamsJson(generation?.params_json ?? null);
  const width =
    row.width ?? numberOrNull(parsed.params.width) ?? null;
  const height =
    row.height ?? numberOrNull(parsed.params.height) ?? null;

  return c.json({
    id: row.id,
    generation_id: row.generation_id,
    owner_sid: row.owner_sid,
    mime: row.mime,
    width,
    height,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    url: assetUrl(row.id, false),
    thumb_url: row.thumb_r2_key ? assetUrl(row.id, true) : null,
    upstream_id: generation?.upstream_id ?? null,
    model: parsed.model,
    action: parsed.action,
    prompt: { positive: parsed.positive, negative: parsed.negative },
    n: parsed.n,
    params: parsed.params,
    cost_gems: generation?.cost_gems ?? null,
    role: generation?.role ?? null
  });
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
