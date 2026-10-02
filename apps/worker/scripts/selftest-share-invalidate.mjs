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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-invalidate-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { auth, sessionMiddleware } from "${abs("routes/auth.ts")}";`,
    `export { gallery } from "${abs("routes/gallery.ts")}";`,
    `export { sharePasswords } from "${abs("routes/sharePasswords.ts")}";`,
    `export { createSharePassword } from "${abs("db/sharePasswords.ts")}";`
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

/* ---------- 2. node:sqlite-backed D1 stub（带 share_passwords 读计数） ---------- */
let shareReads = 0;
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
    if (/FROM\s+share_passwords/i.test(this.sql)) shareReads += 1;
    return this.db.prepare(this.sql).all(...this.params);
  }
  async all() {
    return { results: this._rows(), success: true };
  }
  async first() {
    return this._rows()[0] ?? null;
  }
  async run() {
    if (/FROM\s+share_passwords/i.test(this.sql)) shareReads += 1;
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
    "0002_gateway.sql",
    "0003_checkin.sql",
    "0004_profile.sql",
    "0005_account_usage.sql",
    "0006_share_passwords.sql",
    "0007_presets.sql"
  ]) {
    const sql = await readFile(path.join(here, "..", "migrations", name), "utf8");
    db.exec(sql);
  }
}

/* ---------- 3. harness ---------- */
const DB = makeD1();
await applyMigrations({ exec: (sql) => DB._raw.exec(sql) });
const env = { DB, SESSION_SECRET: "s", APP_ENV: "test", OWNER_PASSWORD: "owner-secret" };

const app = new Hono();
app.use("*", mod.sessionMiddleware);
app.route("/api/auth", mod.auth);
app.route("/api/gallery", mod.gallery);
app.route("/api/share-passwords", mod.sharePasswords);

async function req(method, url, body, headers = {}) {
  return app.request(url, { method, body, headers }, env);
}
function jsonHeaders(extra = {}) {
  return { "Content-Type": "application/json", ...extra };
}
function cookieOf(res) {
  const raw = res.headers.get("set-cookie");
  return raw ? raw.split(";")[0] : "";
}
async function kvValue(sid) {
  return await DB.prepare("SELECT v FROM runtime_kv WHERE k=?")
    .bind(`sid_active:${sid}`)
    .first();
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

// owner 登录拿 Cookie（供受 requireOwner 保护的 CRUD 使用）。
let ownerCookie = "";
{
  const login = await req(
    "POST",
    "http://localhost/api/auth/login",
    JSON.stringify({ password: "owner-secret" }),
    jsonHeaders()
  );
  assert.equal(login.status, 200, "owner login for harness");
  ownerCookie = cookieOf(login);
}

/* ================= 1. friend 会话有效 ================= */
let share;
let friendCookie;
section("1. friend 会话在分享密码启用时有效");
{
  share = await mod.createSharePassword(env, { label: "小明", password: "friend-pass" });
  const login = await req(
    "POST",
    "http://localhost/api/auth/login",
    JSON.stringify({ password: "friend-pass" }),
    jsonHeaders()
  );
  check("friend login 200", login.status === 200);
  friendCookie = cookieOf(login);
  check("login set session cookie", friendCookie.startsWith("session="));

  const me = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: friendCookie });
  check("首次 /me 200", me.status === 200);
  const body = await me.json();
  check("/me role=friend sid=share.id", body.role === "friend" && body.sid === share.id);
  check("KV 缓存写入 1", (await kvValue(share.id))?.v === "1");
}

/* ================= 2. KV 命中零 D1 读 ================= */
section("2. KV 命中时不再查 share_passwords");
{
  shareReads = 0;
  const me = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: friendCookie });
  check("KV 命中 /me 200", me.status === 200);
  check("KV 命中未查询 share_passwords（0 次）", shareReads === 0);

  await DB.prepare("DELETE FROM runtime_kv WHERE k=?").bind(`sid_active:${share.id}`).run();
  shareReads = 0;
  const me2 = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: friendCookie });
  check("缓存缺失 /me 200", me2.status === 200);
  check("缓存缺失重新查 share_passwords（1 次）", shareReads === 1);
}

/* ================= 3. 停用立即失效 ================= */
section("3. 停用分享密码后同一会话 /me 401");
{
  const disable = await req(
    "PATCH",
    `http://localhost/api/share-passwords/${share.id}`,
    JSON.stringify({ enabled: false }),
    jsonHeaders({ Cookie: ownerCookie })
  );
  check("停用 PATCH 200", disable.status === 200);
  const me = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: friendCookie });
  check("停用后 /me 401", me.status === 401);
  check("失效响应清除会话 Cookie", (me.headers.get("set-cookie") ?? "").includes("Max-Age=0"));
  const cached = await kvValue(share.id);
  check("失效后缓存被清或更新为 0", cached === null || cached.v === "0");

  const enable = await req(
    "PATCH",
    `http://localhost/api/share-passwords/${share.id}`,
    JSON.stringify({ enabled: true }),
    jsonHeaders({ Cookie: ownerCookie })
  );
  check("重新启用 200", enable.status === 200);
  const meAgain = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: friendCookie });
  check("重新启用后同一会话恢复 200", meAgain.status === 200);
}

