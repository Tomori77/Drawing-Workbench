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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-gw-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { gatewayV1, gatewayGenerateRoute, openaiInboundToCanonical } from "${abs("routes/gateway.ts")}";`,
    `export { authenticateGatewayKey, gatewayKeyToPolicy } from "${abs("gateway/auth.ts")}";`,
    `export { normalizePolicy, applyPolicyToCanonical, GatewayError } from "${abs("gateway/policy.ts")}";`,
    `export { reserveDaily, addUsageGems, acquireLease, releaseLease } from "${abs("gateway/quota.ts")}";`,
    `export { createApiKey, getApiKey, updateApiKey } from "${abs("db/apiKeys.ts")}";`,
    `export { createUpstream } from "${abs("db/upstreams.ts")}";`,
    `export { inboundToCanonical } from "${abs("routes/generate.ts")}";`,
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
  for (const name of ["0001_init.sql", "0002_gateway.sql", "0003_checkin.sql", "0005_account_usage.sql"]) {
    const sql = await readFile(path.join(here, "..", "migrations", name), "utf8");
    db.exec(sql);
  }
}

const DB = makeD1();
await applyMigrations({ exec: (sql) => DB._raw.exec(sql) });
const ENCRYPTION_KEY = "dev-only-encryption-key-0123456789";
const env = { DB, ENCRYPTION_KEY, SESSION_SECRET: "s", APP_ENV: "test" };

const { Hono } = await import("hono");
const app = new Hono();
app.route("/v1", mod.gatewayV1);
app.route("/generate", mod.gatewayGenerateRoute);

async function req(method, url, body, headers = {}) {
  return app.request(url, { method, body, headers }, env);
}

/* ---------- 3. seed upstream + account ---------- */
async function insertAccountRow(id, { upstreamId, username, secret, enabled = 1 }) {
  const credentialEnc = secret
    ? await mod.encrypt(JSON.stringify(secret), ENCRYPTION_KEY, "credentials")
    : null;
  await DB.prepare(
    "INSERT INTO accounts (id, upstream_id, label, username, credential_enc, gems_last, enabled, status, failure_count, cooldown_until, last_success_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(id, upstreamId, id, username, credentialEnc, null, enabled, "active", 0, null, null, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    .run();
}

const up = await mod.createUpstream(env, {
  name: "gw-nai",
  type: "nai-compatible",
  base_url: "https://nai.example",
  priority: 10,
  capabilities: { account_strategy: "fixed" }
});
await insertAccountRow("gw-acc", { upstreamId: up.id, username: "gw", secret: { apiToken: "tok-gw" } });

const IMG_B64 = Buffer.from("PNGDATA-GW-1").toString("base64");
const IMG_BYTES = Buffer.from("PNGDATA-GW-1");

let fetchCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const bodyText = typeof init.body === "string" ? init.body : "<bytes>";
  let bodyJson = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = null;
  }
  fetchCalls.push({ url: String(url), auth: init.headers.Authorization, bodyText, bodyJson });
  return new Response(JSON.stringify({ images: [IMG_B64], job: { cost_gems: 2 } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

async function makeKey(overrides = {}) {
  const created = await mod.createApiKey(env, { name: overrides.name ?? "t", ...overrides });
  return created;
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

const okBody = JSON.stringify({ model: "nai-diffusion-4-5-full", prompt: "a cat", size: "832x1216" });
const authHeader = (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

/* ================= 1. 鉴权 ================= */
section("1. gateway auth (401)");
{
  const missing = await req("POST", "http://localhost/v1/nai/generate-image", okBody, { "Content-Type": "application/json" });
  check("missing key -> 401", missing.status === 401);
  const missingBody = await missing.json();
  check("error shape {error,message}", typeof missingBody.error === "string" && typeof missingBody.message === "string");

  const invalid = await req("POST", "http://localhost/v1/nai/generate-image", okBody, authHeader("dwb-not-real"));
  check("invalid key -> 401", invalid.status === 401);

  const disabled = await mod.createApiKey(env, { name: "disabled" });
  await mod.updateApiKey(env, disabled.record.id, { enabled: false });
  const disabledRes = await req("POST", "http://localhost/v1/nai/generate-image", okBody, authHeader(disabled.key));
  check("disabled key -> 401", disabledRes.status === 401);

  const expired = await mod.createApiKey(env, { name: "expired" });
  await mod.updateApiKey(env, expired.record.id, { expires_at: new Date(Date.now() - 86_400_000).toISOString() });
  const expiredRes = await req("POST", "http://localhost/v1/nai/generate-image", okBody, authHeader(expired.key));
  check("expired key -> 401", expiredRes.status === 401);

  const key = await makeKey({ name: "auth-ok", policy: { allowed_models: [] } });
  const ok = await req("POST", "http://localhost/v1/nai/generate-image", okBody, authHeader(key.key));
  check("valid key -> 200", ok.status === 200);
  const row = await mod.getApiKey(env, key.record.id);
  check("key stored as hash, not plaintext", row.key_hash !== key.key && row.key_hash.length === 64);
}

/* ================= 2. daily_requests 超限 ================= */
section("2. daily_requests limit -> 429");
{
  const key = await makeKey({ name: "daily", policy: { daily_requests: 1, max_concurrency: 0 } });
  const first = await req("POST", "http://localhost/v1/nai/generate-image", okBody, authHeader(key.key));
  check("1st request allowed", first.status === 200);
  const second = await req("POST", "http://localhost/v1/nai/generate-image", okBody, authHeader(key.key));
  check("2nd request (N+1) -> 429", second.status === 429);
  const body = await second.json();
  check("limit error code", body.error === "GATEWAY_DAILY_REQUEST_LIMIT");
  const usage = await DB.prepare("SELECT request_count FROM daily_usage WHERE gateway_key_id=?").bind(key.record.id).first();
  check("daily_usage request_count pre-charged for allowed request", usage.request_count === 1);
}

/* ================= 3. max_concurrency 超限 ================= */
section("3. max_concurrency limit -> 429");
{
  const key = await makeKey({ name: "conc", policy: { max_concurrency: 1 } });
  const held = await mod.acquireLease(env, key.record.id, 1, 60_000);
  check("lease acquired directly", held !== null && held.tracked === true);
  const blocked = await req("POST", "http://localhost/v1/nai/generate-image", okBody, authHeader(key.key));
  check("concurrent request -> 429", blocked.status === 429);
  const body = await blocked.json();
  check("concurrency error code", body.error === "GATEWAY_CONCURRENCY_LIMIT");
  await mod.releaseLease(env, held);
  const after = await req("POST", "http://localhost/v1/nai/generate-image", okBody, authHeader(key.key));
  check("after release -> 200", after.status === 200);
  const leases = await DB.prepare("SELECT COUNT(*) AS c FROM concurrency_leases WHERE gateway_key_id=?").bind(key.record.id).first();
  check("lease released (no leak)", leases.c === 0);
}

/* ================= 4. allowed_models ================= */
section("4. allowed_models -> 403");
{
  const key = await makeKey({ name: "models", policy: { allowed_models: ["only-this-model"] } });
  const body = JSON.stringify({ model: "other-model", prompt: "x" });
  const res = await req("POST", "http://localhost/v1/nai/generate-image", body, authHeader(key.key));
  check("model not in whitelist -> 403", res.status === 403);
  const err = await res.json();
  check("model restricted code", err.error === "GATEWAY_MODEL_RESTRICTED");

  const allowed = JSON.stringify({ model: "only-this-model", prompt: "x" });
  const ok = await req("POST", "http://localhost/v1/nai/generate-image", allowed, authHeader(key.key));
  check("model in whitelist -> 200", ok.status === 200);
}

/* ================= 5. fixed_parameters 合并 ================= */
section("5. restricted fixed_parameters merge");
{
  const key = await makeKey({
    name: "fixed",
    policy: { parameter_mode: "fixed", fixed_parameters: { steps: 99, scale: 7 } }
  });
  fetchCalls = [];
  const body = JSON.stringify({ model: "nai-diffusion-4-5-full", prompt: "x", parameters: { steps: 10 } });
  const res = await req("POST", "http://localhost/v1/nai/generate-image", body, authHeader(key.key));
  check("fixed-mode request -> 200", res.status === 200);
  const sent = fetchCalls.at(-1).bodyJson;
  check("upstream body carries fixed steps=99", sent.parameters.steps === 99);
  check("upstream body carries fixed scale=7", sent.parameters.scale === 7);
  check("non-fixed param preserved", sent.parameters.n_samples === 1);
  check("upstream auth uses account token", fetchCalls.at(-1).auth === "Bearer tok-gw");
}

/* ================= 6. 响应头 + request_logs ================= */
section("6. response headers + request_logs.gateway_key_id");
{
  const key = await makeKey({ name: "headers" });
  const res = await req("POST", "http://localhost/v1/nai/generate-image", okBody, authHeader(key.key));
  check("response 200", res.status === 200);
  check("X-Account-Id present", res.headers.get("X-Account-Id") === "gw-acc");
  check("X-Gateway-Attempts present", res.headers.get("X-Gateway-Attempts") === "1");
  const rid = res.headers.get("X-Gateway-Request-Id");
  check("X-Gateway-Request-Id present", typeof rid === "string" && rid.length > 0);
  check("Cache-Control no-store", res.headers.get("Cache-Control") === "no-store");
  const log = await DB.prepare("SELECT gateway_key_id, mode, cost_gems, ok FROM request_logs WHERE request_id=?").bind(rid).first();
  check("request_logs.gateway_key_id written", log.gateway_key_id === key.record.id);
  check("request_logs.mode written", log.mode === "restricted");
  check("request_logs.cost_gems written", log.cost_gems === 2);
  const attempt = await DB.prepare("SELECT gateway_key_id FROM request_attempts WHERE request_id=?").bind(rid).first();
  check("request_attempts.gateway_key_id written", attempt.gateway_key_id === key.record.id);
  const usage = await DB.prepare("SELECT gem_count FROM daily_usage WHERE gateway_key_id=?").bind(key.record.id).first();
  check("gem_count accumulated from cost_gems", usage.gem_count === 2);
}

/* ================= 7. OpenAI 形状 + /generate 二进制 ================= */
section("7. /v1/images/generations (OpenAI) + /generate (binary)");
{
  const key = await makeKey({ name: "openai" });
  const body = JSON.stringify({ model: "nai-diffusion-4-5-full", prompt: "a dog", n: 1, size: "1024x1024" });
  const res = await req("POST", "http://localhost/v1/images/generations", body, authHeader(key.key));
  check("openai route -> 200", res.status === 200);
  const json = await res.json();
  check("openai shape has created (number)", typeof json.created === "number");
  check("openai shape data[0].b64_json", json.data[0].b64_json === IMG_B64);

  // GET /generate with ?token= (下游魔改版兼容)
  const genRes = await req("GET", `http://localhost/generate?tag=hello&token=${encodeURIComponent(key.key)}&model=nai-diffusion-4-5-full&size=832x1216`);
  check("/generate with ?token -> 200", genRes.status === 200);
  check("/generate content-type image/png", genRes.headers.get("Content-Type") === "image/png");
  const bytes = new Uint8Array(await genRes.arrayBuffer());
  check("/generate returns image binary", Buffer.from(bytes).equals(IMG_BYTES));
  check("/generate has X-Account-Id", genRes.headers.get("X-Account-Id") === "gw-acc");

  const badToken = await req("GET", "http://localhost/generate?tag=x&token=dwb-nope");
  check("/generate bad ?token -> 401", badToken.status === 401);
}

/* ================= 8. OPTIONS 预检 ================= */
section("8. OPTIONS preflight");
{
  const res = await req("OPTIONS", "http://localhost/v1/nai/generate-image");
  check("OPTIONS -> 204", res.status === 204);
  check("CORS allow-origin *", res.headers.get("Access-Control-Allow-Origin") === "*");
  check("CORS allow-methods", (res.headers.get("Access-Control-Allow-Methods") ?? "").includes("POST"));
  check("CORS allow-headers", (res.headers.get("Access-Control-Allow-Headers") ?? "").includes("Authorization"));
  const genOpts = await req("OPTIONS", "http://localhost/generate");
  check("/generate OPTIONS -> 204", genOpts.status === 204);
  const norm = await req("POST", "http://localhost/v1/nai/generate-image", okBody, authHeader((await makeKey({ name: "cors" })).key));
  check("normal response carries CORS header", norm.headers.get("Access-Control-Allow-Origin") === "*");
}

globalThis.fetch = originalFetch;
console.log(`\nselftest-gateway: ${passed} checks passed`);
