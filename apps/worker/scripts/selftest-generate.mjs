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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-gen-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { runPipeline } from "${abs("pipeline/run.ts")}";`,
    `export { naiAdapter } from "${abs("pipeline/adapters/nai.ts")}";`,
    `export { createUpstream } from "${abs("db/upstreams.ts")}";`,
    `export { encrypt } from "${abs("lib/crypto.ts")}";`,
    `export { generate, inboundToCanonical, persistGeneration, mapUpstreamError } from "${abs("routes/generate.ts")}";`,
    `export { gallery } from "${abs("routes/gallery.ts")}";`
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
  for (const name of ["0001_init.sql", "0002_gateway.sql", "0003_checkin.sql"]) {
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
      return {
        objects: all.map((key) => ({ key })),
        truncated: false,
        cursor: undefined
      };
    },
    _keys: () => [...objects.keys()]
  };
}

/* ---------- 4. harness: session + origin middleware ---------- */
function sessionMiddleware(c, next) {
  const role = c.req.header("X-Test-Role");
  if (role) c.set("role", role);
  return next();
}

/* ---------- 5. tiny Hono app using the real sub-apps ---------- */
const { Hono } = await import("hono");

const DB = makeD1();
await applyMigrations({ exec: (sql) => DB._raw.exec(sql) });
const BUCKET = makeR2();
const ENCRYPTION_KEY = "dev-only-encryption-key-0123456789";
const env = { DB, BUCKET, ENCRYPTION_KEY, SESSION_SECRET: "s", APP_ENV: "test" };

const app = new Hono();
app.use("*", sessionMiddleware);
app.route("/api/generate", mod.generate);
app.route("/api/gallery", mod.gallery);

async function req(method, url, body, headers = {}) {
  return app.request(url, { method, body, headers }, env);
}

function jsonHeaders(extra = {}) {
  return { "Content-Type": "application/json", "X-Test-Role": "owner", ...extra };
}

/* ---------- 6. seed upstream + accounts ---------- */
function pngB64(bytes = "pngbytes") {
  return Buffer.from(bytes).toString("base64");
}

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
  name: "nai",
  type: "nai-compatible",
  base_url: "https://nai.example",
  priority: 10,
  capabilities: { account_strategy: "fixed" }
});

let passed = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  ok  ${name}`);
};
function section(title) {
  console.log(`\n${title}`);
}

