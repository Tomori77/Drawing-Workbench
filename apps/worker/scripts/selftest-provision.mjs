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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-provision-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { provisionToken, provisionTokenName } from "${abs("pool/provision.ts")}";`,
    `export { createAccount, getAccount, getAccountSecret, updateAccount, presentAccount } from "${abs("db/accounts.ts")}";`,
    `export { createUpstream } from "${abs("db/upstreams.ts")}";`,
    `export { encrypt } from "${abs("lib/crypto.ts")}";`
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

async function applyMigrations(db) {
  for (const name of ["0001_init.sql", "0002_gateway.sql", "0003_checkin.sql", "0005_account_usage.sql"]) {
    const sql = await readFile(path.join(here, "..", "migrations", name), "utf8");
    db.exec(sql);
  }
}

const DB = makeD1();
await applyMigrations(DB);
const ENCRYPTION_KEY = "dev-only-encryption-key-0123456789";
const env = { DB, ENCRYPTION_KEY };

/* ---------- 3. fake fetch ---------- */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const fetchLog = [];
function makeFetch(handler) {
  return async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const auth = init.headers?.Authorization ?? "";
    fetchLog.push({ url, method: init.method ?? "GET", body, auth });
    return handler(url, init, { body, auth });
  };
}

/* ---------- 4. assertions ---------- */
let passed = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  ok  ${name}`);
};
function section(title) {
  console.log(`\n${title}`);
}

/* ================= 1. 正常路径 ================= */
section("1. provisionToken happy path + encrypted write-back");
{
  const up = await mod.createUpstream(env, {
    name: "nai",
    type: "nai-compatible",
    base_url: "https://nai.example"
  });
  const acc = await mod.createAccount(env, {
    upstream_id: up.id,
    username: "happy",
    jwt: "jwt-valid",
    password: "pw"
  });
  const fetchImpl = makeFetch((url) => {
    if (url.includes("/api/ynai/tokens")) return jsonResponse({ data: { token: "ynai-abc" } });
    return jsonResponse({ error: "no_route", url }, 404);
  });

  const token = await mod.provisionToken(env, acc, up, fetchImpl);
  check("returns data.data.token", token === "ynai-abc");
  check("posts to /api/ynai/tokens", fetchLog.at(-1).url.endsWith("/api/ynai/tokens"));
  check("sends Bearer jwt", fetchLog.at(-1).auth === "Bearer jwt-valid");
  check("request name uses DW-YYMMDDHHmm format", /^DW-\d{10}$/.test(fetchLog.at(-1).body.name));
  check("request name is Shanghai timestamp", fetchLog.at(-1).body.name === mod.provisionTokenName(new Date()));
  check("request allows paid + free tier", fetchLog.at(-1).body.allow_paid_requests === true && fetchLog.at(-1).body.allow_free_tier_requests === true);
  check("request sets null limits", fetchLog.at(-1).body.daily_gems_limit === null && fetchLog.at(-1).body.total_gems_limit === null && fetchLog.at(-1).body.max_gems_per_request === null);
  check("request sends empty allowed_models", Array.isArray(fetchLog.at(-1).body.allowed_models) && fetchLog.at(-1).body.allowed_models.length === 0);

  const raw = await DB.prepare("SELECT credential_enc FROM accounts WHERE id=?").bind(acc.id).first();
  check("credential_enc is enc:v1 ciphertext", raw.credential_enc.startsWith("enc:v1:"));
  check("ciphertext does not leak plaintext token", !raw.credential_enc.includes("ynai-abc"));

  const secret = await mod.getAccountSecret(env, acc.id);
  check("apiToken written back", secret.apiToken === "ynai-abc");
  check("jwt preserved", secret.jwt === "jwt-valid");
}

/* ================= 2. 重名冲突退避 ================= */
section("2. duplicate-name conflict -> timestamp retry");
{
  const up = await mod.createUpstream(env, {
    name: "nai-dup",
    type: "nai-compatible",
    base_url: "https://nai-dup.example"
  });
  const acc = await mod.createAccount(env, {
    upstream_id: up.id,
    username: "dup",
    jwt: "jwt-dup"
  });
  const names = [];
  const base = mod.provisionTokenName(new Date());
  const fetchImpl = makeFetch((url, init, { body }) => {
    if (url.includes("/api/ynai/tokens")) {
      names.push(body.name);
      if (body.name === base) return jsonResponse({ detail: "token name already exists" }, 409);
      return jsonResponse({ data: { token: "ynai-dup" } });
    }
    return jsonResponse({ error: "no_route" }, 404);
  });

  const token = await mod.provisionToken(env, acc, up, fetchImpl);
  check("first attempt uses DW base name", names[0] === base);
  check("second attempt appends suffix", names[1].startsWith(`${base}-`) && names[1] !== base);
  check("returns token from retry", token === "ynai-dup");
  const secret = await mod.getAccountSecret(env, acc.id);
  check("retry token persisted", secret.apiToken === "ynai-dup");
}

