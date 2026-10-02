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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-presets-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { auth } from "${abs("routes/auth.ts")}";`,
    `export { presets } from "${abs("routes/presets.ts")}";`,
    `export { createSharePassword, listSharePasswords, deleteSharePassword } from "${abs("db/sharePasswords.ts")}";`,
    `export { BUILTIN_ARTISTS } from "${abs("presets/builtinArtists.ts")}";`,
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
    "0006_share_passwords.sql",
    "0007_presets.sql"
  ]) {
    const sql = await readFile(path.join(here, "..", "migrations", name), "utf8");
    db.exec(sql);
  }
}

/* ---------- 3. harness ---------- */
const DB = makeD1();
await applyMigrations({ exec: (sql) => DB._raw.exec(sql) });
const env = { DB, SESSION_SECRET: "s", APP_ENV: "test", OWNER_PASSWORD: "owner-secret" };

// 真实 cookie 会话 + X-Test-Role/Sid 兜底（用于直接构造分区身份）。
async function testSession(c, next) {
  const headerRole = c.req.header("X-Test-Role");
  if (headerRole) c.set("role", headerRole);
  const headerSid = c.req.header("X-Test-Sid");
  if (headerSid) c.set("sid", headerSid);
  return next();
}

const app = new Hono();
app.use("*", testSession);
app.route("/api/presets", mod.presets);

async function req(method, url, body, headers = {}) {
  return app.request(url, { method, body, headers }, env);
}
function jsonHeaders(role = "owner", sid = null, extra = {}) {
  const h = { "Content-Type": "application/json", "X-Test-Role": role, ...extra };
  if (sid) h["X-Test-Sid"] = sid;
  return h;
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

/* ================= 1. 内置画师串种子 ================= */
section("1. artist 首次访问种入内置画师串");
{
  const res = await req("GET", "http://localhost/api/presets?kind=artist", undefined, jsonHeaders("owner", "owner"));
  check("GET artist 200", res.status === 200);
  const body = await res.json();
  check("首次访问种入 6 套内置", body.items.length === mod.BUILTIN_ARTISTS.length && body.items.length === 6);
  check("全部标记 builtin", body.items.every((i) => i.builtin === true));
  const storedByName = new Map(body.items.map((i) => [i.name, i.content]));
  check(
    "内容与 BUILTIN_ARTISTS 逐条一致",
    mod.BUILTIN_ARTISTS.every((b) => storedByName.get(b.name) === b.content)
  );
  check("owner_sid = owner", body.items.every((i) => i.owner_sid === "owner"));

  // 再次访问不应重复种入。
  const again = await (await req("GET", "http://localhost/api/presets?kind=artist", undefined, jsonHeaders("owner", "owner"))).json();
  check("二次访问不重复种入", again.items.length === 6);

  // 删除一套内置后不再补种。
  const del = await req("DELETE", `http://localhost/api/presets/${again.items[0].id}`, undefined, jsonHeaders("owner", "owner"));
  check("可删除内置", del.status === 200);
  const afterDelete = await (await req("GET", "http://localhost/api/presets?kind=artist", undefined, jsonHeaders("owner", "owner"))).json();
  check("删除后不补种（剩 5）", afterDelete.items.length === 5);
}

/* ================= 2. 按 sid 分区与越权 ================= */
section("2. sid 分区 / friend 越权 / owner 查看");
{
  const shareA = await mod.createSharePassword(env, { label: "朋友A", password: "pass-aaaa" });
  const shareB = await mod.createSharePassword(env, { label: "朋友B", password: "pass-bbbb" });

  const aArtist = await (await req("GET", "http://localhost/api/presets?kind=artist", undefined, jsonHeaders("friend", shareA.id))).json();
  check("friendA 首次访问种入 6 套", aArtist.items.length === 6 && aArtist.items.every((i) => i.owner_sid === shareA.id));

  const aRecipe = await req(
    "POST",
    "http://localhost/api/presets",
    JSON.stringify({ kind: "recipe", name: "A的配方", payload: { model: "m-a" } }),
    jsonHeaders("friend", shareA.id)
  );
  check("friendA 新建配方 201", aRecipe.status === 201);
  const aRecipeBody = await aRecipe.json();
  check("配方归属 friendA", aRecipeBody.owner_sid === shareA.id);

  // friendA 只能看到自己。
  const aList = await (await req("GET", "http://localhost/api/presets?kind=recipe", undefined, jsonHeaders("friend", shareA.id))).json();
  check("friendA 只见自己的配方", aList.items.length === 1 && aList.items[0].owner_sid === shareA.id);
  const bList = await (await req("GET", "http://localhost/api/presets?kind=recipe", undefined, jsonHeaders("friend", shareB.id))).json();
  check("friendB 看不到 A 的配方", bList.items.length === 0);

  // friend 传 sid 越权被忽略。
  const crossList = await (await req("GET", `http://localhost/api/presets?kind=recipe&sid=${shareB.id}`, undefined, jsonHeaders("friend", shareA.id))).json();
  check("friend 传他人 sid 被忽略，仅看自己", crossList.items.length === 1 && crossList.items[0].owner_sid === shareA.id);

  // friendA 改/删 friendB 的配方被拒。
  const bRecipe = await (await req(
    "POST",
    "http://localhost/api/presets",
    JSON.stringify({ kind: "recipe", name: "B的配方", payload: { model: "m-b" } }),
    jsonHeaders("friend", shareB.id)
  )).json();
  const crossPatch = await req("PATCH", `http://localhost/api/presets/${bRecipe.id}`, JSON.stringify({ name: "黑" }), jsonHeaders("friend", shareA.id));
  check("friend 改他人配方 403", crossPatch.status === 403);
  const crossDelete = await req("DELETE", `http://localhost/api/presets/${bRecipe.id}`, undefined, jsonHeaders("friend", shareA.id));
  check("friend 删他人配方 403", crossDelete.status === 403);

  // owner 带 sid 可查看他人。
  const ownerViewA = await (await req("GET", `http://localhost/api/presets?kind=recipe&sid=${shareA.id}`, undefined, jsonHeaders("owner", "owner"))).json();
  check("owner ?sid= 查看 friendA 配方", ownerViewA.items.length === 1 && ownerViewA.items[0].owner_sid === shareA.id);
  const ownerViewAArtist = await (await req("GET", `http://localhost/api/presets?kind=artist&sid=${shareA.id}`, undefined, jsonHeaders("owner", "owner"))).json();
  check("owner 查看 friendA 画师串（种入）", ownerViewAArtist.items.length === 6);

  // owner 不能改他人。
  const ownerPatchOther = await req("PATCH", `http://localhost/api/presets/${bRecipe.id}`, JSON.stringify({ name: "改他人" }), jsonHeaders("owner", "owner"));
  check("owner 改他人配方 403", ownerPatchOther.status === 403);
  const ownerDeleteOther = await req("DELETE", `http://localhost/api/presets/${bRecipe.id}`, undefined, jsonHeaders("owner", "owner"));
  check("owner 删他人配方 403", ownerDeleteOther.status === 403);
  const noAuth = await req("GET", "http://localhost/api/presets?kind=recipe", undefined, {});
  check("未登录 401", noAuth.status === 401);
}