/* ================= 1. 成功路径 ================= */
section("1. pipeline success -> R2 + generations/assets");
{
  await insertAccountRow("acc-ok", { upstreamId: up.id, username: "ok", secret: { apiToken: "tok-ok" } });
  const imageBytes = Buffer.from("PNGDATA-1234");
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ images: [imageBytes.toString("base64")], job: { cost_gems: 7 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const canonical = mod.inboundToCanonical({ model: "nai-diffusion-4-5-full", prompt: "a cat", n: 1 });
  const result = await mod.runPipeline(canonical, { env, fetch: fetchImpl });
  check("pipeline ok", result.ok === true);
  check("uses account apiToken as Bearer", fetchCalls[0].auth === "Bearer tok-ok");
  check("cost_gems parsed from body", result.cost_gems === 7);
  check("account_id recorded", result.account_id === "acc-ok");

  const persisted = await mod.persistGeneration(env, canonical, result, "owner");
  check("one asset returned", persisted.images.length === 1);
  const assetId = persisted.images[0].id;
  const assetRow = await DB.prepare("SELECT * FROM assets WHERE id=?").bind(assetId).first();
  check("assets row written", assetRow && assetRow.r2_key === `img/${assetId}`);
  check("R2 object written", BUCKET._keys().includes(`img/${assetId}`));
  const genRow = await DB.prepare("SELECT * FROM generations WHERE id=?").bind(persisted.generation_id).first();
  check("generations row status=single success", genRow && genRow.status === "success" && genRow.role === "owner");
  check("generations cost_gems stored", genRow.cost_gems === 7);

  const res = await req("POST", "http://localhost/api/generate", JSON.stringify({ prompt: "a cat" }), jsonHeaders());
  // route-level test uses its own account pool; just assert status mapping separately below.
  void res;
}

/* ================= 2. 失败转号 429 -> 第二个成功 ================= */
section("2. failover 429 -> next account succeeds");
{
  const up2 = await mod.createUpstream(env, {
    name: "nai2",
    type: "nai-compatible",
    base_url: "https://nai2.example",
    priority: 100,
    capabilities: { account_strategy: "fixed" }
  });
  await insertAccountRow("first", { upstreamId: up2.id, username: "first", secret: { apiToken: "tok-first" } });
  await insertAccountRow("second", { upstreamId: up2.id, username: "second", secret: { apiToken: "tok-second" } });

  const seen = [];
  const fetchImpl = async (url, init) => {
    const auth = init.headers.Authorization;
    seen.push(auth);
    if (auth === "Bearer tok-first") {
      return new Response(JSON.stringify({ detail: "rate limited" }), { status: 429, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ images: [pngB64("ok2")], job: { cost_gems: 3 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const canonical = mod.inboundToCanonical({ prompt: "x", model: "m" });
  const result = await mod.runPipeline(canonical, {
    env,
    fetch: fetchImpl,
    selectUpstreams: (list) => list.filter((u) => u.id === up2.id)
  });
  check("fails over to second account", result.ok === true && result.account_id === "second");
  check("first account attempted with its token", seen[0] === "Bearer tok-first");
  check("second account attempted with its token", seen[1] === "Bearer tok-second");
  check("attempts count is 2", result.attempts === 2);

  const attemptRows = await DB.prepare("SELECT attempt_no, status_code, account_id FROM request_attempts WHERE request_id=? ORDER BY attempt_no").bind(result.request_id).all();
  check("request_attempts has two rows", attemptRows.results.length === 2);
  check("attempt 1 status 429", attemptRows.results[0].status_code === 429);
  check("attempt 2 status 200", attemptRows.results[1].status_code === 200);
  const logRow = await DB.prepare("SELECT ok, status_code FROM request_logs WHERE request_id=?").bind(result.request_id).first();
  check("request_logs terminal success", logRow && logRow.ok === 1 && logRow.status_code === 200);
}

/* ================= 3. 4xx 不转号 ================= */
section("3. 4xx does not fail over");
{
  const up3 = await mod.createUpstream(env, {
    name: "nai3",
    type: "nai-compatible",
    base_url: "https://nai3.example",
    priority: 200,
    capabilities: { account_strategy: "fixed" }
  });
  await insertAccountRow("r1", { upstreamId: up3.id, username: "r1", secret: { apiToken: "tok-r1" } });
  await insertAccountRow("r2", { upstreamId: up3.id, username: "r2", secret: { apiToken: "tok-r2" } });

  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers.Authorization);
    return new Response(JSON.stringify({ detail: "bad prompt" }), { status: 400, headers: { "Content-Type": "application/json" } });
  };
  const canonical = mod.inboundToCanonical({ prompt: "x", model: "m" });
  const result = await mod.runPipeline(canonical, {
    env,
    fetch: fetchImpl,
    selectUpstreams: (list) => list.filter((u) => u.id === up3.id)
  });
  check("4xx returns not ok", result.ok === false);
  check("only one attempt (no failover)", result.attempts === 1);
  check("only first account contacted", seen.length === 1);
  const mapped = mod.mapUpstreamError(result);
  check("4xx mapped to 400", mapped.status === 400);
}

/* ================= 4. 413 超大响应 ================= */
section("4. oversized upstream response -> 413");
{
  const up4 = await mod.createUpstream(env, {
    name: "nai4",
    type: "nai-compatible",
    base_url: "https://nai4.example",
    priority: 300,
    capabilities: { account_strategy: "fixed" }
  });
  await insertAccountRow("big", { upstreamId: up4.id, username: "big", secret: { apiToken: "tok-big" } });

  const bigB64 = Buffer.from("A".repeat(2000)).toString("base64");
  const fetchImpl = async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ images: [bigB64] })));
        controller.close();
      }
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const canonical = mod.inboundToCanonical({ prompt: "x", model: "m" });
  const result = await mod.runPipeline(canonical, {
    env,
    fetch: fetchImpl,
    maxBytes: 100,
    selectUpstreams: (list) => list.filter((u) => u.id === up4.id)
  });
  check("oversized flagged", result.ok === false && result.error?.code === "UPSTREAM_RESPONSE_TOO_LARGE");
  check("oversized maps to 413", mod.mapUpstreamError(result).status === 413);
}

