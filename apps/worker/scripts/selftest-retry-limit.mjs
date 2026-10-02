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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-retry-limit-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { runPipeline } from "${abs("pipeline/run.ts")}";`,
    `export { selectAccounts } from "${abs("pool/select.ts")}";`,
    `export { getAccountLimit, remainingImages, isAccountLimited, addAccountImages, normalizeAccountLimit, DEFAULT_ACCOUNT_LIMIT } from "${abs("pool/limit.ts")}";`,
    `export { refreshJwt } from "${abs("pool/login.ts")}";`,
    `export { markAccountFailure, markAccountSuccess } from "${abs("pool/cooldown.ts")}";`,
    `export { createUpstream } from "${abs("db/upstreams.ts")}";`,
    `export { getAccount } from "${abs("db/accounts.ts")}";`,
    `export { encrypt } from "${abs("lib/crypto.ts")}";`,
    `export { inboundToCanonical } from "${abs("routes/generate.ts")}";`
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
    "0005_account_usage.sql"
  ]) {
    const sql = await readFile(path.join(here, "..", "migrations", name), "utf8");
    db.exec(sql);
  }
}

const DB = makeD1();
await applyMigrations(DB);
const ENCRYPTION_KEY = "dev-only-encryption-key-0123456789";
const env = { DB, ENCRYPTION_KEY };

/* ---------- 3. helpers ---------- */
const pngB64 = (s) => Buffer.from(s).toString("base64");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const SUCCESS_BODY = (n = 1) =>
  jsonResponse({ images: Array.from({ length: n }, (_, i) => pngB64(`IMG-${i}`)), job: { cost_gems: 1 } });

async function insertAccountRow(id, { upstreamId, username, secret, gems = null, enabled = 1, status = "active", cooldownUntil = null }) {
  const credentialEnc = secret
    ? await mod.encrypt(JSON.stringify(secret), ENCRYPTION_KEY, "credentials")
    : null;
  await DB.prepare(
    "INSERT INTO accounts (id, upstream_id, label, username, credential_enc, gems_last, enabled, status, failure_count, cooldown_until, last_success_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(id, upstreamId, id, username, credentialEnc, gems, enabled, status, 0, cooldownUntil, null, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    .run();
}

const usageRow = async (id) =>
  DB.prepare("SELECT window_start, image_count FROM account_usage WHERE account_id=?").bind(id).first();
const rateState = async (id) =>
  DB.prepare("SELECT failure_count, cooldown_until FROM account_rate_state WHERE account_id=?").bind(id).first();

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

/* ================= 1. 超时触发换号并最终成功 ================= */
section("1. timeout failover -> next account succeeds");
{
  const up = await mod.createUpstream(env, {
    name: "timeout",
    type: "nai-compatible",
    base_url: "https://nai.example",
    capabilities: { account_strategy: "fixed" }
  });
  await insertAccountRow("t1", { upstreamId: up.id, username: "t1", secret: { apiToken: "tok-timeout" } });
  await insertAccountRow("t2", { upstreamId: up.id, username: "t2", secret: { apiToken: "tok-ok" } });

  const seen = [];
  const fetchImpl = async (url, init) => {
    const auth = init.headers.Authorization;
    seen.push(auth);
    if (auth === "Bearer tok-timeout") {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    return SUCCESS_BODY(1);
  };

  const canonical = mod.inboundToCanonical({ prompt: "x", model: "m" });
  const result = await mod.runPipeline(canonical, {
    env,
    fetch: fetchImpl,
    timeoutMs: 30,
    selectUpstreams: (list) => list.filter((u) => u.id === up.id)
  });

  check("timeout fails over and request succeeds", result.ok === true);
  check("succeeded on second account", result.account_id === "t2");
  check("two attempts made", result.attempts === 2);
  check("first attempt recorded timeout", result.attempts_detail?.[0]?.error === "upstream_timeout");
  check("timeout counts as a failure for first account", (await rateState("t1"))?.failure_count === 1);
  check("first account token contacted first", seen[0] === "Bearer tok-timeout");
  check("second account token contacted second", seen[1] === "Bearer tok-ok");
}

/* ================= 2. 401 只重登（不 provision）且不计失败 ================= */
section("2. 401 refreshJwt only, retry original token, no failure counted");
{
  const up = await mod.createUpstream(env, {
    name: "relogin",
    type: "nai-compatible",
    base_url: "https://nai.example",
    capabilities: { account_strategy: "fixed" }
  });
  await insertAccountRow("r1", {
    upstreamId: up.id,
    username: "r1",
    secret: { password: "pw-r1", jwt: "stale-jwt", apiToken: "keep-me" }
  });

  const calls = [];
  let generateCount = 0;
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.includes("/api/ynai/auth/login")) {
      return jsonResponse({ data: { access_token: "fresh-jwt" } });
    }
    if (url.includes("/v1/nai/generate-image")) {
      generateCount += 1;
      if (generateCount === 1) return jsonResponse({ detail: "unauthorized" }, 401);
      return SUCCESS_BODY(1);
    }
    return jsonResponse({ error: "unexpected", url }, 500);
  };

  const canonical = mod.inboundToCanonical({ prompt: "x", model: "m" });
  const result = await mod.runPipeline(canonical, {
    env,
    fetch: fetchImpl,
    selectUpstreams: (list) => list.filter((u) => u.id === up.id)
  });

  check("401 then re-login retry succeeds", result.ok === true && result.account_id === "r1");
  check("re-login called /api/ynai/auth/login", calls.some((u) => u.includes("/api/ynai/auth/login")));
  check("did NOT call /api/ynai/tokens (no provision)", !calls.some((u) => u.includes("/api/ynai/tokens")));
  check("retried with the ORIGINAL api_token", generateCount === 2);
  check("account failure_count stays 0", (await mod.getAccount(env, "r1")).failure_count === 0);
  check("rate_state failure_count stays 0", ((await rateState("r1"))?.failure_count ?? 0) === 0);
}

/* ================= 3. 全池冷却时仍有兜底候选 ================= */
section("3. all-pool cooling -> fallback candidate (degraded cooldown)");
{
  const up = await mod.createUpstream(env, {
    name: "cool-all",
    type: "nai-compatible",
    base_url: "https://nai.example",
    capabilities: { account_strategy: "fixed" }
  });
  const soon = new Date(Date.now() + 60_000).toISOString();
  const later = new Date(Date.now() + 300_000).toISOString();
  await insertAccountRow("co-later", { upstreamId: up.id, username: "co-later", secret: { apiToken: "tk-1" }, status: "cooling", cooldownUntil: later });
  await insertAccountRow("co-soon", { upstreamId: up.id, username: "co-soon", secret: { apiToken: "tk-2" }, status: "cooling", cooldownUntil: soon });

  const selection = await mod.selectAccounts(env, up.id, "fixed");
  check("all cooling marks degraded=cooldown", selection.degraded === "cooldown");
  check("fallback flag set", selection.fallback === true);
  check("fallback candidates are non-empty", selection.candidates.length === 2);
  check("earliest-expiring cooldown is first", selection.candidates[0].account.id === "co-soon");

  // run.ts 有兜底候选就继续尝试，而不是直接返回 ALL_ACCOUNTS_COOLING。
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers.Authorization);
    return SUCCESS_BODY(1);
  };
  const canonical = mod.inboundToCanonical({ prompt: "x", model: "m" });
  const result = await mod.runPipeline(canonical, {
    env,
    fetch: fetchImpl,
    selectUpstreams: (list) => list.filter((u) => u.id === up.id)
  });
  check("cooling fallback is attempted, not hard-failed", result.ok === true);
  check("cooling fallback uses earliest-expiring account", result.account_id === "co-soon");
  check("cooling fallback account token used", seen[0] === "Bearer tk-2");
}

/* ================= 4. 限额：仅成功计入 + 跳过 + 达限兜底 ================= */
section("4. account limit: success-only counting, skip at limit, limit fallback");
{
  const up = await mod.createUpstream(env, {
    name: "limit",
    type: "nai-compatible",
    base_url: "https://nai.example",
    capabilities: { account_strategy: "fixed", account_limit: { window_ms: 600_000, max_images: 2 } }
  });
  await insertAccountRow("L1", { upstreamId: up.id, username: "L1", secret: { apiToken: "tok-L1" } });
  await insertAccountRow("L2", { upstreamId: up.id, username: "L2", secret: { apiToken: "tok-L2" } });

  const canonical = mod.inboundToCanonical({ prompt: "x", model: "m" });

  // 成功返回 2 张，达到限额。
  const okFetch = async () => SUCCESS_BODY(2);
  const ok1 = await mod.runPipeline(canonical, {
    env,
    fetch: okFetch,
    selectUpstreams: (list) => list.filter((u) => u.id === up.id)
  });
  check("first success", ok1.ok === true && ok1.account_id === "L1");
  check("success counted 2 images", (await usageRow("L1"))?.image_count === 2);

  // 失败不计数：L2 返回 429。
  const failFetch = async () => jsonResponse({ detail: "rate limited" }, 429);
  const failed = await mod.runPipeline(canonical, {
    env,
    fetch: failFetch,
    selectUpstreams: (list) => list.filter((u) => u.id === up.id)
  });
  check("failure not ok", failed.ok === false);
  check("failure does NOT create/increment usage", ((await usageRow("L2"))?.image_count ?? 0) === 0);

  // 达限账号被跳过（L1 限额用尽），仍有可用账号 L2。
  const skip = await mod.selectAccounts(env, up.id, "fixed");
  check("limited account skipped", skip.candidates.map((c) => c.account.id).join(",") === "L2");
  check("limited_skipped reflects skip", skip.limited_skipped === 1);
  check("not degraded while another account available", skip.degraded === null && skip.fallback === false);

  // L2 也达限 -> 全部达限兜底。
  await mod.addAccountImages(env, "L2", 2, await mod.getAccountLimit(env, up.id));
  const fallback = await mod.selectAccounts(env, up.id, "fixed");
  check("all-limited marks degraded=limit", fallback.degraded === "limit");
  check("all-limited fallback flag set", fallback.fallback === true);
  check("all-limited fallback candidates non-empty", fallback.candidates.length === 2);

  // remainingImages 与窗口重置。
  const limit = await mod.getAccountLimit(env, up.id);
  check("remainingImages is 0 at limit", (await mod.remainingImages(env, "L1", limit)) === 0);
  check("isAccountLimited true at limit", (await mod.isAccountLimited(env, "L1", limit)) === true);
  const expiredNow = Date.now() + limit.window_ms + 1;
  check("remaining resets after window expires", (await mod.remainingImages(env, "L1", limit, expiredNow)) === limit.max_images);
}

/* ================= 5. getAccountLimit 默认与覆盖 ================= */
section("5. getAccountLimit defaults and upstream override");
{
  const upDefault = await mod.createUpstream(env, {
    name: "limit-default",
    type: "nai-compatible",
    base_url: "https://nai.example"
  });
  const def = await mod.getAccountLimit(env, upDefault.id);
  check("default window_ms=600000", def.window_ms === 600_000);
  check("default max_images=20", def.max_images === 20);
  check("DEFAULT_ACCOUNT_LIMIT exported", mod.DEFAULT_ACCOUNT_LIMIT.max_images === 20);

  const upOverride = await mod.createUpstream(env, {
    name: "limit-override",
    type: "nai-compatible",
    base_url: "https://nai.example",
    capabilities: { account_limit: { window_ms: 1000, max_images: 5 } }
  });
  const over = await mod.getAccountLimit(env, upOverride.id);
  check("override window_ms=1000", over.window_ms === 1000);
  check("override max_images=5", over.max_images === 5);
  check("partial override keeps default window", mod.normalizeAccountLimit({ max_images: 3 }).window_ms === 600_000);
  check("invalid override falls back", mod.normalizeAccountLimit({ max_images: -1 }).max_images === 20);
}

console.log(`\nselftest-retry-limit: ${passed} checks passed`);
