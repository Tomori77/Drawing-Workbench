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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-meta-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { gallery } from "${abs("routes/gallery.ts")}";`,
    `export { generate, inboundToCanonical, persistGeneration } from "${abs("routes/generate.ts")}";`
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
    }
  };
}

/* ---------- 4. harness ---------- */
function sessionMiddleware(c, next) {
  const role = c.req.header("X-Test-Role");
  if (role) c.set("role", role);
  const sid = c.req.header("X-Test-Sid");
  if (sid) c.set("sid", sid);
  return next();
}

const { Hono } = await import("hono");

const DB = makeD1();
await applyMigrations({ exec: (sql) => DB._raw.exec(sql) });
const BUCKET = makeR2();
const env = { DB, BUCKET, ENCRYPTION_KEY: "dev-only-encryption-key-0123456789", SESSION_SECRET: "s", APP_ENV: "test" };

const app = new Hono();
app.use("*", sessionMiddleware);
app.route("/api/gallery", mod.gallery);
app.route("/api/generate", mod.generate);

async function req(method, url, body, headers = {}) {
  return app.request(url, { method, body, headers }, env);
}

function pngB64(bytes = "pngbytes") {
  return Buffer.from(bytes).toString("base64");
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

async function seedUpstreamAndAccount(upstreamId, accountId) {
  await DB.prepare(
    "INSERT INTO upstreams (id, name, type, base_url, priority, enabled, created_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(upstreamId, upstreamId, "nai-compatible", "https://example.test", 1, 1, "2026-01-01T00:00:00.000Z")
    .run();
  await DB.prepare(
    "INSERT INTO accounts (id, upstream_id, label, username, gems_last, enabled, status, failure_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(accountId, upstreamId, null, accountId, null, 1, "active", 0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    .run();
}
await seedUpstreamAndAccount("up-new", "acc-new");
await seedUpstreamAndAccount("up-old", "acc-old");

/* ================= 1. persistGeneration 存完整 canonical ================= */
section("1. persistGeneration 落库完整 canonical");
let newAssetId;
{
  const canonical = mod.inboundToCanonical({
    model: "nai-diffusion-4-5-full",
    action: "img2img",
    prompt: "1girl, solo",
    negative_prompt: "lowres",
    parameters: { steps: 30, scale: 6.5, seed: 4242, sampler: "k_euler", noise_schedule: "karras", width: 832, height: 1216 },
    n: 2
  });
  const result = { ok: true, upstream_id: "up-new", account_id: "acc-new", cost_gems: 12, images: [{ b64: pngB64("new-img") }] };
  const persisted = await mod.persistGeneration(env, canonical, result, "friend", "sid-new");
  newAssetId = persisted.images[0].id;

  const genRow = await DB.prepare("SELECT params_json FROM generations WHERE id=?").bind(persisted.generation_id).first();
  const stored = JSON.parse(genRow.params_json);
  check("params_json stores full canonical (has prompt)", stored.prompt && stored.prompt.positive === "1girl, solo");
  check("params_json stores model", stored.model === "nai-diffusion-4-5-full");
  check("params_json stores action", stored.action === "img2img");
  check("params_json stores n", stored.n === 2);
  check("params_json stores nested params", stored.params && stored.params.steps === 30);
}

/* ================= 2. 新格式 meta 解析 ================= */
section("2. GET /api/gallery/:id/meta 新格式");
{
  const res = await req("GET", `http://localhost/api/gallery/${newAssetId}/meta`, undefined, { "X-Test-Role": "friend", "X-Test-Sid": "sid-new" });
  check("meta 200", res.status === 200);
  const body = await res.json();
  check("meta id matches", body.id === newAssetId);
  check("meta owner_sid", body.owner_sid === "sid-new");
  check("meta model", body.model === "nai-diffusion-4-5-full");
  check("meta action", body.action === "img2img");
  check("meta prompt positive", body.prompt.positive === "1girl, solo");
  check("meta prompt negative", body.prompt.negative === "lowres");
  check("meta n", body.n === 2);
  check("meta params sampler", body.params.sampler === "k_euler");
  check("meta params steps", body.params.steps === 30);
  check("meta params seed", body.params.seed === 4242);
  check("meta width from params fallback", body.width === 832 && body.height === 1216);
  check("meta upstream_id", body.upstream_id === "up-new");
  check("meta cost_gems", body.cost_gems === 12);
  check("meta role", body.role === "friend");
  check("meta url + thumb_url", body.url === `/api/gallery/i/${newAssetId}` && body.thumb_url === null);
  check("meta mime", body.mime === "image/png");
}