/* ================= 5. 画廊 API ================= */
section("5. gallery list / get / delete");
{
  const canonical = mod.inboundToCanonical({ prompt: "gallery", model: "m" });
  const result = {
    ok: true,
    upstream_id: up.id,
    account_id: "acc-ok",
    cost_gems: 0,
    images: [{ b64: pngB64("g1") }, { b64: pngB64("g2") }]
  };
  const persisted = await mod.persistGeneration(env, canonical, result, "friend");

  const listRes = await req("GET", "http://localhost/api/gallery?limit=10", undefined, { "X-Test-Role": "friend" });
  check("list returns 200", listRes.status === 200);
  const listBody = await listRes.json();
  check("list has items + total", Array.isArray(listBody.items) && typeof listBody.total === "number");
  check("list item has url + generation_id", Boolean(listBody.items[0].url) && Boolean(listBody.items[0].generation_id));

  const assetId = persisted.images[0].id;
  const imgRes = await req("GET", `http://localhost/api/gallery/i/${assetId}`, undefined, { "X-Test-Role": "friend" });
  check("image returns 200", imgRes.status === 200);
  check("image has immutable cache", imgRes.headers.get("Cache-Control") === "public, max-age=31536000, immutable");
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  check("image bytes match", Buffer.from(bytes).toString() === "g1");

  const thumbRes = await req("GET", `http://localhost/api/gallery/i/${assetId}?t=thumb`, undefined, { "X-Test-Role": "friend" });
  check("missing thumb 404", thumbRes.status === 404);

  const beforeCount = listBody.total;
  const delRes = await req("DELETE", `http://localhost/api/gallery/${assetId}`, undefined, { "X-Test-Role": "owner" });
  check("delete returns ok", delRes.status === 200);
  const afterRes = await req("GET", "http://localhost/api/gallery", undefined, { "X-Test-Role": "friend" });
  const afterBody = await afterRes.json();
  check("list count decreases", afterBody.total === beforeCount - 1);
  const goneRes = await req("GET", `http://localhost/api/gallery/i/${assetId}`, undefined, { "X-Test-Role": "friend" });
  check("deleted image gone", goneRes.status === 404);
}

/* ================= 6. 鉴权 + Origin ================= */
section("6. session guard + origin guard");
{
  const anon = await req("GET", "http://localhost/api/gallery");
  check("gallery without session 401", anon.status === 401);
  const genAnon = await req("POST", "http://localhost/api/generate", JSON.stringify({ prompt: "x" }), { "Content-Type": "application/json" });
  check("generate without session 401", genAnon.status === 401);

  const evil = await req("DELETE", "http://localhost/api/gallery/foo", undefined, { "X-Test-Role": "owner", Origin: "https://evil.example" });
  check("cross-origin write 403", evil.status === 403);

  const noOrigin = await req("DELETE", "http://localhost/api/gallery/foo", undefined, { "X-Test-Role": "owner" });
  check("origin missing is allowed (404 not 403)", noOrigin.status === 404);
}

/* ================= 7. POST /api/generate 端到端（stub 全局 fetch） ================= */
section("7. POST /api/generate end-to-end");
{
  const up7 = await mod.createUpstream(env, {
    name: "nai7",
    type: "nai-compatible",
    base_url: "https://nai7.example",
    priority: 100000,
    capabilities: { account_strategy: "fixed" }
  });
  await insertAccountRow("e2e", { upstreamId: up7.id, username: "e2e", secret: { apiToken: "tok-e2e" } });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).includes("/v1/nai/generate-image"), "routes to nai generate path");
    assert.equal(init.headers.Authorization, "Bearer tok-e2e");
    return new Response(JSON.stringify({ images: [pngB64("E2E-IMG")], job: { cost_gems: 5 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const res = await req(
      "POST",
      "http://localhost/api/generate",
      JSON.stringify({ model: "nai-diffusion-4-5-full", prompt: "hello world", size: "832x1216", n: 1 }),
      jsonHeaders()
    );
    check("route returns 200", res.status === 200);
    const body = await res.json();
    check("response has generation_id", typeof body.generation_id === "string" && body.generation_id.length > 0);
    check("response has no inline b64", !JSON.stringify(body).includes(pngB64("E2E-IMG")));
    check("response lists one image with url", body.images.length === 1);
    check("response reports cost_gems", body.cost_gems === 5);

    check("image url is relative", body.images[0].url.startsWith("/api/gallery/i/"));
    const objRes = await req("GET", `http://localhost${body.images[0].url}`, undefined, { "X-Test-Role": "friend" });
    check("generated image retrievable via gallery", objRes.status === 200);
    check("generated image bytes match", Buffer.from(new Uint8Array(await objRes.arrayBuffer())).toString() === "E2E-IMG");

    const genRow = await DB.prepare("SELECT * FROM generations WHERE id=?").bind(body.generation_id).first();
    check("generation persisted with role owner", genRow && genRow.role === "owner" && genRow.status === "success");
    check("generation recorded account", genRow.account_id === "e2e");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log(`\nselftest-generate: ${passed} checks passed`);
