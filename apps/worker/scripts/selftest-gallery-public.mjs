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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-public-"));
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
  for (const name of [
    "0001_init.sql",
    "0005_account_usage.sql",
    "0006_share_passwords.sql",
    "0009_asset_public.sql"
  ]) {
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
    }
  };
}

/* ---------- 4. harness ---------- */
const DB = makeD1();
await applyMigrations({ exec: (sql) => DB._raw.exec(sql) });
const BUCKET = makeR2();
const env = { DB, BUCKET, ENCRYPTION_KEY: "dev-only-encryption-key-0123456789", SESSION_SECRET: "s", APP_ENV: "test" };

const { Hono } = await import("hono");

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

async function req(method, url, body, role, sid) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (role) headers["X-Test-Role"] = role;
  if (sid) headers["X-Test-Sid"] = sid;
  return app.request(url, { method, body, headers }, env);
}

let passed = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  ok  ${name}`);
};
function section(title) {
  console.log(`\n${title}`);
}

async function seedAsset(id, ownerSid, isPublic = 0) {
  await DB.prepare(
    "INSERT INTO assets (id, generation_id, r2_key, thumb_r2_key, mime, width, height, created_at, owner_sid, size_bytes, is_public) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(id, null, `img/${id}`, null, "image/png", 512, 512, "2026-01-01T00:00:00.000Z", ownerSid, 10, isPublic)
    .run();
  await BUCKET.put(`img/${id}`, Uint8Array.from([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
}

/* 身份：A=friend sidA，B=friend sidB，owner=owner。 */
const SID_A = "sid-a";
const SID_B = "sid-b";
const A_ASSET = "asset-a";
const B_ASSET = "asset-b";
const OWNER_ASSET = "asset-owner";
await seedAsset(A_ASSET, SID_A);
await seedAsset(B_ASSET, SID_B);
await seedAsset(OWNER_ASSET, "owner");

/* ================= 1. A 公开自己的图 ================= */
section("1. A 公开自己的图");
{
  const res = await req("POST", `http://localhost/api/gallery/${A_ASSET}/publish`, JSON.stringify({ public: true }), "friend", SID_A);
  check("A publish 200", res.status === 200);
  const body = await res.json();
  check("publish returns is_public true", body.ok === true && body.is_public === true && body.id === A_ASSET);
  const row = await DB.prepare("SELECT is_public FROM assets WHERE id=?").bind(A_ASSET).first();
  check("DB is_public=1", row.is_public === 1);
}

/* ================= 2. B 的 scope=public 能看到，scope=mine 看不到 ================= */
section("2. B 列表分区");
{
  const pub = await req("GET", "http://localhost/api/gallery?scope=public&limit=50", undefined, "friend", SID_B);
  const pubBody = await pub.json();
  check("B scope=public sees A image", pubBody.items.some((i) => i.id === A_ASSET));
  check("B scope=public item carries owner_sid", pubBody.items.find((i) => i.id === A_ASSET)?.owner_sid === SID_A);
  check("B scope=public item carries is_public=true", pubBody.items.find((i) => i.id === A_ASSET)?.is_public === true);
  check("B scope=public excludes private B image", !pubBody.items.some((i) => i.id === B_ASSET));
  check("B scope=public excludes private owner image", !pubBody.items.some((i) => i.id === OWNER_ASSET));

  const mine = await req("GET", "http://localhost/api/gallery?scope=mine&limit=50", undefined, "friend", SID_B);
  const mineBody = await mine.json();
  check("B scope=mine only own", mineBody.items.length === 1 && mineBody.items[0].id === B_ASSET);
  check("B scope=mine total=1", mineBody.total === 1);
  check("B scoped item is_public=false", mineBody.items[0].is_public === false);

  const defaultScope = await req("GET", "http://localhost/api/gallery?limit=50", undefined, "friend", SID_B);
  const defaultBody = await defaultScope.json();
  check("default scope behaves as mine", defaultBody.items.length === 1 && defaultBody.items[0].id === B_ASSET);
}

