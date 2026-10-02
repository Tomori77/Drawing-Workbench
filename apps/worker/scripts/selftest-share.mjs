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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-share-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { auth } from "${abs("routes/auth.ts")}";`,
    `export { gallery } from "${abs("routes/gallery.ts")}";`,
    `export { sharePasswords } from "${abs("routes/sharePasswords.ts")}";`,
    `export { generate, inboundToCanonical, persistGeneration } from "${abs("routes/generate.ts")}";`,
    `export { verifySharePassword, createSharePassword, listSharePasswords, updateSharePassword } from "${abs("db/sharePasswords.ts")}";`,
    `export { createUpstream } from "${abs("db/upstreams.ts")}";`,
    `export { encrypt } from "${abs("lib/crypto.ts")}";`,
    `export { verifySession, SESSION_COOKIE } from "${abs("lib/session.ts")}";`
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
const { getCookie } = await import("hono/cookie");

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
    "0002_gateway.sql",
    "0003_checkin.sql",
    "0004_profile.sql",
    "0005_account_usage.sql",
    "0006_share_passwords.sql"
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
    },
    _keys: () => [...objects.keys()]
  };
}

/* ---------- 4. harness ---------- */
const DB = makeD1();
await applyMigrations({ exec: (sql) => DB._raw.exec(sql) });
const BUCKET = makeR2();
const ENCRYPTION_KEY = "dev-only-encryption-key-0123456789";
const env = {
  DB,
  BUCKET,
  ENCRYPTION_KEY,
  SESSION_SECRET: "s",
  APP_ENV: "test",
  OWNER_PASSWORD: "owner-secret"
};

// 真实 cookie 会话 + X-Test-Role/Sid 兜底（用于直接构造分区身份）。
async function testSession(c, next) {
  const token = getCookie(c, mod.SESSION_COOKIE);
  if (token) {
    const payload = await mod.verifySession(token, c.env.SESSION_SECRET);
    if (payload) {
      c.set("role", payload.role);
      c.set("sid", payload.sid ?? (payload.role === "owner" ? "owner" : undefined));
    }
  }
  const headerRole = c.req.header("X-Test-Role");
  if (headerRole && !c.get("role")) c.set("role", headerRole);
  const headerSid = c.req.header("X-Test-Sid");
  if (headerSid && !c.get("sid")) c.set("sid", headerSid);
  return next();
}

const app = new Hono();
app.use("*", testSession);
app.route("/api/auth", mod.auth);
app.route("/api/gallery", mod.gallery);
app.route("/api/share-passwords", mod.sharePasswords);
app.route("/api/generate", mod.generate);

async function req(method, url, body, headers = {}) {
  return app.request(url, { method, body, headers }, env);
}
function jsonHeaders(role = "owner", sid = null, extra = {}) {
  const h = { "Content-Type": "application/json", "X-Test-Role": role, ...extra };
  if (sid) h["X-Test-Sid"] = sid;
  return h;
}
function pngB64(bytes = "pngbytes") {
  return Buffer.from(bytes).toString("base64");
}

async function insertAccountRow(id, { upstreamId, username, secret }) {
  const credentialEnc = secret
    ? await mod.encrypt(JSON.stringify(secret), ENCRYPTION_KEY, "credentials")
    : null;
  await DB.prepare(
    "INSERT INTO accounts (id, upstream_id, label, username, credential_enc, gems_last, enabled, status, failure_count, cooldown_until, last_success_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(id, upstreamId, id, username, credentialEnc, null, 1, "active", 0, null, null, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    .run();
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

/* ================= 1. 分享密码哈希 ================= */
section("1. createSharePassword / verifySharePassword / 公开视图");
{
  const created = await mod.createSharePassword(env, { label: "小明", password: "friend-pass" });
  check("create returns public id", typeof created.id === "string" && created.id.length > 0);
  check("create returns quota default 500MB", created.quota_bytes === 524288000);
  check("public view has no salt", !("salt" in created));
  check("public view has no password_hash", !("password_hash" in created));

  const hit = await mod.verifySharePassword(env, "friend-pass");
  check("correct password verifies", hit && hit.id === created.id);
  const miss = await mod.verifySharePassword(env, "wrong-pass");
  check("wrong password rejected", miss === null);

  const listed = await mod.listSharePasswords(env);
  check("list returns public view", listed.length === 1 && !("salt" in listed[0]) && !("password_hash" in listed[0]));

  const updated = await mod.updateSharePassword(env, created.id, { password: "new-pass" });
  check("update returns public view", updated && updated.id === created.id);
  check("old password no longer verifies", (await mod.verifySharePassword(env, "friend-pass")) === null);
  check("new password verifies", (await mod.verifySharePassword(env, "new-pass"))?.id === created.id);
  check("stored hash never equals plaintext", updated !== null && updated.password_hash === undefined);

  const disabled = await mod.updateSharePassword(env, created.id, { enabled: false });
  check("disabled password does not verify", (await mod.verifySharePassword(env, "new-pass")) === null);
  await mod.updateSharePassword(env, created.id, { enabled: true });
  check("re-enabled password verifies", (await mod.verifySharePassword(env, "new-pass"))?.id === created.id);
}

/* ================= 2. 登录 sid ================= */
section("2. /login 会话身份 sid");
{
  const ownerRes = await req("POST", "http://localhost/api/auth/login", JSON.stringify({ password: "owner-secret" }), { "Content-Type": "application/json" });
  check("owner login 200", ownerRes.status === 200);
  const ownerCookie = ownerRes.headers.get("set-cookie");
  const ownerBody = await ownerRes.json();
  check("owner login body sid=owner", ownerBody.role === "owner" && ownerBody.sid === "owner");
  const meOwner = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: ownerCookie.split(";")[0] });
  const meOwnerBody = await meOwner.json();
  check("/me owner sid=owner", meOwnerBody.role === "owner" && meOwnerBody.sid === "owner");

  const shares = await mod.listSharePasswords(env);
  const share = shares[0];
  const friendRes = await req("POST", "http://localhost/api/auth/login", JSON.stringify({ password: "new-pass" }), { "Content-Type": "application/json" });
  check("friend login 200", friendRes.status === 200);
  const friendCookie = friendRes.headers.get("set-cookie");
  const friendBody = await friendRes.json();
  check("friend login sid = share id", friendBody.role === "friend" && friendBody.sid === share.id);
  const meFriend = await req("GET", "http://localhost/api/auth/me", undefined, { Cookie: friendCookie.split(";")[0] });
  const meFriendBody = await meFriend.json();
  check("/me friend sid = share id", meFriendBody.role === "friend" && meFriendBody.sid === share.id);

  const bad = await req("POST", "http://localhost/api/auth/login", JSON.stringify({ password: "nope" }), { "Content-Type": "application/json" });
  check("bad password 401", bad.status === 401);
}

/* ================= 3. 画廊分区列表 ================= */
section("3. 画廊列表分区");
{
  const shares = await mod.listSharePasswords(env);
  const sidA = shares[0].id;
  const sidB = (await mod.createSharePassword(env, { label: "小红", password: "pass-bbbb" })).id;

  const canonical = mod.inboundToCanonical({ prompt: "p", model: "m" });
  const ownerResult = { ok: true, upstream_id: null, account_id: null, cost_gems: 0, images: [{ b64: pngB64("owner-img") }] };
  await mod.persistGeneration(env, canonical, ownerResult, "owner", "owner");
  const aResult = { ok: true, upstream_id: null, account_id: null, cost_gems: 0, images: [{ b64: pngB64("a-img") }] };
  await mod.persistGeneration(env, canonical, aResult, "friend", sidA);
  const bResult = { ok: true, upstream_id: null, account_id: null, cost_gems: 0, images: [{ b64: pngB64("b-img") }] };
  await mod.persistGeneration(env, canonical, bResult, "friend", sidB);

  const friendList = await req("GET", "http://localhost/api/gallery?limit=50", undefined, jsonHeaders("friend", sidA));
  const friendBody = await friendList.json();
  check("friend sees only own sid", friendBody.items.length === 1 && friendBody.items.every((i) => i.owner_sid === sidA));
  check("friend total scoped", friendBody.total === 1);

  const friendCross = await req("GET", "http://localhost/api/gallery?limit=50&sid=" + sidB, undefined, jsonHeaders("friend", sidA));
  const friendCrossBody = await friendCross.json();
  check("friend cannot filter into other sd（ignore passed sid）", friendCrossBody.items.length === 1 && friendCrossBody.items[0].owner_sid === sidA);

  const ownerAll = await req("GET", "http://localhost/api/gallery?limit=50", undefined, jsonHeaders("owner", "owner"));
  const ownerAllBody = await ownerAll.json();
  check("owner default sees all sids", ownerAllBody.total === 3);
  check("owner sees mixed owner_sid", new Set(ownerAllBody.items.map((i) => i.owner_sid)).size === 3);

  const ownerFiltered = await req("GET", "http://localhost/api/gallery?limit=50&sid=" + sidB, undefined, jsonHeaders("owner", "owner"));
  const ownerFilteredBody = await ownerFiltered.json();
  check("owner sid filter works", ownerFilteredBody.total === 1 && ownerFilteredBody.items[0].owner_sid === sidB);

  const ownerOnlySid = await req("GET", "http://localhost/api/gallery?limit=50&sid=owner", undefined, jsonHeaders("owner", "owner"));
  const ownerOnlySidBody = await ownerOnlySid.json();
  check("owner sid=owner filter works", ownerOnlySidBody.total === 1 && ownerOnlySidBody.items[0].owner_sid === "owner");

  // 取图归属
  const friendOwn = friendBody.items[0].id;
  const ownerAsset = ownerAllBody.items.find((i) => i.owner_sid === "owner").id;
  const getOwn = await req("GET", `http://localhost/api/gallery/i/${friendOwn}`, undefined, jsonHeaders("friend", sidA));
  check("friend can fetch own image", getOwn.status === 200);
  const getCross = await req("GET", `http://localhost/api/gallery/i/${ownerAsset}`, undefined, jsonHeaders("friend", sidA));
  check("friend cannot fetch owner image（404）", getCross.status === 404);

  // 删除归属
  const delCross = await req("DELETE", `http://localhost/api/gallery/${ownerAsset}`, undefined, jsonHeaders("friend", sidA));
  check("friend cannot delete owner image（404）", delCross.status === 404);
  const delOwn = await req("DELETE", `http://localhost/api/gallery/${friendOwn}`, undefined, jsonHeaders("friend", sidA));
  check("friend can delete own image", delOwn.status === 200);
}

