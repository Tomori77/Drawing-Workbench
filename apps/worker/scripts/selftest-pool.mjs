import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, "..", "src");

/* ---------- 1. 用 esbuild 把纯 TS 模块打成可注入 fetch 的单文件 bundle ---------- */
async function loadEsbuild() {
  const require = createRequire(import.meta.url);
  const pnpmDir = path.join(here, "..", "..", "..", "node_modules", ".pnpm");
  const entries = await readdir(pnpmDir);
  const dir = entries.filter((e) => e.startsWith("esbuild@")).sort().pop();
  assert.ok(dir, "esbuild not found under node_modules/.pnpm");
  return require(path.join(pnpmDir, dir, "node_modules", "esbuild"));
}

const esbuild = await loadEsbuild();
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-pool-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { loginUpstreamAccount, refreshJwt } from "${abs("pool/login.ts")}";`,
    `export { selectAccounts, getActiveAccountForUpstream } from "${abs("pool/select.ts")}";`,
    `export { markAccountFailure, markAccountSuccess, getCooldownConfig, isCooldownTrigger } from "${abs("pool/cooldown.ts")}";`,
    `export { refreshAccountGems, refreshAllGems } from "${abs("pool/balance.ts")}";`,
    `export { createAccount, getAccount, getAccountSecret, presentAccount, toAccountPublic, updateAccount, listAccounts } from "${abs("db/accounts.ts")}";`,
    `export { createUpstream, parseAccountStrategy } from "${abs("db/upstreams.ts")}";`,
    `export { encrypt, decrypt } from "${abs("lib/crypto.ts")}";`
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

/* ---------- 2. 用 node:sqlite 造一个内存 D1 stub ---------- */
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
  for (const name of ["0001_init.sql", "0002_gateway.sql", "0003_checkin.sql"]) {
    const sql = await readFile(path.join(here, "..", "migrations", name), "utf8");
    db.exec(sql);
  }
}

const DB = makeD1();
await applyMigrations(DB);
const ENCRYPTION_KEY = "dev-only-encryption-key-0123456789";
const env = { DB, ENCRYPTION_KEY };

/* ---------- 3. 假 fetch ---------- */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const fetchLog = [];
function makeFetch(routes) {
  return async (url, init = {}) => {
    fetchLog.push({ url, method: init.method ?? "GET", body: init.body });
    for (const [pattern, handler] of routes) {
      if (url.includes(pattern)) return handler(url, init);
    }
    return jsonResponse({ error: "no_route", url }, 404);
  };
}

async function insertAccountRow(id, { upstreamId, username, secret, gems = null, enabled = 1, status = "active" }) {
  const credentialEnc = secret
    ? await mod.encrypt(JSON.stringify(secret), ENCRYPTION_KEY, "credentials")
    : null;
  await DB.prepare(
    "INSERT INTO accounts (id, upstream_id, label, username, credential_enc, gems_last, enabled, status, failure_count, cooldown_until, last_success_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(id, upstreamId, id, username, credentialEnc, gems, enabled, status, 0, null, null, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    .run();
}

/* ---------- 4. 断言脚手架 ---------- */
let passed = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  ok  ${name}`);
};
function section(title) {
  console.log(`\n${title}`);
}

/* ================= 测试 1：loginUpstreamAccount ================= */
section("1. loginUpstreamAccount");
{
  const fetchImpl = makeFetch([
    ["/api/ynai/auth/login", () => jsonResponse({ data: { access_token: "jwt-abc", token_type: "Bearer" } })]
  ]);
  const { jwt } = await mod.loginUpstreamAccount("https://nai.rinko.ai", "u1", "p1", fetchImpl);
  check("parses data.access_token", jwt === "jwt-abc");
  check("posts JSON credentials to /api/ynai/auth/login", JSON.parse(fetchLog.at(-1).body).username === "u1");
  check("uses POST", fetchLog.at(-1).method === "POST");

  const badFetch = makeFetch([["/api/ynai/auth/login", () => jsonResponse({ detail: "bad creds" }, 401)]]);
  let threw = null;
  try {
    await mod.loginUpstreamAccount("https://nai.rinko.ai", "u", "bad", badFetch);
  } catch (err) {
    threw = err;
  }
  check("401 surfaces status code", threw && threw.status === 401 && threw.name === "UpstreamHttpError");
}

