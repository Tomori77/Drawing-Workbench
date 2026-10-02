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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-apikeys-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { keys } from "${abs("routes/keys.ts")}";`,
    `export { createApiKey, getApiKey, getApiKeyPlaintext } from "${abs("db/apiKeys.ts")}";`,
    `export { decrypt } from "${abs("lib/crypto.ts")}";`
  ].join("\n")
);
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
const { Hono } = await import("hono");

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
  for (const name of ["0001_init.sql", "0002_gateway.sql", "0008_api_key_plaintext.sql"]) {
    const sql = await readFile(path.join(here, "..", "migrations", name), "utf8");
    db.exec(sql);
  }
}

const DB = makeD1();
await applyMigrations({ exec: (sql) => DB._raw.exec(sql) });
const ENCRYPTION_KEY = "dev-only-encryption-key-0123456789";
const env = { DB, ENCRYPTION_KEY, SESSION_SECRET: "s", APP_ENV: "test" };

/* ---------- 3. app + 身份注入 ---------- */
async function testSession(c, next) {
  const role = c.req.header("X-Test-Role");
  if (role) c.set("role", role);
  return next();
}

const app = new Hono();
app.use("*", testSession);
app.route("/api/keys", mod.keys);

async function req(method, url, body, role = "owner") {
  const headers = { "Content-Type": "application/json" };
  if (role) headers["X-Test-Role"] = role;
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

/* ================= 1. 创建即双写 key_hash + key_enc ================= */
section("1. createApiKey 同时写入 key_hash 与 key_enc");
{
  const created = await mod.createApiKey(env, { name: "双写" });
  const row = await mod.getApiKey(env, created.record.id);
  check("created.key 为明文 dwb- 前缀", created.key.startsWith("dwb-"));
  check("key_hash 有值且等于明文 SHA-256（非明文）", row.key_hash.length === 64 && row.key_hash !== created.key);
  check("key_enc 有值", typeof row.key_enc === "string" && row.key_enc.length > 0);
  check("key_enc 以 enc:v1: 开头", row.key_enc.startsWith("enc:v1:"));
  const decrypted = await mod.decrypt(row.key_enc, ENCRYPTION_KEY, "apikeys");
  check("key_enc 解密等于明文", decrypted === created.key);
  const again = await mod.getApiKeyPlaintext(env, row);
  check("getApiKeyPlaintext 返回明文", again === created.key);
}

/* ================= 2. GET /api/keys 附带明文 ================= */
section("2. GET /api/keys 返回 key 明文；旧行返回 null");
{
  const fresh = await mod.createApiKey(env, { name: "新行" });
  // 旧数据模拟：直接插入一条 key_enc=NULL 的行（仅 key_hash）。
  await DB.prepare(
    "INSERT INTO api_keys (id, key_hash, key_enc, name, role, mode, policy_json, allowed_models_json, allowed_upstreams_json, quota, used_count, rate_limit, expires_at, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind("legacy-row", "legacy-hash", null, "旧行", "friend", "restricted", "{}", "[]", "[]", null, 0, null, null, 1, "2020-01-01T00:00:00.000Z")
    .run();

  const res = await req("GET", "http://localhost/api/keys");
  check("GET /api/keys 200（owner）", res.status === 200);
  const body = await res.json();
  const freshItem = body.items.find((i) => i.id === fresh.record.id);
  const legacyItem = body.items.find((i) => i.id === "legacy-row");
  check("新行 key 等于明文", freshItem && freshItem.key === fresh.key);
  check("旧行 key 为 null", legacyItem && legacyItem.key === null);

  const one = await req("GET", `http://localhost/api/keys/${fresh.record.id}`);
  check("GET /api/keys/:id 200（owner）", one.status === 200);
  const oneBody = await one.json();
  check("GET /api/keys/:id key 等于明文", oneBody.key === fresh.key);
}

/* ================= 3. 非 owner 403 ================= */
section("3. 非 owner 访问被拒 403");
{
  const list = await req("GET", "http://localhost/api/keys", undefined, "friend");
  check("friend GET /api/keys -> 403", list.status === 403);
  const one = await req("GET", "http://localhost/api/keys/legacy-row", undefined, "friend");
  check("friend GET /api/keys/:id -> 403", one.status === 403);
  const none = await req("GET", "http://localhost/api/keys", undefined, null);
  check("无身份 GET /api/keys -> 403", none.status === 403);
}

/* ================= 4. POST 创建返回一次性明文 ================= */
section("4. POST /api/keys 返回明文");
{
  const res = await req("POST", "http://localhost/api/keys", JSON.stringify({ name: "POST 行" }));
  check("POST /api/keys 201", res.status === 201);
  const body = await res.json();
  check("POST 返回 key 明文", typeof body.key === "string" && body.key.startsWith("dwb-"));
  const row = await mod.getApiKey(env, body.id);
  const decrypted = await mod.decrypt(row.key_enc, ENCRYPTION_KEY, "apikeys");
  check("POST 后 key_enc 解密等于返回明文", decrypted === body.key);
}

console.log(`\nselftest-apikeys-plaintext: ${passed} checks passed`);