/* ================= 4. 配额 ================= */
section("4. 生成前配额检查");
{
  const sid = (await mod.createSharePassword(env, {
    label: "限额",
    password: "quota-pass",
    quota_bytes: 10
  })).id;

  // 预置一个超过配额的 asset（size_bytes=100 > quota 10）。
  const canonical = mod.inboundToCanonical({ prompt: "big", model: "m" });
  const big = { ok: true, upstream_id: null, account_id: null, cost_gems: 0, images: [{ b64: pngB64("xxxxxxxxxxxxxxxx") }] };
  await mod.persistGeneration(env, canonical, big, "friend", sid);
  const usedRow = await DB.prepare("SELECT COALESCE(SUM(size_bytes),0) AS used FROM assets WHERE owner_sid=?").bind(sid).first();
  check("seeded used exceeds quota", usedRow.used > 10);

  const up = await mod.createUpstream(env, {
    name: "quota-up",
    type: "nai-compatible",
    base_url: "https://nai.example",
    priority: 1,
    capabilities: { account_strategy: "fixed" }
  });
  await insertAccountRow("quota-acc", { upstreamId: up.id, username: "q", secret: { apiToken: "tok-q" } });

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ images: [pngB64("ok")], job: { cost_gems: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const denied = await req(
      "POST",
      "http://localhost/api/generate",
      JSON.stringify({ prompt: "x", upstream_id: up.id, account_mode: "fixed", account_id: "quota-acc" }),
      jsonHeaders("friend", sid)
    );
    check("over-quota generate 403", denied.status === 403);
    const deniedBody = await denied.json();
    check("error code quota_exceeded", deniedBody.error === "quota_exceeded");
    check("upstream not called when over quota", fetchCalls === 0);

    const ownerRes = await req(
      "POST",
      "http://localhost/api/generate",
      JSON.stringify({ prompt: "x", upstream_id: up.id, account_mode: "fixed", account_id: "quota-acc" }),
      jsonHeaders("owner", "owner")
    );
    check("owner not quota-checked -> 200", ownerRes.status === 200);
    check("owner request reached upstream", fetchCalls === 1);

    const sid2 = (await mod.createSharePassword(env, {
      label: "宽裕",
      password: "roomy-pass",
      quota_bytes: 1048576
    })).id;
    const allowed = await req(
      "POST",
      "http://localhost/api/generate",
      JSON.stringify({ prompt: "x", upstream_id: up.id, account_mode: "fixed", account_id: "quota-acc" }),
      jsonHeaders("friend", sid2)
    );
    check("under-quota friend -> 200", allowed.status === 200);
    check("under-quota reached upstream", fetchCalls === 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/* ================= 5. 缩略图累加字节 ================= */
section("5. 缩略图上传累加 size_bytes");
{
  const canonical = mod.inboundToCanonical({ prompt: "thumb", model: "m" });
  const result = { ok: true, upstream_id: null, account_id: null, cost_gems: 0, images: [{ b64: pngB64("original") }] };
  const persisted = await mod.persistGeneration(env, canonical, result, "owner", "owner");
  const assetId = persisted.images[0].id;
  const before = await DB.prepare("SELECT size_bytes FROM assets WHERE id=?").bind(assetId).first();
  check("original size stored", before.size_bytes === Buffer.from("original").length);

  const thumb = Buffer.from("thumb-bytes").toString("base64");
  const thumbRes = await req(
    "POST",
    `http://localhost/api/gallery/${assetId}/thumb`,
    JSON.stringify({ image: thumb, mime: "image/webp" }),
    jsonHeaders("owner", "owner")
  );
  check("thumb upload 200", thumbRes.status === 200);
  const after = await DB.prepare("SELECT size_bytes, thumb_r2_key FROM assets WHERE id=?").bind(assetId).first();
  check("size_bytes accumulated by thumb", after.size_bytes === before.size_bytes + Buffer.from("thumb-bytes").length);
  check("thumb_r2_key recorded", after.thumb_r2_key === `thumb/${assetId}`);
}

/* ================= 6. owner 总览 ================= */
section("6. GET /api/gallery/overview");
{
  const ownerRes = await req("GET", "http://localhost/api/gallery/overview", undefined, jsonHeaders("owner", "owner"));
  check("overview 200 owner", ownerRes.status === 200);
  const body = await ownerRes.json();
  check("overview has owner row", body.items.some((r) => r.sid === "owner" && r.role === "owner" && r.quota_bytes === null));
  check("overview has label 所有者", body.items.find((r) => r.sid === "owner")?.label === "所有者");
  const shareIds = (await mod.listSharePasswords(env)).map((s) => s.id);
  check("overview has one row per share password", body.items.length === 1 + shareIds.length);
  check("overview rows carry quota", shareIds.every((id) => body.items.some((r) => r.sid === id && typeof r.quota_bytes === "number")));
  check("overview rows carry used_bytes + count", body.items.every((r) => typeof r.used_bytes === "number" && typeof r.count === "number"));

  const friendRes = await req("GET", "http://localhost/api/gallery/overview", undefined, jsonHeaders("friend", null));
  check("overview forbidden for friend", friendRes.status === 403);
}

console.log(`\nselftest-share: ${passed} checks passed`);
