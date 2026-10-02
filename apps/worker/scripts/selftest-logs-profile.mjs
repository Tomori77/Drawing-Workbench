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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-logs-profile-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { logs } from "${abs("routes/logs.ts")}";`,
    `export { profile } from "${abs("routes/profile.ts")}";`,
    `export { getProfile, updateProfile } from "${abs("db/profile.ts")}";`
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

/* ---------- 2. node:sqlite D1 stub ---------- */
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

const MIGRATIONS = ["0001_init.sql", "0002_gateway.sql", "0003_checkin.sql", "0004_profile.sql", "0005_account_usage.sql"];
async function applyMigrations(db) {
  for (const name of MIGRATIONS) {
    const sql = await readFile(path.join(here, "..", "migrations", name), "utf8");
    db.exec(sql);
  }
}

const DB = makeD1();
await applyMigrations(DB);
const env = { DB, APP_ENV: "test", APP_VERSION: "9.9.9-test" };

/* ---------- 3. Hono app with a fixed owner role ---------- */
const { Hono } = await import("hono");
const app = new Hono();
app.use("*", async (c, next) => {
  c.set("role", "owner");
  await next();
});
app.route("/api/logs", mod.logs);
app.route("/api/profile", mod.profile);

async function req(method, url, body) {
  return app.request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers:
      body === undefined
        ? { host: "dw.test" }
        : { "Content-Type": "application/json", host: "dw.test" }
  }, env);
}

/* ---------- 4. seed ---------- */
await DB.prepare(
  "INSERT INTO upstreams (id, name, type, base_url, models_json, capabilities_json, transform_json, priority, weight, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
)
  .bind("up-1", "seed", "nai-compatible", "https://seed.example", "[]", "{}", "{}", 1, 1, 1, "2026-01-01T00:00:00.000Z")
  .run();
await DB.prepare(
  "INSERT INTO api_keys (id, key_hash, name, role, mode, policy_json, allowed_models_json, allowed_upstreams_json, quota, used_count, rate_limit, expires_at, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
)
  .bind("key-1", "hash-1", "网关密钥甲", "friend", "restricted", "{}", "[]", "[]", null, 0, null, null, 1, "2026-01-01T00:00:00.000Z")
  .run();
await DB.prepare(
  "INSERT INTO accounts (id, upstream_id, label, username, credential_enc, gems_last, enabled, status, failure_count, cooldown_until, last_success_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
)
  .bind("acc-1", "up-1", "账号甲", "user-a", null, null, 1, "active", 0, null, null, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
  .run();

async function insertLog({ requestId, gatewayKeyId, accountId, path, mode, status, ok, createdAt }) {
  await DB.prepare(
    "INSERT INTO request_logs (request_id, gateway_key_id, account_id, path, mode, status_code, ok, duration_ms, bytes_in, bytes_out, cost_gems, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(requestId, gatewayKeyId, accountId, path, mode, status, ok ? 1 : 0, 120, null, 2048, ok ? 2 : 0, createdAt)
    .run();
}

await insertLog({ requestId: "r-gw-ok", gatewayKeyId: "key-1", accountId: "acc-1", path: "/v1/nai/generate-image", mode: "restricted", status: 200, ok: true, createdAt: "2026-02-03T10:00:00.000Z" });
await insertLog({ requestId: "r-gw-fail", gatewayKeyId: "key-1", accountId: "acc-1", path: "/v1/nai/generate-image", mode: "restricted", status: 502, ok: false, createdAt: "2026-02-03T11:00:00.000Z" });
await insertLog({ requestId: "r-wb-ok", gatewayKeyId: null, accountId: "acc-1", path: "/v1/nai/generate-image", mode: "restricted", status: 200, ok: true, createdAt: "2026-02-03T12:00:00.000Z" });

await DB.prepare(
  "INSERT INTO request_attempts (request_id, gateway_key_id, account_id, attempt_no, status_code, error, created_at) VALUES (?,?,?,?,?,?,?)"
)
  .bind("r-gw-fail", "key-1", "acc-1", 1, 502, "upstream_error_seed", "2026-02-03T11:00:01.000Z")
  .run();

/* ---------- 5. assertions ---------- */
let passed = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  ok  ${name}`);
};
function section(title) {
  console.log(`\n${title}`);
}

/* ================= 1. logs 分类与 counts ================= */
section("1. logs source classification + counts");
{
  const res = await req("GET", "http://localhost/api/logs");
  check("GET /api/logs -> 200", res.status === 200);
  const body = await res.json();
  check("all total = 3", body.total === 3);
  check("counts workbench = 1", body.counts.workbench === 1);
  check("counts gateway = 2", body.counts.gateway === 2);
  check("ordered by created_at DESC", body.items[0].request_id === "r-wb-ok");
  check("gateway row classified as gateway", body.items.find((x) => x.request_id === "r-gw-ok").source === "gateway");
  check("null key classified as workbench", body.items.find((x) => x.request_id === "r-wb-ok").source === "workbench");

  const joined = body.items.find((x) => x.request_id === "r-gw-ok");
  check("key_name joined from api_keys", joined.key_name === "网关密钥甲");
  check("account_label joined from accounts", joined.account_label === "账号甲");
  check("cost_gems returned", joined.cost_gems === 2);

  const gw = await (await req("GET", "http://localhost/api/logs?source=gateway")).json();
  check("source=gateway total = 2", gw.total === 2);
  check("source=gateway items all gateway", gw.items.every((x) => x.source === "gateway"));
  check("source=gateway counts still full breakdown", gw.counts.workbench === 1 && gw.counts.gateway === 2);

  const wb = await (await req("GET", "http://localhost/api/logs?source=workbench")).json();
  check("source=workbench total = 1", wb.total === 1);
  check("source=workbench item is workbench", wb.items.every((x) => x.source === "workbench"));
}