/* ================= 测试 2：凭据加密往返 + 公开视图 ================= */
section("2. credential encryption / public view");
{
  const firstUpstream = await mod.createUpstream(env, {
    name: "nai",
    type: "nai-compatible",
    base_url: "https://nai.rinko.ai"
  });
  const upstreams = await DB.prepare("SELECT id FROM upstreams").all();
  void firstUpstream;
  const upstreamId = upstreams.results[0].id;
  const row = await mod.createAccount(env, {
    upstream_id: upstreamId,
    username: "u-crypto",
    jwt: "raw-jwt-secret",
    password: "raw-password-secret",
    apiToken: "ynai-raw-token"
  });
  check("credential_enc stored as enc:v1 ciphertext", row.credential_enc.startsWith("enc:v1:"));
  check("ciphertext does not contain plaintext", !row.credential_enc.includes("raw-password-secret"));

  const secret = await mod.getAccountSecret(env, row.id);
  check("getAccountSecret round-trips jwt", secret.jwt === "raw-jwt-secret");
  check("getAccountSecret round-trips password", secret.password === "raw-password-secret");
  check("getAccountSecret round-trips apiToken", secret.apiToken === "ynai-raw-token");

  const pub = await mod.presentAccount(env, row);
  const serialized = JSON.stringify(pub);
  check("public view reports has_* flags", pub.has_jwt && pub.has_password && pub.has_api_token);
  check("public view leaks no ciphertext", !serialized.includes("enc:v1:"));
  check("public view leaks no plaintext", !/raw-jwt-secret|raw-password-secret|ynai-raw-token/.test(serialized));
  const bare = mod.toAccountPublic(row);
  check("toAccountPublic without secret defaults has_* false", !bare.has_jwt && !bare.has_password && !bare.has_api_token);

  const updated = await mod.updateAccount(env, row.id, { apiToken: "ynai-new-token", label: "L1" });
  const secret2 = await mod.getAccountSecret(env, updated.id);
  check("updateAccount preserves other secret fields", secret2.jwt === "raw-jwt-secret" && secret2.password === "raw-password-secret");
  check("updateAccount replaces apiToken", secret2.apiToken === "ynai-new-token");
}

/* ================= 测试 3：selectAccounts 三种策略 ================= */
section("3. selectAccounts strategies");
{
  const up = await mod.createUpstream(env, {
    name: "rr",
    type: "nai-compatible",
    base_url: "https://nai.rinko.ai",
    capabilities: { account_strategy: "round_robin" }
  });
  await insertAccountRow("a", { upstreamId: up.id, username: "a", secret: { apiToken: "tok-a" }, gems: 10 });
  await insertAccountRow("b", { upstreamId: up.id, username: "b", secret: { apiToken: "tok-b" }, gems: 30 });
  await insertAccountRow("c", { upstreamId: up.id, username: "c", secret: { apiToken: "tok-c" }, gems: 20 });
  await insertAccountRow("d", { upstreamId: up.id, username: "d", secret: {}, gems: 99 });

  const rr1 = await mod.selectAccounts(env, up.id, "round_robin");
  const rr2 = await mod.selectAccounts(env, up.id, "round_robin");
  const rr3 = await mod.selectAccounts(env, up.id, "round_robin");
  check("round_robin excludes accounts without api token", rr1.candidates.length === 3);
  check("round_robin 1st order a,b,c", rr1.candidates.map((x) => x.account.id).join(",") === "a,b,c");
  check("round_robin cursor advances 2nd order b,c,a", rr2.candidates.map((x) => x.account.id).join(",") === "b,c,a");
  check("round_robin cursor advances 3rd order c,a,b", rr3.candidates.map((x) => x.account.id).join(",") === "c,a,b");

  const bf = await mod.selectAccounts(env, up.id, "balance_first");
  check("balance_first orders by gems desc", bf.candidates.map((x) => x.account.id).join(",") === "b,c,a");

  const fixed1 = await mod.selectAccounts(env, up.id, "fixed");
  const fixed2 = await mod.selectAccounts(env, up.id, "fixed");
  check("fixed stable by created_at (cursor-independent)", fixed1.candidates.map((x) => x.account.id).join(",") === "a,b,c");
  check("fixed repeated call unchanged", fixed2.candidates.map((x) => x.account.id).join(",") === "a,b,c");

  check("strategy read from capabilities_json", mod.parseAccountStrategy(JSON.stringify({ account_strategy: "balance_first" })) === "balance_first");
  check("strategy defaults to round_robin", mod.parseAccountStrategy("{}") === "round_robin");
  check("unknown strategy falls back to round_robin", mod.parseAccountStrategy(JSON.stringify({ account_strategy: "nope" })) === "round_robin");
}

