import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, "..", "src");

/* ---------- 1. esbuild bundle ---------- */
async function loadEsbuild() {
  const require = createRequire(import.meta.url);
  const pnpmDir = path.join(here, "..", "..", "..", "node_modules", ".pnpm");
  const entries = await readdir(pnpmDir);
  const dir = entries.filter((e) => e.startsWith("esbuild@")).sort().pop();
  assert.ok(dir, "esbuild not found under node_modules/.pnpm");
  return require(path.join(pnpmDir, dir, "node_modules", "esbuild"));
}

const esbuild = await loadEsbuild();
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-thumb-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(entry, `export { gallery } from "${abs("routes/gallery.ts")}";`);
const bundle = path.join(tmp, "bundle.mjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundle,
  logLevel: "silent"
});
const mod = await import(pathToFileURL(bundle).href);

/* ---------- 2. node:sqlite-backed D1 stub ---------- */
class D1Stmt {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }
  bind(...params) {
    this.params = params.map((p) => (p === undefined ? null : p));
    return this;
  }
  _rows() {
    return this.db.prepare(this.sql).all(...this.params);
  }
  async all() {
    return { results: this._rows(), success: true };
  }
  async first() {
    return this._rows()[0] ?? null;
  }
  async run() {
    const meta = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta };
  }
}

function makeD1() {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => new D1Stmt(db, sql),
    _raw: db
  };
}

async function applyMigrations(db) {
  for (const name of ["0001_init.sql", "0006_share_passwords.sql", "0009_asset_public.sql"]) {
    const sql = await readFile(path.join(here, "..", "migrations", name), "utf8");
    db.exec(sql);
  }
}

/* ---------- 3. R2 stub ---------- */
function makeR2() {
  const objects = new Map();
  return {
    async put(key, value, opts = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      objects.set(key, { bytes, contentType: opts?.httpMetadata?.contentType ?? "application/octet-stream" });
    },
    async get(key) {
      const obj = objects.get(key);
      if (!obj) return null;
      return {
        body: obj.bytes,
        httpEtag: `"${key}"`,
        writeHttpMetadata(headers) {
          headers.set("Content-Type", obj.contentType);
        }
      };
    },
    async delete(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) objects.delete(key);
    },
    async list({ prefix = "", cursor } = {}) {
      void cursor;
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { objects: all.map((key) => ({ key })), truncated: false, cursor: undefined };
    },
    _get: (key) => objects.get(key)
  };
}

/* ---------- 4. harness ---------- */
const { Hono } = await import("hono");

const DB = makeD1();
await applyMigrations({ exec: (sql) => DB._raw.exec(sql) });
const BUCKET = makeR2();
const env = { DB, BUCKET, ENCRYPTION_KEY: "dev-only-encryption-key-0123456789", SESSION_SECRET: "s", APP_ENV: "test" };

function sessionMiddleware(c, next) {
  const role = c.req.header("X-Test-Role");
  if (role) c.set("role", role);
  const sid = c.req.header("X-Test-Sid");
  if (sid) c.set("sid", sid);
  return next();
}

const app = new Hono();
app.use("*", sessionMiddleware);
app.route("/api/gallery", mod.gallery);

async function req(method, url, body, headers = {}) {
  return app.request(url, { method, body, headers }, env);
}
function jsonHeaders(role, sid = null, extra = {}) {
  const h = { "Content-Type": "application/json", "X-Test-Role": role, ...extra };
  if (sid) h["X-Test-Sid"] = sid;
  return h;
}
function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

const SID_A = "sid-a";
const SID_B = "sid-b";

