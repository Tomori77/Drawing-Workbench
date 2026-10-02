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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-rw-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { modelGlob, matchRule, applyAction, applyRules, applyRulesWithLog, loadRules, RewriteBlockedError } from "${abs("rewrite/engine.ts")}";`,
    `export { isRewriteActionType, REWRITE_ACTION_TYPES, REWRITE_SCOPES } from "${abs("rewrite/types.ts")}";`,
    `export { createRewriteRule, listRewriteRules, getRewriteRule, updateRewriteRule, deleteRewriteRule } from "${abs("db/rewriteRules.ts")}";`,
    `export { runPipeline } from "${abs("pipeline/run.ts")}";`,
    `export { createUpstream } from "${abs("db/upstreams.ts")}";`,
    `export { encrypt } from "${abs("lib/crypto.ts")}";`,
    `export { rewriteRules } from "${abs("routes/rewriteRules.ts")}";`
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

let passed = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  ok  ${name}`);
};
function section(title) {
  console.log(`\n${title}`);
}

const base = () => ({
  model: "nai-diffusion-4-5-full",
  action: "generate",
  prompt: { positive: "1girl, smile", negative: "lowres" },
  params: { steps: 28 },
  references: [],
  n: 1
});
const rule = (scope, match, action, extra = {}) => ({
  id: extra.id ?? "r",
  scope,
  match,
  action,
  priority: extra.priority ?? 0,
  enabled: extra.enabled ?? true,
  created_at: extra.created_at ?? "2026-01-01T00:00:00.000Z"
});

/* ================= 1. matchRule 组合 ================= */
section("1. matchRule: glob/action/contains/regex + 不匹配");
{
  check("glob exact", mod.matchRule({ match: { model: "nai-diffusion-4-5-full" } }, base()));
  check("glob wildcard matches", mod.matchRule({ match: { model: "nai-diffusion-4-5-*" } }, base()));
  check("glob wildcard rejects", mod.matchRule({ match: { model: "sdxl-*" } }, base()) === false);
  check("modelGlob mid-star", mod.modelGlob("nai-*-full", "nai-diffusion-4-5-full"));
  check("modelGlob escaped dots", mod.modelGlob("nai-*-full", "naiXdiffusionX4X5Xfull") === false);

  check("action match", mod.matchRule({ match: { action: "generate" } }, base()));
  check("action mismatch", mod.matchRule({ match: { action: "img2img" } }, base()) === false);

  check("contains positive", mod.matchRule({ match: { contains: "smile" } }, base()));
  check("contains negative", mod.matchRule({ match: { contains: "lowres" } }, base()));
  check("contains absent", mod.matchRule({ match: { contains: "cat" } }, base()) === false);

  check("regex hit", mod.matchRule({ match: { regex: "\\d+girl" } }, base()));
  check("regex miss", mod.matchRule({ match: { regex: "^cat$" } }, base()) === false);
  check("regex scoped to negative", mod.matchRule({ match: { regex: "lowres", prompt_kind: "negative" } }, base()));
  check("regex scoped to positive rejects negative", mod.matchRule({ match: { regex: "lowres", prompt_kind: "positive" } }, base()) === false);

  check("AND: model+action+contains", mod.matchRule({ match: { model: "nai-*", action: "generate", contains: "smile" } }, base()));
  check("AND fails if one misses", mod.matchRule({ match: { model: "nai-*", action: "generate", contains: "nope" } }, base()) === false);
  check("min_n/max_n gate", mod.matchRule({ match: { min_n: 2 } }, base()) === false);
  check("min_n pass", mod.matchRule({ match: { min_n: 1, max_n: 3 } }, base()));
}

/* ================= 2. 提示词 prepend/append/replace ================= */
section("2. prompt: prepend/append/replace (positive/negative)");
{
  const prep = mod.applyAction({ type: "prepend", value: "masterpiece, " }, base());
  check("prepend positive", prep.prompt.positive === "masterpiece, 1girl, smile");
  check("prepend kept negative", prep.prompt.negative === "lowres");

  const app = mod.applyAction({ type: "append", value: ", best quality" }, base());
  check("append positive", app.prompt.positive === "1girl, smile, best quality");

  const neg = mod.applyAction({ type: "append", value: ", blurry", prompt_kind: "negative" }, base());
  check("append negative via action.prompt_kind", neg.prompt.negative === "lowres, blurry");
  check("append negative left positive intact", neg.prompt.positive === "1girl, smile");

  const negRule = mod.applyAction({ type: "append", value: "!" }, base(), { prompt_kind: "negative" });
  check("append negative via match.prompt_kind", negRule.prompt.negative === "lowres!");

  const rep = mod.applyAction({ type: "replace", find: "smile", replace: "laughing" }, base());
  check("replace substring", rep.prompt.positive === "1girl, laughing");
  check("replace without find replaces whole prompt", mod.applyAction({ type: "replace", value: "only this" }, base()).prompt.positive === "only this");

  check("applyAction does not mutate input", base().prompt.positive === "1girl, smile" && prep.prompt.positive !== base().prompt.positive);
}