/* ================= 测试 4：失败阈值触发冷却并被跳过 ================= */
section("4. cooldown threshold + selection skip");
{
  const up = await mod.createUpstream(env, {
    name: "cool",
    type: "nai-compatible",
    base_url: "https://nai.rinko.ai"
  });
  await insertAccountRow("x1", { upstreamId: up.id, username: "x1", secret: { apiToken: "tok-x1" } });
  await insertAccountRow("x2", { upstreamId: up.id, username: "x2", secret: { apiToken: "tok-x2" } });

  const cfg = await mod.getCooldownConfig(env, up.id);
  check("default cooldown config threshold=3", cfg.threshold === 3);
  check("isCooldownTrigger 429 true", mod.isCooldownTrigger(429));
  check("isCooldownTrigger 500 true", mod.isCooldownTrigger(500));
  check("isCooldownTrigger 400 false", !mod.isCooldownTrigger(400));

  const f1 = await mod.markAccountFailure(env, "x1", 429, up.id);
  const f2 = await mod.markAccountFailure(env, "x1", 429, up.id);
  check("failure_count increments before threshold", f1.failure_count === 1 && f2.failure_count === 2);
  check("no cooldown before threshold", f1.cooldown_until === null && f2.cooldown_until === null);

  const before = await mod.selectAccounts(env, up.id, "fixed");
  check("no skip before threshold", before.cooldown_skipped === 0 && before.candidates.length === 2);

  const f3 = await mod.markAccountFailure(env, "x1", 429, up.id);
  check("threshold hit sets cooldown_until", f3.failure_count === 3 && typeof f3.cooldown_until === "string");
  const x1 = await mod.getAccount(env, "x1");
  check("account row marked cooling", x1.status === "cooling" && x1.cooldown_until === f3.cooldown_until);

  const after = await mod.selectAccounts(env, up.id, "fixed");
  check("cooled account skipped by selectAccounts", !after.candidates.some((x) => x.account.id === "x1"));
  check("cooldown_skipped reflects skip", after.cooldown_skipped === 1);
  check("remaining candidate is x2", after.candidates.map((x) => x.account.id).join(",") === "x2");

  const rateRow = await DB.prepare("SELECT failure_count, cooldown_until FROM account_rate_state WHERE account_id='x1'").first();
  check("account_rate_state persisted", rateRow.failure_count === 3 && rateRow.cooldown_until === f3.cooldown_until);

  await mod.markAccountSuccess(env, "x1");
  const x1After = await mod.getAccount(env, "x1");
  check("markAccountSuccess clears cooldown", x1After.cooldown_until === null && x1After.failure_count === 0);
  const restored = await mod.selectAccounts(env, up.id, "fixed");
  check("account selectable again after success", restored.candidates.length === 2);
}

/* ================= 测试 4b：refreshJwt 自动重登并回写 ================= */
section("4b. refreshJwt re-login");
{
  const up = await mod.createUpstream(env, {
    name: "relogin",
    type: "nai-compatible",
    base_url: "https://nai.rinko.ai"
  });
  const acc = await mod.createAccount(env, {
    upstream_id: up.id,
    username: "relogin-user",
    password: "relogin-pass",
    jwt: "stale-jwt",
    apiToken: "keep-me"
  });
  const fetchImpl = makeFetch([
    ["/api/ynai/auth/login", () => jsonResponse({ data: { access_token: "fresh-jwt" } })]
  ]);
  const jwt = await mod.refreshJwt(env, acc, fetchImpl);
  check("refreshJwt returns new token", jwt === "fresh-jwt");
  const secret = await mod.getAccountSecret(env, acc.id);
  check("refreshJwt persists new jwt", secret.jwt === "fresh-jwt");
  check("refreshJwt preserves apiToken", secret.apiToken === "keep-me");
  const loginBody = JSON.parse(fetchLog.filter((f) => f.url.includes("/auth/login")).at(-1).body);
  check("refreshJwt sends managed password", loginBody.password === "relogin-pass" && loginBody.username === "relogin-user");
}

/* ================= 测试 5：余额刷新（注入 fetch） ================= */
section("5. balance refresh");
{
  const up = await mod.createUpstream(env, {
    name: "bal",
    type: "nai-compatible",
    base_url: "https://nai.rinko.ai"
  });
  await insertAccountRow("g1", { upstreamId: up.id, username: "g1", secret: { jwt: "jwt-g1" } });
  const fetchImpl = makeFetch([
    ["/api/ynai/user/balance", () => jsonResponse({ data: { balance_gems: 42 } })]
  ]);
  const account = await mod.getAccount(env, "g1");
  const gems = await mod.refreshAccountGems(env, account, fetchImpl);
  check("fetchBalance reads data.balance_gems", gems === 42);
  const reread = await mod.getAccount(env, "g1");
  check("gems_last written back", reread.gems_last === 42);

  const summary = await mod.refreshAllGems(env, fetchImpl);
  const g1Item = summary.items.find((item) => item.id === "g1");
  const x1Item = summary.items.find((item) => item.id === "x1");
  check("refreshAllGems refreshed g1 to 42", g1Item?.ok === true && g1Item.gems === 42);
  check("refreshAllGems total matches sum of successes", summary.total_gems === 42 * summary.refreshed);
  check("refreshAllGems records per-account failure for jwt-less account", x1Item?.ok === false);
  check("refreshAllGems continues past a failure", summary.refreshed >= 2);
}

console.log(`\nselftest-pool: ${passed} checks passed`);