/* ================= 3. recipe 载荷 round-trip ================= */
section("3. 配方 payload round-trip / 改名 / 覆盖 / 删除");
{
  const sid = "owner";
  const payload = {
    model: "nai-diffusion-4-5-full",
    prompt: "1girl, solo",
    negative_prompt: "lowres",
    action: "generate",
    n: 1,
    size: "832x1216",
    parameters: { width: 832, height: 1216, steps: 28, scale: 5, seed: 123, sampler: "k_euler", noise_schedule: "karras" }
  };
  const created = await (await req(
    "POST",
    "http://localhost/api/presets",
    JSON.stringify({ kind: "recipe", name: "roundtrip", payload }),
    jsonHeaders("owner", "owner")
  )).json();
  check("payload round-trip 一致", JSON.stringify(created.payload) === JSON.stringify(payload));

  const renamed = await (await req("PATCH", `http://localhost/api/presets/${created.id}`, JSON.stringify({ name: "改名后" }), jsonHeaders("owner", "owner"))).json();
  check("改名生效", renamed.name === "改名后");

  const override = { ...payload, model: "override-model", parameters: { ...payload.parameters, steps: 40 } };
  const overridden = await (await req("PATCH", `http://localhost/api/presets/${created.id}`, JSON.stringify({ payload: override }), jsonHeaders("owner", "owner"))).json();
  check("覆盖 payload 生效", overridden.payload.model === "override-model" && overridden.payload.parameters.steps === 40);

  const del = await req("DELETE", `http://localhost/api/presets/${created.id}`, undefined, jsonHeaders("owner", "owner"));
  check("删除返回 ok", del.status === 200 && (await del.json()).ok === true);
  const gone = await req("PATCH", `http://localhost/api/presets/${created.id}`, JSON.stringify({ name: "x" }), jsonHeaders("owner", "owner"));
  check("已删除记录 PATCH 404", gone.status === 404);
}

/* ================= 4. 非法 kind / overview ================= */
section("4. 非法 kind / owner overview");
{
  const bad = await req("GET", "http://localhost/api/presets?kind=bogus", undefined, jsonHeaders("owner", "owner"));
  check("非法 kind 400", bad.status === 400);
  const badPost = await req("POST", "http://localhost/api/presets", JSON.stringify({ kind: "bogus", name: "x" }), jsonHeaders("owner", "owner"));
  check("POST 非法 kind 400", badPost.status === 400);
  const noName = await req("POST", "http://localhost/api/presets", JSON.stringify({ kind: "recipe" }), jsonHeaders("owner", "owner"));
  check("缺名称 400", noName.status === 400);

  const overview = await req("GET", "http://localhost/api/presets/overview", undefined, jsonHeaders("owner", "owner"));
  check("overview owner 200", overview.status === 200);
  const overviewBody = await overview.json();
  check("overview 含 owner 行", overviewBody.items.some((r) => r.sid === "owner" && r.role === "owner"));
  check("overview 含 label 所有者", overviewBody.items.find((r) => r.sid === "owner")?.label === "所有者");
  const shareIds = (await mod.listSharePasswords(env)).map((s) => s.id);
  check("overview 每个分享密码一行", overviewBody.items.length === 1 + shareIds.length);
  check("overview 计数为数字", overviewBody.items.every((r) => typeof r.recipe_count === "number" && typeof r.artist_count === "number"));

  const friendOverview = await req("GET", "http://localhost/api/presets/overview", undefined, jsonHeaders("friend", "x"));
  check("overview friend 403", friendOverview.status === 403);
}

console.log(`\nselftest-presets: ${passed} checks passed`);