/* ================= 3. 旧格式回退 ================= */
section("3. 旧格式（扁平 params）回退");
{
  const assetId = "legacy-asset";
  const genId = "legacy-gen";
  await DB.prepare(
    "INSERT INTO generations (id, key_id, role, upstream_id, account_id, params_json, status, cost_gems, created_at, owner_sid) VALUES (?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      genId,
      null,
      "owner",
      "up-old",
      "acc-old",
      JSON.stringify({ width: 512, height: 512, steps: 20, negative_prompt: "old-negative", n_samples: 4, seed: 1 }),
      "success",
      3,
      "2026-01-02T00:00:00.000Z",
      "owner"
    )
    .run();
  await DB.prepare(
    "INSERT INTO assets (id, generation_id, r2_key, thumb_r2_key, mime, width, height, created_at, owner_sid, size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(assetId, genId, `img/${assetId}`, null, "image/png", null, null, "2026-01-02T00:00:00.000Z", "owner", 10)
    .run();

  const res = await req("GET", `http://localhost/api/gallery/${assetId}/meta`, undefined, { "X-Test-Role": "owner", "X-Test-Sid": "owner" });
  check("legacy meta 200", res.status === 200);
  const body = await res.json();
  check("legacy model null", body.model === null);
  check("legacy action null", body.action === null);
  check("legacy positive empty", body.prompt.positive === "");
  check("legacy negative from negative_prompt", body.prompt.negative === "old-negative");
  check("legacy n from n_samples", body.n === 4);
  check("legacy params is whole object", body.params.steps === 20 && body.params.negative_prompt === "old-negative");
  check("legacy width/height from params", body.width === 512 && body.height === 512);
  check("legacy upstream_id preserved", body.upstream_id === "up-old");
  check("legacy cost_gems preserved", body.cost_gems === 3);
}

/* ================= 4. 越权 ================= */
section("4. 分区越权");
{
  const cross = await req("GET", `http://localhost/api/gallery/${newAssetId}/meta`, undefined, { "X-Test-Role": "friend", "X-Test-Sid": "other-sid" });
  check("friend cross-sid meta 404", cross.status === 404);

  const owner = await req("GET", `http://localhost/api/gallery/${newAssetId}/meta`, undefined, { "X-Test-Role": "owner", "X-Test-Sid": "owner" });
  check("owner can read any meta", owner.status === 200);

  const anon = await req("GET", `http://localhost/api/gallery/${newAssetId}/meta`);
  check("anonymous meta 401", anon.status === 401);

  const missing = await req("GET", "http://localhost/api/gallery/nope/meta", undefined, { "X-Test-Role": "owner", "X-Test-Sid": "owner" });
  check("missing asset meta 404", missing.status === 404);
}

/* ================= 5. assets.width/height 优先 ================= */
section("5. width/height 优先取 assets");
{
  await DB.prepare("UPDATE assets SET width=?, height=? WHERE id=?").bind(640, 960, newAssetId).run();
  const res = await req("GET", `http://localhost/api/gallery/${newAssetId}/meta`, undefined, { "X-Test-Role": "friend", "X-Test-Sid": "sid-new" });
  const body = await res.json();
  check("assets size overrides params", body.width === 640 && body.height === 960);
}

console.log(`\nselftest-gallery-meta: ${passed} checks passed`);
