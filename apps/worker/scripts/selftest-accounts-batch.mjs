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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-accounts-batch-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { accounts } from "${abs("routes/accounts.ts")}";`,
    `export { createAccount, getAccount, getAccountSecret, updateAccount } from "${abs("db/accounts.ts")}";`,
    `export { createUpstream } from "${abs("db/upstreams.ts")}";`,
    `export { Hono } from "hono";`
  ].join("\n")
);
const bundle = path.join(tmp, "bundle.mjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundle,
  nodePaths: [path.join(here, "..", "node_modules")],
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

/* ---------- 3. owner-authenticated Hono app ---------- */
const { Hono } = mod;
function makeApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("role", "owner");
    await next();
  });
  app.route("/api/accounts", mod.accounts);
  return app;
}
const app = makeApp();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function post(path, body) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, env);
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

/* ================= 1. provision_all by ids ================= */
section("1. provision_all with explicit ids");
{
  const up = await mod.createUpstream(env, { name: "nai-a", type: "nai-compatible", base_url: "https://nai-a.example" });
  const a1 = await mod.createAccount(env, { upstream_id: up.id, username: "a1", jwt: "jwt-a1", password: "pw" });
  const a2 = await mod.createAccount(env, { upstream_id: up.id, username: "a2", jwt: "jwt-a2", password: "pw" });

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization ?? "" });
    if (String(url).includes("/api/ynai/tokens")) {
      const name = JSON.parse(init.body).name;
      return jsonResponse({ data: { token: `tok-${name}` } });
    }
    return jsonResponse({ error: "no_route" }, 404);
  };
  try {
    const res = await post("/api/accounts/provision_all", { ids: [a1.id, a2.id] });
    const data = await res.json();
    check("status 200", res.status === 200);
    check("total=2", data.total === 2);
    check("success=2", data.success === 2);
    check("failed=0", data.failed === 0);
    check("items carry username+ok", data.items.every((i) => i.ok === true && i.has_api_token === true));
    check("two upstream calls", calls.filter((c) => c.url.endsWith("/api/ynai/tokens")).length === 2);
    const s1 = await mod.getAccountSecret(env, a1.id);
    check("a1 api token persisted", typeof s1.apiToken === "string" && s1.apiToken.startsWith("tok-DW-"));
    const s2 = await mod.getAccountSecret(env, a2.id);
    check("a2 api token persisted", typeof s2.apiToken === "string" && s2.apiToken.startsWith("tok-DW-"));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/* ================= 2. provision_all error isolation ================= */
section("2. provision_all isolates per-account errors");
{
  const up = await mod.createUpstream(env, { name: "nai-b", type: "nai-compatible", base_url: "https://nai-b.example" });
  const good = await mod.createAccount(env, { upstream_id: up.id, username: "good", jwt: "jwt-good" });
  const noJwt = await mod.createAccount(env, { upstream_id: up.id, username: "no-jwt" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/ynai/tokens")) return jsonResponse({ data: { token: "tok-ok" } });
    return jsonResponse({ error: "no_route" }, 404);
  };
  try {
    const res = await post("/api/accounts/provision_all", { ids: [good.id, noJwt.id] });
    const data = await res.json();
    check("status 200", res.status === 200);
    check("total=2", data.total === 2);
    check("success=1", data.success === 1);
    check("failed=1", data.failed === 1);
    const bad = data.items.find((i) => i.id === noJwt.id);
    check("failed item ok=false has_api_token=false", bad && bad.ok === false && bad.has_api_token === false);
    check("failed item has error message", bad && typeof bad.error === "string" && bad.error.length > 0);
    const goodItem = data.items.find((i) => i.id === good.id);
    check("good item ok=true", goodItem && goodItem.ok === true);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/* ================= 3. provision_all by upstream filter ================= */
section("3. provision_all without ids honours upstream + enabled filter");
{
  const up = await mod.createUpstream(env, { name: "nai-c", type: "nai-compatible", base_url: "https://nai-c.example" });
  const other = await mod.createUpstream(env, { name: "nai-d", type: "nai-compatible", base_url: "https://nai-d.example" });
  const enabled = await mod.createAccount(env, { upstream_id: up.id, username: "enabled", jwt: "jwt-e" });
  const disabled = await mod.createAccount(env, { upstream_id: up.id, username: "disabled", jwt: "jwt-d" });
  await mod.updateAccount(env, disabled.id, { enabled: false });
  const otherAcc = await mod.createAccount(env, { upstream_id: other.id, username: "other", jwt: "jwt-o" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/ynai/tokens")) return jsonResponse({ data: { token: "tok-x" } });
    return jsonResponse({ error: "no_route" }, 404);
  };
  try {
    const res = await post("/api/accounts/provision_all", { upstream_id: up.id });
    const data = await res.json();
    check("only enabled account in upstream targeted", data.total === 1 && data.items[0].id === enabled.id);
    const otherSecret = await mod.getAccountSecret(env, otherAcc.id);
    check("other upstream untouched", !otherSecret?.apiToken);
    const disabledSecret = await mod.getAccountSecret(env, disabled.id);
    check("disabled account untouched", !disabledSecret?.apiToken);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/* ================= 4. batch_delete ================= */
section("4. batch_delete");
{
  const up = await mod.createUpstream(env, { name: "nai-del", type: "nai-compatible", base_url: "https://nai-del.example" });
  const d1 = await mod.createAccount(env, { upstream_id: up.id, username: "d1", jwt: "jwt-d1" });
  const d2 = await mod.createAccount(env, { upstream_id: up.id, username: "d2", jwt: "jwt-d2" });
  const keep = await mod.createAccount(env, { upstream_id: up.id, username: "keep", jwt: "jwt-k" });

  const res = await post("/api/accounts/batch_delete", { ids: [d1.id, d2.id] });
  const data = await res.json();
  check("status 200", res.status === 200);
  check("deleted=2", data.deleted === 2);
  check("items report ok", data.items.length === 2 && data.items.every((i) => i.ok === true));
  check("d1 gone", (await mod.getAccount(env, d1.id)) === null);
  check("d2 gone", (await mod.getAccount(env, d2.id)) === null);
  check("kept account remains", (await mod.getAccount(env, keep.id)) !== null);

  const empty = await post("/api/accounts/batch_delete", { ids: [] });
  check("empty ids -> 400", empty.status === 400);

  const invalid = await post("/api/accounts/batch_delete", { ids: [123, null, ""] });
  check("non-string/computed ids -> 400", invalid.status === 400);

  const missing = await post("/api/accounts/batch_delete", {});
  check("missing ids -> 400", missing.status === 400);
}

/* ================= 5. provision_all reuses existing keys ================= */
section("5. provision_all skips accounts that already have api tokens");
{
  const up = await mod.createUpstream(env, { name: "nai-reuse", type: "nai-compatible", base_url: "https://nai-reuse.example" });
  const hasKey = await mod.createAccount(env, { upstream_id: up.id, username: "has-key", jwt: "jwt-hk", apiToken: "existing-token" });
  const missing = await mod.createAccount(env, { upstream_id: up.id, username: "missing", jwt: "jwt-miss" });

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url) });
    if (String(url).includes("/api/ynai/tokens")) return jsonResponse({ data: { token: "tok-new" } });
    return jsonResponse({ error: "no_route" }, 404);
  };
  try {
    const res = await post("/api/accounts/provision_all", { ids: [hasKey.id, missing.id] });
    const data = await res.json();
    check("status 200", res.status === 200);
    check("total=2", data.total === 2);
    check("success=1 (only missing created)", data.success === 1);
    check("skipped=1 (existing reused)", data.skipped === 1);
    check("failed=0", data.failed === 0);
    const skippedItem = data.items.find((i) => i.id === hasKey.id);
    check("existing account marked skipped", skippedItem && skippedItem.skipped === true && skippedItem.ok === true);
    const createdItem = data.items.find((i) => i.id === missing.id);
    check("missing account marked created", createdItem && createdItem.skipped === false && createdItem.ok === true);
    check("only one upstream token call", calls.filter((c) => c.url.endsWith("/api/ynai/tokens")).length === 1);
    const existingSecret = await mod.getAccountSecret(env, hasKey.id);
    check("existing token untouched", existingSecret.apiToken === "existing-token");
    const newSecret = await mod.getAccountSecret(env, missing.id);
    check("missing account got new token", newSecret.apiToken === "tok-new");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log(`\nselftest-accounts-batch: ${passed} checks passed`);