/* ================= 4. 改密码清缓存后重新判定 ================= */
section("4. 修改密码清缓存，sid 仍在故会话保持有效");
{
  await req(
    "PATCH",
    `http://localhost/api/share-passwords/${share.id}`,
    JSON.stringify({ password: "new-friend-pass" }),
    jsonHeaders({ Cookie: ownerCookie })
  );
  // PATCH 已清缓存；sid 仍在且启用，重新判定后应恢复有效。
  const me = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: friendCookie });
  check("改密码后会话仍有效 /me 200", me.status === 200);
  check("改密码后缓存重新判定为 1", (await kvValue(share.id))?.v === "1");
  const relogin = await req(
    "POST",
    "http://localhost/api/auth/login",
    JSON.stringify({ password: "new-friend-pass" }),
    jsonHeaders()
  );
  check("可用新密码重新登录 200", relogin.status === 200);
}

/* ================= 5. 删除立即失效 ================= */
section("5. 删除分享密码后同一会话 /me 401");
{
  const del = await req(
    "DELETE",
    `http://localhost/api/share-passwords/${share.id}`,
    undefined,
    jsonHeaders({ Cookie: ownerCookie })
  );
  check("删除分享密码 200", del.status === 200);
  const me = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: friendCookie });
  check("删除后 /me 401", me.status === 401);
  const cached = await kvValue(share.id);
  check("删除后缓存为 0 或已清", cached === null || cached.v === "0");

  shareReads = 0;
  const me2 = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: friendCookie });
  check("删除后二次 /me 仍 401", me2.status === 401);
  check("二次请求命中负缓存，不再读 share_passwords（0 次）", shareReads === 0);
}

/* ================= 6. owner 不受影响 ================= */
section("6. owner 会话不受影响且不查库");
{
  shareReads = 0;
  const me = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: ownerCookie });
  check("owner /me 200", me.status === 200);
  const body = await me.json();
  check("owner role/sid", body.role === "owner" && body.sid === "owner");
  check("owner 请求不查 share_passwords（0 次）", shareReads === 0);

  shareReads = 0;
  const anon = await req("GET", "http://localhost/api/auth/me");
  check("匿名 /me 401", anon.status === 401);
  check("匿名请求不查 share_passwords（0 次）", shareReads === 0);
}

/* ================= 7. 画廊总览合并配方/画师串数量 ================= */
section("7. gallery overview 追加 recipe_count / artist_count");
{
  const fresh = await mod.createSharePassword(env, { label: "总览", password: "overview-pass" });
  DB._raw
    .prepare(
      "INSERT INTO presets (id, owner_sid, kind, name, content, payload_json, builtin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run("ov-recipe", fresh.id, "recipe", "配方", null, "{}", 0, "2026-01-01", "2026-01-01");
  DB._raw
    .prepare(
      "INSERT INTO presets (id, owner_sid, kind, name, content, payload_json, builtin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run("ov-artist", fresh.id, "artist", "画师", "content", "{}", 0, "2026-01-01", "2026-01-01");
  DB._raw
    .prepare(
      "INSERT INTO presets (id, owner_sid, kind, name, content, payload_json, builtin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run("ov-recipe-2", fresh.id, "recipe", "配方2", null, "{}", 0, "2026-01-01", "2026-01-01");

  const res = await req("GET", "http://localhost/api/gallery/overview", undefined, { Cookie: ownerCookie });
  check("overview 200", res.status === 200);
  const body = await res.json();
  const row = body.items.find((r) => r.sid === fresh.id);
  check("overview 含该 sid 行", !!row);
  check("recipe_count=2", row?.recipe_count === 2);
  check("artist_count=1", row?.artist_count === 1);
  check("owner 行含 recipe_count/artist_count", body.items.every((r) => typeof r.recipe_count === "number" && typeof r.artist_count === "number"));
}

console.log(`\nselftest-share-invalidate: ${passed} checks passed`);