async function seedAsset(id, ownerSid, sizeBytes = 10) {
  await DB.prepare(
    "INSERT INTO assets (id, generation_id, r2_key, thumb_r2_key, mime, width, height, created_at, owner_sid, size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(id, null, `img/${id}`, null, "image/png", 512, 512, "2026-01-01T00:00:00.000Z", ownerSid, sizeBytes)
    .run();
  await BUCKET.put(`img/${id}`, Uint8Array.from([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
}

const ASSET = "asset-thumb";
await seedAsset(ASSET, "owner", 10);

let passed = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  ok  ${name}`);
};
function section(title) {
  console.log(`\n${title}`);
}

/* ================= 1. 首次上传 ================= */
section("1. 首次上传缩略图");
{
  const v1 = "thumb-1";
  const res = await req(
    "POST",
    `http://localhost/api/gallery/${ASSET}/thumb`,
    JSON.stringify({ image: b64(v1), mime: "image/webp" }),
    jsonHeaders("owner", "owner")
  );
  check("首次上传 200", res.status === 200);
  const body = await res.json();
  check("返回 ok + id + thumb_url", body.ok === true && body.id === ASSET && body.thumb_url === `/api/gallery/i/${ASSET}?t=thumb`);

  const row = await DB.prepare("SELECT size_bytes, thumb_r2_key FROM assets WHERE id=?").bind(ASSET).first();
  check("thumb_r2_key 已写入", row.thumb_r2_key === `thumb/${ASSET}`);
  check("size_bytes 已累加", row.size_bytes === 10 + Buffer.byteLength(v1));

  const obj = BUCKET._get(`thumb/${ASSET}`);
  check("R2 存有缩略图对象", !!obj && obj.bytes.length === Buffer.byteLength(v1));
  check("R2 content-type 为 image/webp", obj?.contentType === "image/webp");
}

/* ================= 2. 再次上传（无 force）幂等 ================= */
section("2. 重复上传（无 force）幂等");
{
  const before = await DB.prepare("SELECT size_bytes FROM assets WHERE id=?").bind(ASSET).first();
  const v2 = "thumb-2-much-longer-bytes";
  const res = await req(
    "POST",
    `http://localhost/api/gallery/${ASSET}/thumb`,
    JSON.stringify({ image: b64(v2), mime: "image/jpeg" }),
    jsonHeaders("owner", "owner")
  );
  check("重复上传仍返回 200", res.status === 200);
  const body = await res.json();
  check("重复上传返回 ok + thumb_url", body.ok === true && body.thumb_url === `/api/gallery/i/${ASSET}?t=thumb`);

  const after = await DB.prepare("SELECT size_bytes, thumb_r2_key FROM assets WHERE id=?").bind(ASSET).first();
  check("size_bytes 未再次累加", after.size_bytes === before.size_bytes);
  check("thumb_r2_key 保持不变", after.thumb_r2_key === `thumb/${ASSET}`);

  const obj = BUCKET._get(`thumb/${ASSET}`);
  check("R2 对象未被覆盖", Buffer.from(obj?.bytes ?? []).toString() === "thumb-1");
}

/* ================= 3. force=1 覆盖 ================= */
section("3. force=1 强制覆盖");
{
  const before = await DB.prepare("SELECT size_bytes FROM assets WHERE id=?").bind(ASSET).first();
  const v3 = "thumb-3";
  const res = await req(
    "POST",
    `http://localhost/api/gallery/${ASSET}/thumb?force=1`,
    JSON.stringify({ image: b64(v3), mime: "image/webp" }),
    jsonHeaders("owner", "owner")
  );
  check("force 上传 200", res.status === 200);

  const after = await DB.prepare("SELECT size_bytes FROM assets WHERE id=?").bind(ASSET).first();
  check("force 会再次累加 size_bytes", after.size_bytes === before.size_bytes + Buffer.byteLength(v3));

  const obj = BUCKET._get(`thumb/${ASSET}`);
  check("R2 对象被覆盖为新内容", Buffer.from(obj?.bytes ?? []).toString() === v3);
}

/* ================= 4. 归属校验 ================= */
section("4. 归属校验");
{
  await seedAsset("asset-a", SID_A, 5);
  const cross = await req(
    "POST",
    `http://localhost/api/gallery/${ASSET}/thumb`,
    JSON.stringify({ image: b64("x"), mime: "image/webp" }),
    jsonHeaders("friend", SID_A)
  );
  check("friend 不能给他人图片传缩略图（404）", cross.status === 404);
  const ownerRow = await DB.prepare("SELECT thumb_r2_key FROM assets WHERE id=?").bind(ASSET).first();
  check("他人尝试未改写 thumb_r2_key", ownerRow.thumb_r2_key === `thumb/${ASSET}`);

  const own = await req(
    "POST",
    `http://localhost/api/gallery/asset-a/thumb`,
    JSON.stringify({ image: b64("own-thumb"), mime: "image/webp" }),
    jsonHeaders("friend", SID_A)
  );
  check("friend 可给自己图片传缩略图 200", own.status === 200);
  const ownRow = await DB.prepare("SELECT thumb_r2_key FROM assets WHERE id=?").bind("asset-a").first();
  check("自己图片 thumb_r2_key 已写入", ownRow.thumb_r2_key === "thumb/asset-a");

  const anon = await req(
    "POST",
    `http://localhost/api/gallery/${ASSET}/thumb`,
    JSON.stringify({ image: b64("x"), mime: "image/webp" })
  );
  check("匿名上传 401", anon.status === 401);

  const missing = await req(
    "POST",
    "http://localhost/api/gallery/nope/thumb",
    JSON.stringify({ image: b64("x"), mime: "image/webp" }),
    jsonHeaders("owner", "owner")
  );
  check("不存在图片 404", missing.status === 404);
}

/* ================= 5. 空 body / 原始二进制 ================= */
section("5. 输入形态");
{
  const empty = await req(
    "POST",
    `http://localhost/api/gallery/asset-a/thumb?force=1`,
    JSON.stringify({ mime: "image/webp" }),
    jsonHeaders("friend", SID_A)
  );
  check("空 body 400", empty.status === 400);

  const raw = await req(
    "POST",
    `http://localhost/api/gallery/asset-a/thumb?force=1`,
    Uint8Array.from([9, 8, 7, 6]),
    { "Content-Type": "image/webp", "X-Test-Role": "friend", "X-Test-Sid": SID_A }
  );
  check("原始二进制上传 200", raw.status === 200);
  const obj = BUCKET._get("thumb/asset-a");
  check("原始二进制落 R2", !!obj && obj.bytes.length === 4 && obj.contentType === "image/webp");
}

console.log(`\nselftest-gallery-thumb: ${passed} checks passed`);