/* ================= 3. JWT 失效自动重登 ================= */
section("3. expired JWT -> refreshJwt -> provision");
{
  const up = await mod.createUpstream(env, {
    name: "nai-relogin",
    type: "nai-compatible",
    base_url: "https://nai-relogin.example"
  });
  const acc = await mod.createAccount(env, {
    upstream_id: up.id,
    username: "relogin",
    password: "pw",
    jwt: "stale-jwt"
  });
  const seenAuth = [];
  const fetchImpl = makeFetch((url, init, { auth }) => {
    if (url.includes("/api/ynai/auth/login")) return jsonResponse({ data: { access_token: "fresh-jwt" } });
    if (url.includes("/api/ynai/tokens")) {
      seenAuth.push(auth);
      if (auth === "Bearer stale-jwt") return jsonResponse({ detail: "jwt expired" }, 401);
      return jsonResponse({ data: { token: "ynai-fresh" } });
    }
    return jsonResponse({ error: "no_route" }, 404);
  });

  const token = await mod.provisionToken(env, acc, up, fetchImpl);
  check("stale jwt rejected twice before relogin", seenAuth.filter((a) => a === "Bearer stale-jwt").length === 2);
  check("retry uses fresh jwt", seenAuth.at(-1) === "Bearer fresh-jwt");
  check("returns fresh token", token === "ynai-fresh");
  const secret = await mod.getAccountSecret(env, acc.id);
  check("persists refreshed jwt", secret.jwt === "fresh-jwt");
  check("persists provisioned token", secret.apiToken === "ynai-fresh");
  check("logs in with managed password", fetchLog.find((f) => f.url.includes("/auth/login")).body.password === "pw");
}

/* ================= 4. 无 JWT 明确报错 ================= */
section("4. missing JWT -> semantic error");
{
  const up = await mod.createUpstream(env, {
    name: "nai-nojwt",
    type: "nai-compatible",
    base_url: "https://nai-nojwt.example"
  });
  const acc = await mod.createAccount(env, {
    upstream_id: up.id,
    username: "nojwt"
  });
  let threw = null;
  const fetchImpl = makeFetch(() => jsonResponse({ error: "should_not_be_called" }, 500));
  try {
    await mod.provisionToken(env, acc, up, fetchImpl);
  } catch (err) {
    threw = err;
  }
  check("throws UpstreamHttpError", threw && threw.name === "UpstreamHttpError");
  check("error code is ACCOUNT_NO_JWT", threw && threw.code === "ACCOUNT_NO_JWT");
  check("error status is 400", threw && threw.status === 400);
  check("no upstream request attempted", fetchLog.filter((f) => f.url.includes("nai-nojwt.example")).length === 0);
}

/* ================= 5. 已有 key 复用（默认不新建） ================= */
section("5. reuse existing api token unless forced");
{
  const up = await mod.createUpstream(env, {
    name: "nai-reuse",
    type: "nai-compatible",
    base_url: "https://nai-reuse.example"
  });
  const acc = await mod.createAccount(env, {
    upstream_id: up.id,
    username: "reuse",
    jwt: "jwt-reuse",
    apiToken: "ynai-existing"
  });
  const fetchImpl = makeFetch((url) => {
    if (url.includes("/api/ynai/tokens")) return jsonResponse({ data: { token: "ynai-new" } });
    return jsonResponse({ error: "no_route" }, 404);
  });

  const before = fetchLog.length;
  const reused = await mod.provisionToken(env, acc, up, fetchImpl);
  check("default reuses existing token", reused === "ynai-existing");
  check("reuse makes no upstream request", fetchLog.length === before);

  const forced = await mod.provisionToken(env, acc, up, fetchImpl, undefined, { force: true });
  check("force creates new token", forced === "ynai-new");
  check("force hits /api/ynai/tokens", fetchLog.at(-1).url.endsWith("/api/ynai/tokens"));
  const secret = await mod.getAccountSecret(env, acc.id);
  check("force persists new token", secret.apiToken === "ynai-new");
}

console.log(`\nselftest-provision: ${passed} checks passed`);