/* ================= 3. 参数 param_default / param_clamp / set_model ================= */
section("3. params: param_default / param_clamp / set_model");
{
  const def = mod.applyAction({ type: "param_default", params: { steps: 50, scale: 7 } }, base());
  check("param_default keeps existing steps", def.params.steps === 28);
  check("param_default fills missing scale", def.params.scale === 7);

  const low = mod.applyAction({ type: "param_clamp", field: "steps", min: 30, max: 50 }, base());
  check("param_clamp raises below min", low.params.steps === 30);
  const high = mod.applyAction({ type: "param_clamp", field: "steps", min: 1, max: 20 }, base());
  check("param_clamp lowers above max", high.params.steps === 20);
  const within = mod.applyAction({ type: "param_clamp", field: "steps", min: 20, max: 40 }, base());
  check("param_clamp within range unchanged", within.params.steps === 28);

  const model = mod.applyAction({ type: "set_model", value: "nai-diffusion-3" }, base());
  check("set_model replaces model", model.model === "nai-diffusion-3");
  check("set_model keeps action/prompt", model.action === "generate" && model.prompt.positive === "1girl, smile");
}

/* ================= 4. block -> 管线 CONTENT_BLOCKED 且不请求上游 ================= */
section("4. block -> CONTENT_BLOCKED, no upstream request");
{
  const up = await mod.createUpstream(env, {
    name: "rw-nai",
    type: "nai-compatible",
    base_url: "https://nai.example",
    priority: 10,
    capabilities: { account_strategy: "fixed" }
  });
  const credentialEnc = await mod.encrypt(JSON.stringify({ apiToken: "tok-rw" }), ENCRYPTION_KEY, "credentials");
  await DB.prepare(
    "INSERT INTO accounts (id, upstream_id, label, username, credential_enc, gems_last, enabled, status, failure_count, cooldown_until, last_success_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind("rw-acc", up.id, "rw-acc", "rw", credentialEnc, null, 1, "active", 0, null, null, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    .run();

  let fetchCalled = false;
  const fetchImpl = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ images: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const blockRule = rule("all", { contains: "forbidden" }, { type: "block", message: "包含禁用词", status: 400 });
  const blocked = await mod.runPipeline(
    { ...base(), prompt: { positive: "forbidden content", negative: "" } },
    { env, fetch: fetchImpl, rewriteRules: [blockRule] }
  );
  check("pipeline not ok", blocked.ok === false);
  check("error code CONTENT_BLOCKED", blocked.error?.code === "CONTENT_BLOCKED");
  check("error message from rule", blocked.error?.message === "包含禁用词");
  check("error status 400", blocked.error?.status === 400);
  check("upstream NOT contacted", fetchCalled === false);

  const block403 = rule("prompt", { contains: "banned" }, { type: "block", message: "禁止", status: 403 });
  const blocked403 = await mod.runPipeline(
    { ...base(), prompt: { positive: "banned", negative: "" } },
    { env, fetch: fetchImpl, rewriteRules: [block403] }
  );
  check("block status 403 respected", blocked403.error?.status === 403);

  // 未命中 block：正常放行到上游
  const allowed = await mod.runPipeline(base(), { env, fetch: fetchImpl, rewriteRules: [blockRule] });
  check("non-matching block passes through", allowed.ok === true && fetchCalled === true);
  check("upstream called exactly once", fetchCalled === true);
}

/* ================= 5. priority 顺序 ================= */
section("5. priority ordering (priority DESC, created_at ASC)");
{
  await mod.createRewriteRule(env, {
    scope: "prompt",
    match: { model: "nai-*" },
    action: { type: "append", value: " [low]" },
    priority: 1,
    enabled: true
  });
  await mod.createRewriteRule(env, {
    scope: "prompt",
    match: { model: "nai-*" },
    action: { type: "prepend", value: "[high] " },
    priority: 10,
    enabled: true
  });
  await mod.createRewriteRule(env, {
    scope: "prompt",
    match: { model: "never-*" },
    action: { type: "block" },
    priority: 100,
    enabled: false
  });

  const loaded = await mod.loadRules(env);
  check("loadRules returns enabled only", loaded.length === 2 && loaded.every((r) => r.enabled));
  check("priority DESC order", loaded[0].priority === 10 && loaded[1].priority === 1);

  const out = mod.applyRules(base(), loaded);
  // high priority prepend applied first, then append
  check("ordered application result", out.prompt.positive === "[high] 1girl, smile [low]");
  check("disabled rule never loaded", loaded.every((r) => r.action.type !== "block"));
}

/* ================= 6. 非法 regex 忽略不崩 ================= */
section("6. invalid regex ignored (no crash)");
{
  const badRegex = rule("all", { regex: "([unclosed" }, { type: "block", message: "should not fire" });
  const out = mod.applyRules(base(), [badRegex]);
  check("invalid regex rule ignored", out.prompt.positive === "1girl, smile");
  check("invalid regex does not throw in matchRule", mod.matchRule({ match: { regex: "([unclosed" } }, base()) === false);
  let threw = false;
  let after = null;
  try {
    after = mod.applyRules(base(), [badRegex, rule("prompt", { contains: "smile" }, { type: "append", value: "!" })]);
  } catch {
    threw = true;
  }
  check("subsequent valid rule still applied after invalid regex", threw === false && after?.prompt.positive === "1girl, smile!");
}

/* ================= 7. engine block throws typed error ================= */
section("7. RewriteBlockedError semantics");
{
  let caught = null;
  try {
    mod.applyRules(base(), [rule("all", { contains: "smile" }, { type: "block", message: "no smile" })]);
  } catch (err) {
    caught = err;
  }
  check("block throws RewriteBlockedError", caught instanceof mod.RewriteBlockedError);
  check("typed code CONTENT_BLOCKED", caught?.code === "CONTENT_BLOCKED");
  check("default block status 400", caught?.status === 400);
  check("isRewriteActionType guards invalid", mod.isRewriteActionType("drop_table") === false && mod.isRewriteActionType("block") === true);
}

/* ================= 8. CRUD 路由 + 校验 ================= */
section("8. /api/rewrite-rules CRUD + validation");
{
  const { Hono } = await import("hono");
  const app = new Hono();
  app.use("*", (c, next) => {
    const role = c.req.header("X-Test-Role");
    if (role) c.set("role", role);
    return next();
  });
  app.route("/api/rewrite-rules", mod.rewriteRules);
  const req = (method, url, body, headers = {}) =>
    app.request(url, { method, body, headers }, env);

  const owner = { "Content-Type": "application/json", "X-Test-Role": "owner" };

  const listBefore = await req("GET", "http://localhost/api/rewrite-rules", undefined, owner);
  check("GET list -> 200", listBefore.status === 200);
  const beforeCount = (await listBefore.json()).items.length;

  const bad = await req(
    "POST",
    "http://localhost/api/rewrite-rules",
    JSON.stringify({ scope: "prompt", action: { type: "eval_js", value: "process.exit()" } }),
    owner
  );
  check("POST invalid action.type -> 400", bad.status === 400);
  const badBody = await bad.json();
  check("invalid error shape {error,message}", typeof badBody.error === "string" && typeof badBody.message === "string");

  const created = await req(
    "POST",
    "http://localhost/api/rewrite-rules",
    JSON.stringify({
      scope: "params",
      match: { model: "nai-*" },
      action: { type: "param_clamp", field: "steps", min: 1, max: 50 },
      priority: 5
    }),
    owner
  );
  check("POST valid -> 201", created.status === 201);
  const createdBody = await created.json();
  const createdId = createdBody.id;
  check("created has id", typeof createdId === "string" && createdId.length > 0);
  check("created round-trips match_json", JSON.parse(createdBody.match_json).model === "nai-*");

  const got = await req("GET", `http://localhost/api/rewrite-rules/${createdId}`, undefined, owner);
  check("GET /:id -> 200", got.status === 200);

  const patched = await req(
    "PATCH",
    `http://localhost/api/rewrite-rules/${createdId}`,
    JSON.stringify({ enabled: false, priority: 9 }),
    owner
  );
  check("PATCH -> 200 disabled", patched.status === 200);
  const patchedBody = await patched.json();
  check("PATCH applied", patchedBody.priority === 9 && patchedBody.enabled === false);

  const forbidden = await req("POST", "http://localhost/api/rewrite-rules", JSON.stringify({ action: { type: "block" } }), {
    "Content-Type": "application/json",
    "X-Test-Role": "friend"
  });
  check("non-owner -> 403", forbidden.status === 403);

  const csrf = await req(
    "DELETE",
    `http://localhost/api/rewrite-rules/${createdId}`,
    undefined,
    { "X-Test-Role": "owner", Origin: "https://evil.example" }
  );
  check("cross-origin write -> 403", csrf.status === 403);

  const del = await req("DELETE", `http://localhost/api/rewrite-rules/${createdId}`, undefined, owner);
  check("DELETE -> 200", del.status === 200);
  const gone = await req("GET", `http://localhost/api/rewrite-rules/${createdId}`, undefined, owner);
  check("deleted -> 404", gone.status === 404);

  const listAfter = await req("GET", "http://localhost/api/rewrite-rules", undefined, owner);
  check("list count back to baseline", (await listAfter.json()).items.length === beforeCount);
}

console.log(`\nselftest-rewrite: ${passed} checks passed`);
