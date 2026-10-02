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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-workspace-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { runPipeline } from "${abs("pipeline/run.ts")}";`,
    `export { selectAccounts } from "${abs("pool/select.ts")}";`,
    `export { markAccountFailure, markAccountSuccess, getCooldownConfig } from "${abs("pool/cooldown.ts")}";`,
    `export { createUpstream } from "${abs("db/upstreams.ts")}";`,
    `export { getAccount } from "${abs("db/accounts.ts")}";`,
    `export { encrypt } from "${abs("lib/crypto.ts")}";`,
    `export { getWorkspaceSettings, setWorkspaceSettings } from "${abs("pool/workspace.ts")}";`,
    `export { generate, inboundToCanonical } from "${abs("routes/generate.ts")}";`,
    `export { generateOptions } from "${abs("routes/generateOptions.ts")}";`
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
  for (const name of ["0001_init.sql", "0002_gateway.sql", "0003_checkin.sql", "0004_profile.sql", "0005_account_usage.sql", "0006_share_passwords.sql", "0007_presets.sql"]) {
    const sql = await readFile(path.join(here, "..", "migrations", name), "utf8");
    db.exec(sql);
  }
}

const DB = makeD1();
await applyMigrations({ exec: (sql) => DB._raw.exec(sql) });
const ENCRYPTION_KEY = "dev-only-encryption-key-0123456789";

function makeR2() {
  const objects = new Map();
  return {
    async put(key, value) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      objects.set(key, { bytes });
    },
    async get(key) {
      const obj = objects.get(key);
      if (!obj) return null;
      return { body: obj.bytes };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    }
  };
}

const env = { DB, BUCKET: makeR2(), ENCRYPTION_KEY, SESSION_SECRET: "s", APP_ENV: "test" };

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

const kv = async (key) =>
  (await DB.prepare("SELECT v FROM runtime_kv WHERE k=?").bind(key).first())?.v ?? null;

/* ---------- 3. Hono harness ---------- */
const { Hono } = await import("hono");
function sessionMiddleware(c, next) {
  const role = c.req.header("X-Test-Role");
  if (role) c.set("role", role);
  return next();
}
const app = new Hono();
app.use("*", sessionMiddleware);
app.route("/api/generate/options", mod.generateOptions);
app.route("/api/generate", mod.generate);

async function req(method, url, body, headers = {}) {
  return app.request(url, { method, body, headers }, env);
}
function jsonHeaders(role = "owner", extra = {}) {
  return { "Content-Type": "application/json", "X-Test-Role": role, ...extra };
}

/* ---------- 4. fake fetch ---------- */
const IMG_B64 = Buffer.from("PNGDATA-WS").toString("base64");
function makeFetch(handler) {
  return async (url, init) => {
    if (handler) return handler(url, init);
    return new Response(JSON.stringify({ images: [IMG_B64], job: { cost_gems: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
}

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

/* ================= 1. markAccountFailure status ================= */
section("1. markAccountFailure keeps status until cooldown threshold");
{
  const up = await mod.createUpstream(env, {
    name: "cooldown-ws",
    type: "nai-compatible",
    base_url: "https://nai.example"
  });
  await insertAccountRow("c1", { upstreamId: up.id, username: "c1", secret: { apiToken: "tok-c1" }, status: "active" });
  await insertAccountRow("c2", { upstreamId: up.id, username: "c2", secret: { apiToken: "tok-c2" }, status: "active" });

  const cfg = await mod.getCooldownConfig(env, up.id);
  check("default threshold is 3", cfg.threshold === 3);

  const f1 = await mod.markAccountFailure(env, "c1", 429, up.id);
  const row1 = await mod.getAccount(env, "c1");
  check("failure_count increments", f1.failure_count === 1);
  check("status NOT set to error before threshold", row1.status === "active");
  check("cooldown_until still null", row1.cooldown_until === null);

  await mod.markAccountFailure(env, "c1", 500, up.id);
  const row2 = await mod.getAccount(env, "c1");
  check("status stays active after 2nd failure", row2.status === "active");

  const f3 = await mod.markAccountFailure(env, "c1", 429, up.id);
  const row3 = await mod.getAccount(env, "c1");
  check("threshold hit sets cooldown_until", typeof f3.cooldown_until === "string");
  check("threshold hit sets status cooling", row3.status === "cooling");

  await insertAccountRow("c3", { upstreamId: up.id, username: "c3", secret: { apiToken: "tok-c3" }, status: "active" });
  for (let i = 0; i < 3; i += 1) await mod.markAccountFailure(env, "c3", 400, up.id);
  const rowC3 = await mod.getAccount(env, "c3");
  check("non-trigger code keeps status active", rowC3.status === "active" && rowC3.cooldown_until === null);

  await mod.markAccountSuccess(env, "c1");
  const rowC1 = await mod.getAccount(env, "c1");
  check("markAccountSuccess sets active + clears cooldown", rowC1.status === "active" && rowC1.cooldown_until === null);
}

/* ================= 2. selectAccounts cursorKey + accountId ================= */
section("2. selectAccounts cursorKey + pinned accountId");
{
  const up = await mod.createUpstream(env, {
    name: "select-ws",
    type: "nai-compatible",
    base_url: "https://nai.example",
    capabilities: { account_strategy: "round_robin" }
  });
  await insertAccountRow("a", { upstreamId: up.id, username: "a", secret: { apiToken: "tok-a" } });
  await insertAccountRow("b", { upstreamId: up.id, username: "b", secret: { apiToken: "tok-b" } });
  await insertAccountRow("c", { upstreamId: up.id, username: "c", secret: { apiToken: "tok-c" } });

  const keyA = "rr_cursor:workspace:test";
  const r1 = await mod.selectAccounts(env, up.id, "round_robin", { cursorKey: keyA });
  check("cursorKey 1st order a,b,c", r1.candidates.map((x) => x.account.id).join(",") === "a,b,c");
  const r2 = await mod.selectAccounts(env, up.id, "round_robin", { cursorKey: keyA });
  check("cursorKey advances a,b,c -> b,c,a", r2.candidates.map((x) => x.account.id).join(",") === "b,c,a");

  const keyB = "rr_cursor:other:test";
  const b1 = await mod.selectAccounts(env, up.id, "round_robin", { cursorKey: keyB });
  check("independent cursorKey starts fresh a,b,c", b1.candidates.map((x) => x.account.id).join(",") === "a,b,c");
  check("cursorKey values stored independently", (await kv(keyA)) === "2" && (await kv(keyB)) === "1");

  const pinned = await mod.selectAccounts(env, up.id, "round_robin", {
    cursorKey: keyA,
    accountId: "c"
  });
  check("pinned accountId moves target first", pinned.candidates.map((x) => x.account.id).join(",") === "c,a,b");

  const pinnedFixed = await mod.selectAccounts(env, up.id, "fixed", { accountId: "c" });
  check("accountId works with fixed strategy too", pinnedFixed.candidates.map((x) => x.account.id).join(",") === "c,a,b");
}

/* ================= 3. workspace vs gateway cursors ================= */
section("3. selectionScope workspace vs gateway cursors stay independent");
{
  const up = await mod.createUpstream(env, {
    name: "scope-ws",
    type: "nai-compatible",
    base_url: "https://nai.example",
    capabilities: { account_strategy: "round_robin" }
  });
  await insertAccountRow("s1", { upstreamId: up.id, username: "s1", secret: { apiToken: "tok-s1" } });
  await insertAccountRow("s2", { upstreamId: up.id, username: "s2", secret: { apiToken: "tok-s2" } });
  const canonical = mod.inboundToCanonical({ prompt: "scope", model: "m" });
  const fetchImpl = makeFetch();

  await mod.runPipeline(canonical, { env, fetch: fetchImpl, upstreamId: up.id, selectionScope: "workspace" });
  await mod.runPipeline(canonical, { env, fetch: fetchImpl, upstreamId: up.id, selectionScope: "workspace" });
  await mod.runPipeline(canonical, { env, fetch: fetchImpl, upstreamId: up.id, selectionScope: "gateway" });

  const wsKey = `rr_cursor:workspace:${up.id}`;
  const gwKey = `rr_cursor:gateway:${up.id}`;
  check("workspace cursor key incremented twice", (await kv(wsKey)) === "2");
  check("gateway cursor key incremented once", (await kv(gwKey)) === "1");
}

/* ================= 4. runPipeline upstreamId ================= */
section("4. runPipeline upstreamId selection / NO_UPSTREAM");
{
  const upA = await mod.createUpstream(env, {
    name: "pinA",
    type: "nai-compatible",
    base_url: "https://nai.example",
    priority: 500,
    capabilities: { account_strategy: "fixed" }
  });
  await insertAccountRow("pin-a", { upstreamId: upA.id, username: "pin-a", secret: { apiToken: "tok-pin-a" } });
  const upB = await mod.createUpstream(env, {
    name: "pinB",
    type: "nai-compatible",
    base_url: "https://nai.example",
    priority: 600,
    capabilities: { account_strategy: "fixed" }
  });
  await insertAccountRow("pin-b", { upstreamId: upB.id, username: "pin-b", secret: { apiToken: "tok-pin-b" } });

  const canonical = mod.inboundToCanonical({ prompt: "pin", model: "m" });
  let seen = null;
  const fetchImpl = makeFetch((url, init) => {
    seen = init.headers.Authorization;
    return new Response(JSON.stringify({ images: [IMG_B64], job: { cost_gems: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  const pinned = await mod.runPipeline(canonical, { env, fetch: fetchImpl, upstreamId: upA.id });
  check("upstreamId picks named upstream despite lower priority", pinned.upstream_id === upA.id);
  check("uses pinned upstream account token", seen === "Bearer tok-pin-a");

  const missing = await mod.runPipeline(canonical, { env, fetch: fetchImpl, upstreamId: "does-not-exist" });
  check("nonexistent upstreamId -> NO_UPSTREAM", missing.ok === false && missing.error?.code === "NO_UPSTREAM");

  const disabled = await mod.createUpstream(env, {
    name: "pinDisabled",
    type: "nai-compatible",
    base_url: "https://nai.example",
    enabled: false
  });
  const disabledResult = await mod.runPipeline(canonical, { env, fetch: fetchImpl, upstreamId: disabled.id });
  check("disabled upstreamId -> NO_UPSTREAM", disabledResult.ok === false && disabledResult.error?.code === "NO_UPSTREAM");
}

/* ================= 5. /api/generate/options ================= */
section("5. GET/PATCH /api/generate/options");
{
  const upModels = await mod.createUpstream(env, {
    name: "opts-empty",
    type: "nai-compatible",
    base_url: "https://nai.example",
    priority: 900,
    models: [],
    capabilities: { account_strategy: "round_robin" }
  });
  await DB.prepare("INSERT INTO models (logical_name, upstream_id, upstream_model, enabled) VALUES (?,?,?,1)")
    .bind("logical-x", upModels.id, "up-x")
    .run();
  await DB.prepare("INSERT INTO models (logical_name, upstream_id, upstream_model, enabled) VALUES (?,?,?,1)")
    .bind("logical-y", upModels.id, "up-y")
    .run();
  await insertAccountRow("opt-acc", {
    upstreamId: upModels.id,
    username: "opt",
    secret: { apiToken: "tok-opt" },
    gems: 11
  });

  const upCaps = await mod.createUpstream(env, {
    name: "opts-caps",
    type: "custom",
    base_url: "https://custom.example",
    priority: 800,
    models: ["cap-model"],
    capabilities: {
      samplers: ["s1", "s2"],
      noise_schedules: ["n1"],
      sizes: [{ label: "W", width: 640, height: 480 }],
      actions: [{ value: "gen", label: "生成" }]
    }
  });

  const ownerRes = await req("GET", "http://localhost/api/generate/options", undefined, { "X-Test-Role": "owner" });
  check("owner GET options 200", ownerRes.status === 200);
  const ownerBody = await ownerRes.json();
  check("returns enabled upstreams", ownerBody.upstreams.some((u) => u.id === upModels.id));
  const optsEmpty = ownerBody.upstreams.find((u) => u.id === upModels.id);
  check("models_json empty falls back to models table", optsEmpty.models.slice().sort().join(",") === "logical-x,logical-y");
  check("nai-compatible sampler defaults present", optsEmpty.samplers.length >= 10 && optsEmpty.samplers.includes("k_euler"));
  check("nai-compatible noise default present", optsEmpty.noise_schedules.includes("karras"));
  check("default sizes present (4)", optsEmpty.sizes.length === 4 && optsEmpty.sizes[0].width === 832);
  check("default actions present (3)", optsEmpty.actions.length === 3 && optsEmpty.actions[0].value === "generate");

  const optsCaps = ownerBody.upstreams.find((u) => u.id === upCaps.id);
  check("capabilities samplers override defaults", optsCaps.samplers.join(",") === "s1,s2");
  check("capabilities sizes override defaults", optsCaps.sizes.length === 1 && optsCaps.sizes[0].width === 640);
  check("unknown type keeps empty sampler default", optsCaps.samplers.length === 2);

  check("account_modes has 3 entries", ownerBody.account_modes.length === 3);
  check("owner sees accounts for selected upstream", Array.isArray(ownerBody.accounts));
  check("default settings account_mode auto", ownerBody.settings.account_mode === "auto");

  const friendRes = await req("GET", "http://localhost/api/generate/options", undefined, { "X-Test-Role": "friend" });
  check("friend GET options 200", friendRes.status === 200);
  const friendBody = await friendRes.json();
  check("friend sees no accounts", friendBody.accounts.length === 0);

  const anon = await req("GET", "http://localhost/api/generate/options");
  check("unauthenticated GET options 401", anon.status === 401);

  const badMode = await req("PATCH", "http://localhost/api/generate/options", JSON.stringify({ account_mode: "nope" }), jsonHeaders());
  check("PATCH invalid account_mode 400", badMode.status === 400);

  const badUpstream = await req("PATCH", "http://localhost/api/generate/options", JSON.stringify({ upstream_id: "nope" }), jsonHeaders());
  check("PATCH nonexistent upstream_id 400", badUpstream.status === 400);

  const badAccount = await req("PATCH", "http://localhost/api/generate/options", JSON.stringify({ account_id: "nope" }), jsonHeaders());
  check("PATCH nonexistent account_id 400", badAccount.status === 400);

  const friendPin = await req("PATCH", "http://localhost/api/generate/options", JSON.stringify({ account_id: "opt-acc" }), jsonHeaders("friend"));
  check("friend PATCH account_id 403", friendPin.status === 403);

  const patchRes = await req(
    "PATCH",
    "http://localhost/api/generate/options",
    JSON.stringify({ upstream_id: upModels.id, account_mode: "fixed", account_id: "opt-acc" }),
    jsonHeaders()
  );
  check("owner PATCH valid 200", patchRes.status === 200);
  const patchBody = await patchRes.json();
  check("PATCH returns settings", patchBody.settings.upstream_id === upModels.id && patchBody.settings.account_mode === "fixed" && patchBody.settings.account_id === "opt-acc");
  const persisted = await mod.getWorkspaceSettings(env);
  check("settings persisted to runtime_kv", persisted.upstream_id === upModels.id && persisted.account_mode === "fixed");

  const friendRes2 = await req("GET", "http://localhost/api/generate/options?upstream_id=" + upModels.id, undefined, { "X-Test-Role": "friend" });
  const friendBody2 = await friendRes2.json();
  check("friend still sees accounts=[] after patch", friendBody2.accounts.length === 0);
}

/* ================= 6. POST /api/generate ================= */
section("6. POST /api/generate fixed/auto");
{
  await mod.setWorkspaceSettings(env, { upstream_id: "", account_id: "", account_mode: "auto" });
  const up = await mod.createUpstream(env, {
    name: "gen-ws",
    type: "nai-compatible",
    base_url: "https://nai.example",
    priority: 9999,
    capabilities: { account_strategy: "round_robin" }
  });
  await insertAccountRow("gen-1", { upstreamId: up.id, username: "gen-1", secret: { apiToken: "tok-gen-1" } });
  await insertAccountRow("gen-2", { upstreamId: up.id, username: "gen-2", secret: { apiToken: "tok-gen-2" } });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetch();
  try {
    const fixedBad = await req(
      "POST",
      "http://localhost/api/generate",
      JSON.stringify({ prompt: "x", upstream_id: up.id, account_mode: "fixed" }),
      jsonHeaders()
    );
    check("fixed without account_id -> 400", fixedBad.status === 400);
    const fixedBody = await fixedBad.json();
    check("fixed missing account error code", fixedBody.error === "account_required");

    const fixedOk = await req(
      "POST",
      "http://localhost/api/generate",
      JSON.stringify({ prompt: "x", upstream_id: up.id, account_mode: "fixed", account_id: "gen-2" }),
      jsonHeaders()
    );
    check("fixed with account_id -> 200", fixedOk.status === 200);
    const fixedOkBody = await fixedOk.json();
    check("fixed uses the pinned account", fixedOkBody.account_id === "gen-2");

    const beforeWs = Number((await kv(`rr_cursor:workspace:${up.id}`)) ?? 0);
    const auto = await req(
      "POST",
      "http://localhost/api/generate",
      JSON.stringify({ prompt: "x", upstream_id: up.id, account_mode: "auto" }),
      jsonHeaders()
    );
    check("auto mode -> 200", auto.status === 200);
    const afterWs = Number((await kv(`rr_cursor:workspace:${up.id}`)) ?? 0);
    check("auto mode advances workspace cursor", afterWs === beforeWs + 1);
    check("auto mode does not touch gateway cursor", (await kv(`rr_cursor:gateway:${up.id}`)) === null);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log(`\nselftest-workspace: ${passed} checks passed`);