/* ================= 2. logs 状态过滤与分页 ================= */
section("2. logs status filter + pagination");
{
  const ok = await (await req("GET", "http://localhost/api/logs?status=ok")).json();
  check("status=ok total = 2", ok.total === 2);
  check("status=ok all ok", ok.items.every((x) => x.ok === true));
  check("status=ok counts reflect filter", ok.counts.workbench === 1 && ok.counts.gateway === 1);

  const fail = await (await req("GET", "http://localhost/api/logs?status=fail")).json();
  check("status=fail total = 1", fail.total === 1);
  check("status=fail item failed", fail.items[0].request_id === "r-gw-fail");

  const combined = await (await req("GET", "http://localhost/api/logs?source=gateway&status=fail")).json();
  check("source+status combined total = 1", combined.total === 1);
  check("combined item is gateway fail", combined.items[0].request_id === "r-gw-fail");

  const page = await (await req("GET", "http://localhost/api/logs?limit=1&offset=1")).json();
  check("pagination limit=1 offset=1 returns 1", page.items.length === 1);
  check("pagination second row", page.items[0].request_id === "r-gw-fail");
  check("pagination total stays 3", page.total === 3);
}

/* ================= 3. attempts 明细 ================= */
section("3. logs attempts detail");
{
  const res = await req("GET", "http://localhost/api/logs/r-gw-fail/attempts");
  check("GET attempts -> 200", res.status === 200);
  const body = await res.json();
  check("attempt total = 1", body.total === 1);
  check("attempt error returned", body.items[0].error === "upstream_error_seed");
  check("attempt account_label joined", body.items[0].account_label === "账号甲");

  const empty = await (await req("GET", "http://localhost/api/logs/r-none/attempts")).json();
  check("unknown request -> empty items", empty.total === 0 && empty.items.length === 0);
}

/* ================= 4. profile 默认与站点信息 ================= */
section("4. profile default + site counts");
{
  const res = await req("GET", "http://localhost/api/profile");
  check("GET /api/profile -> 200", res.status === 200);
  const body = await res.json();
  check("default nickname empty", body.nickname === "");
  check("default avatar color", body.avatar_color === "#0071e3");
  check("default preferences object", typeof body.preferences === "object" && body.preferences !== null);
  check("identity role owner", body.identity.role === "owner");
  check("site version from env", body.site.version === "9.9.9-test");
  check("site environment from env", body.site.environment === "test");
  check("site domain from host", body.site.domain === "dw.test");
  check("site counts accounts = 1", body.site.counts.accounts === 1);
  check("site counts upstreams = 1", body.site.counts.upstreams === 1);
  check("site counts api_keys = 1", body.site.counts.api_keys === 1);
  check("site counts logs = 3", body.site.counts.logs === 3);
}

/* ================= 5. profile PATCH ================= */
section("5. profile PATCH upsert + validation");
{
  const res = await req("PATCH", "http://localhost/api/profile", {
    nickname: "  画师甲  ",
    avatar_color: "#248A3D",
    preferences: { note: "常用 832x1216", theme: "light" }
  });
  check("PATCH -> 200", res.status === 200);
  const body = await res.json();
  check("nickname trimmed", body.nickname === "画师甲");
  check("avatar color lowercased", body.avatar_color === "#248a3d");
  check("preferences persisted", body.preferences.note === "常用 832x1216" && body.preferences.theme === "light");

  const persisted = await (await req("GET", "http://localhost/api/profile")).json();
  check("GET reflects PATCH", persisted.nickname === "画师甲" && persisted.avatar_color === "#248a3d");

  const partial = await (await req("PATCH", "http://localhost/api/profile", { nickname: "画师乙" })).json();
  check("partial PATCH keeps avatar color", partial.avatar_color === "#248a3d");
  check("partial PATCH keeps preferences", partial.preferences.note === "常用 832x1216");

  const badColor = await req("PATCH", "http://localhost/api/profile", { avatar_color: "red" });
  check("invalid avatar color -> 400", badColor.status === 400);
  check("invalid color error code", (await badColor.json()).error === "invalid_avatar_color");

  const badNick = await req("PATCH", "http://localhost/api/profile", { nickname: 123 });
  check("non-string nickname -> 400", badNick.status === 400);

  const longNick = await req("PATCH", "http://localhost/api/profile", { nickname: "x".repeat(41) });
  check("overlong nickname -> 400", longNick.status === 400);

  const badPrefs = await req("PATCH", "http://localhost/api/profile", { preferences: ["a"] });
  check("array preferences -> 400", badPrefs.status === 400);
  check("array preferences error code", (await badPrefs.json()).error === "invalid_preferences");
}

/* ================= 6. app_profile 表单例兜底 ================= */
section("6. app_profile singleton fallback");
{
  const row = await DB.prepare("SELECT COUNT(*) AS c FROM app_profile WHERE id=1").first();
  check("exactly one singleton row", row.c === 1);
  await DB.prepare("DELETE FROM app_profile").run();
  const created = await mod.getProfile(env);
  check("getProfile recreates missing row", created.avatar_color === "#0071e3");
  const after = await DB.prepare("SELECT COUNT(*) AS c FROM app_profile WHERE id=1").first();
  check("row restored after getProfile", after.c === 1);
}

console.log(`\nselftest-logs-profile: ${passed} checks passed`);