/* ================= 3. B 可取公开图与 meta ================= */
section("3. B 读取 A 的公开图");
{
  const img = await req("GET", `http://localhost/api/gallery/i/${A_ASSET}`, undefined, "friend", SID_B);
  check("B can fetch A public image 200", img.status === 200);

  const meta = await req("GET", `http://localhost/api/gallery/${A_ASSET}/meta`, undefined, "friend", SID_B);
  check("B can read A public meta 200", meta.status === 200);
  const metaBody = await meta.json();
  check("public meta carries is_public", metaBody.is_public === true);
  check("public meta owner_sid", metaBody.owner_sid === SID_A);

  const privateImg = await req("GET", `http://localhost/api/gallery/i/${B_ASSET}`, undefined, "friend", SID_A);
  check("A cannot fetch B private image 404", privateImg.status === 404);
}

/* ================= 4. B 不能删除 / 取消公开 A 的图 ================= */
section("4. B 对 A 公开图无管理权");
{
  const unpub = await req("POST", `http://localhost/api/gallery/${A_ASSET}/publish`, JSON.stringify({ public: false }), "friend", SID_B);
  check("B cannot unpublish A image 404", unpub.status === 404);
  const still = await DB.prepare("SELECT is_public FROM assets WHERE id=?").bind(A_ASSET).first();
  check("A image still public after B attempt", still.is_public === 1);

  const del = await req("DELETE", `http://localhost/api/gallery/${A_ASSET}`, undefined, "friend", SID_B);
  check("B cannot delete A image 404", del.status === 404);
  const exists = await DB.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").bind(A_ASSET).first();
  check("A image not deleted", exists.c === 1);
}

/* ================= 5. A 取消公开后 B 看不到 ================= */
section("5. A 取消公开");
{
  const res = await req("POST", `http://localhost/api/gallery/${A_ASSET}/publish`, JSON.stringify({ public: false }), "friend", SID_A);
  check("A unpublish 200", res.status === 200);
  const body = await res.json();
  check("unpublish returns is_public false", body.is_public === false);

  const pub = await req("GET", "http://localhost/api/gallery?scope=public&limit=50", undefined, "friend", SID_B);
  const pubBody = await pub.json();
  check("public list no longer has A image", !pubBody.items.some((i) => i.id === A_ASSET));

  const img = await req("GET", `http://localhost/api/gallery/i/${A_ASSET}`, undefined, "friend", SID_B);
  check("B can no longer fetch A private image 404", img.status === 404);
}

/* ================= 6. owner 可管理、可读任意 ================= */
section("6. owner 权限");
{
  const ownerRead = await req("GET", `http://localhost/api/gallery/i/${A_ASSET}`, undefined, "owner", "owner");
  check("owner reads any private image", ownerRead.status === 200);

  const ownerMeta = await req("GET", `http://localhost/api/gallery/${A_ASSET}/meta`, undefined, "owner", "owner");
  check("owner reads any meta", ownerMeta.status === 200);

  const ownerPub = await req("POST", `http://localhost/api/gallery/${A_ASSET}/publish`, JSON.stringify({ public: true }), "owner", "owner");
  check("owner can publish A image", ownerPub.status === 200 && (await ownerPub.json()).is_public === true);

  const ownerUnpub = await req("POST", `http://localhost/api/gallery/${A_ASSET}/publish`, JSON.stringify({ public: false }), "owner", "owner");
  check("owner can unpublish A image", ownerUnpub.status === 200);

  await seedAsset("asset-del-owner", "owner");
  const ownerDel = await req("DELETE", "http://localhost/api/gallery/asset-del-owner", undefined, "owner", "owner");
  check("owner can delete any image", ownerDel.status === 200);
}

/* ================= 7. friend scope=mine 回归 ================= */
section("7. scope=mine 回归");
{
  const aMine = await req("GET", "http://localhost/api/gallery?scope=mine&limit=50", undefined, "friend", SID_A);
  const aBody = await aMine.json();
  check("A scope=mine only own", aBody.items.length === 1 && aBody.items[0].id === A_ASSET);
  check("A scope=mine total=1", aBody.total === 1);

  const ownerAll = await req("GET", "http://localhost/api/gallery?scope=mine&limit=50", undefined, "owner", "owner");
  const ownerBody = await ownerAll.json();
  check("owner scope=mine sees all sids", ownerBody.total >= 3);
}

console.log(`\nselftest-gallery-public: ${passed} checks passed`);
