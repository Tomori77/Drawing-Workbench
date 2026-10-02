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
const tmp = await mkdtemp(path.join(os.tmpdir(), "dwb-checkin-"));
const abs = (rel) => path.join(srcRoot, rel).replaceAll("\\", "/");
const entry = path.join(tmp, "entry.ts");
await writeFile(
  entry,
  [
    `export { getSettings, updateSettings, CheckinSettingsError, DEFAULT_TIMEZONE, RETRY_MAX, RETRY_BACKOFF_MS } from "${abs("checkin/settings.ts")}";`,
    `export { localParts, slotKey, slotMinutes, dayTimes, dueSlot, nextSlot } from "${abs("checkin/schedule.ts")}";`,
    `export { performCheckin, runScheduled, claimLease, recoverCooldowns, classifyCheckin, getCheckinState } from "${abs("checkin/run.ts")}";`,
    `export { createAccount, getAccount, getAccountSecret, updateAccount } from "${abs("db/accounts.ts")}";`,
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
  for (const name of ["0001_init.sql", "0002_gateway.sql", "0003_checkin.sql"]) {
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
    const auth = init.headers?.Authorization ?? "";
    fetchLog.push({ url, method: init.method ?? "GET", auth });
    return handler(url, init, { auth });
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

async function setCheckinState(id, patch) {
  await DB.prepare(
    "INSERT INTO runtime_kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v"
  )
    .bind(`checkin_state:${id}`, JSON.stringify({
      last_attempt_slot: null,
      last_success_slot: null,
      retry_count: 0,
      status: "pending",
      last_message: null,
      ...patch
    }))
    .run();
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

/* ================= 1. 调度时间函数 ================= */
section("1. localParts / slotKey / dueSlot / 升序补签");
{
  const settings = {
    enabled: true,
    timezone: "Asia/Shanghai",
    weekday_times: ["09:05", "18:30"],
    weekend_times: ["10:00"],
    lease_until: null,
    next_run_at: null,
    last_attempt_slot: null,
    last_success_slot: null,
    status: "pending",
    last_message: null,
    retry_count: 0,
    updated_at: "2026-01-01T00:00:00.000Z"
  };

  // 2026-10-01 是周四（工作日）12:00 Asia/Shanghai = 04:00Z
  const weekdayNow = new Date("2026-10-01T04:00:00.000Z");
  const parts = mod.localParts(weekdayNow, "Asia/Shanghai");
  check("localParts weekday=Thu", parts.weekday === "Thu");
  check("localParts hour/minute Asia/Shanghai", parts.hour === 12 && parts.minute === 0);
  check("slotKey formats YYYY-MM-DDTHH:MM", mod.slotKey(parts, "09:05") === "2026-10-01T09:05");
  check("slotMinutes parses HH:MM", mod.slotMinutes("18:30") === 18 * 60 + 30);

  // 工作日选槽
  check("dayTimes weekday returns weekday_times", mod.dayTimes(settings, weekdayNow).join(",") === "09:05,18:30");
  // 2026-10-03 是周六
  const weekendNow = new Date("2026-10-03T04:00:00.000Z");
  check("dayTimes weekend returns weekend_times", mod.dayTimes(settings, weekendNow).join(",") === "10:00");

  // 未到点：09:05 前（01:00Z = 09:00）
  const beforeFirst = new Date("2026-10-01T01:00:00.000Z");
  check("dueSlot before first slot returns null", mod.dueSlot(settings, { last_attempt_slot: null, last_success_slot: null }, beforeFirst) === null);

  // 已到 09:05 未到 18:30（04:00Z=12:00），选最早到点槽
  const midday = new Date("2026-10-01T04:00:00.000Z");
  check("dueSlot picks earliest due slot", mod.dueSlot(settings, { last_attempt_slot: null, last_success_slot: null }, midday) === "2026-10-01T09:05");

  // 升序补签：09:05 已尝试，18:30 已到点 → 选 09:05 之后最早未尝试槽
  const afterBoth = new Date("2026-10-01T11:00:00.000Z"); // 19:00 Shanghai
  check("dueSlot back-fills earliest unattempted", mod.dueSlot(settings, { last_attempt_slot: "2026-10-01T09:05", last_success_slot: null }, afterBoth) === "2026-10-01T18:30");

  // 全部已尝试 → 最新槽重试
  check(
    "dueSlot falls back to latest slot when all attempted",
    mod.dueSlot(settings, { last_attempt_slot: "2026-10-01T09:05", last_success_slot: "2026-10-01T18:30" }, afterBoth) === "2026-10-01T18:30"
  );

  // last_success_slot 也算已尝试
  check(
    "dueSlot treats last_success_slot as attempted",
    mod.dueSlot(settings, { last_attempt_slot: "2026-10-01T18:30", last_success_slot: "2026-10-01T09:05" }, afterBoth) === "2026-10-01T18:30"
  );

  // nextSlot 未来槽
  const nxt = mod.nextSlot(settings, new Date("2026-10-01T04:00:00.000Z"));
  check("nextSlot returns next future slot", nxt === "2026-10-01T18:30");
}

/* ================= 2. performCheckin 成功写库 ================= */
section("2. performCheckin success -> checkin_logs + account status");
{
  const up = await mod.createUpstream(env, { name: "nai-ok", type: "nai-compatible", base_url: "https://nai-ok.example" });
  await insertAccountRow("ok1", { upstreamId: up.id, username: "ok1", secret: { jwt: "jwt-ok" } });
  const account = await mod.getAccount(env, "ok1");
  const fetchImpl = makeFetch((url) => {
    if (url.includes("/api/user/checkin")) return jsonResponse({ message: "签到成功", data: { balance_gems: 77 } });
    return jsonResponse({ error: "no_route", url }, 404);
  });

  const res = await mod.performCheckin(env, account, "2026-10-01T09:05", { fetch: fetchImpl });
  check("checkin posts to /api/user/checkin", fetchLog.at(-1).url.endsWith("/api/user/checkin") && fetchLog.at(-1).method === "POST");
  check("checkin sends Bearer jwt", fetchLog.at(-1).auth === "Bearer jwt-ok");
  check("result ok/status success", res.ok === true && res.status === "success");
  check("result returns upstream status_code", res.status_code === 200);

  const logged = await DB.prepare("SELECT * FROM checkin_logs WHERE account_id='ok1'").first();
  check("checkin_logs row written ok=1", logged && logged.ok === 1 && logged.status_code === 200);
  check("checkin_logs slot recorded", logged.slot === "2026-10-01T09:05");

  const after = await mod.getAccount(env, "ok1");
  check("account status=success", after.status === "success");
  check("account last_success_at written", typeof after.last_success_at === "string" && after.last_success_at.length > 0);
  check("account gems_last refreshed from response", after.gems_last === 77);

  const state = await mod.getCheckinState(env, "ok1");
  check("checkin state last_success_slot advanced", state.last_success_slot === "2026-10-01T09:05");
  check("checkin state retry_count reset", state.retry_count === 0);
}

/* ================= 3. 401 -> refreshJwt 重试 ================= */
section("3. 401 -> refreshJwt retry; no JWT -> jwt_expired");
{
  const up = await mod.createUpstream(env, { name: "nai-401", type: "nai-compatible", base_url: "https://nai-401.example" });
  const acc = await mod.createAccount(env, { upstream_id: up.id, username: "u401", password: "pw401", jwt: "stale-401" });
  const seen = [];
  const fetchImpl = makeFetch((url, _init, { auth }) => {
    if (url.includes("/api/ynai/auth/login")) return jsonResponse({ data: { access_token: "fresh-401" } });
    if (url.includes("/api/user/checkin")) {
      seen.push(auth);
      if (auth === "Bearer stale-401") return jsonResponse({ detail: "jwt expired" }, 401);
      return jsonResponse({ message: "签到成功", data: { balance_gems: 5 } });
    }
    return jsonResponse({ error: "no_route" }, 404);
  });

  const res = await mod.performCheckin(env, acc, "2026-10-01T09:05", { fetch: fetchImpl });
  check("first checkin rejected with stale jwt", seen[0] === "Bearer stale-401");
  check("retry checkin uses refreshed jwt", seen.at(-1) === "Bearer fresh-401");
  check("401 retry eventually succeeds", res.ok === true && res.status === "success");
  const secret = await mod.getAccountSecret(env, acc.id);
  check("refreshed jwt persisted", secret.jwt === "fresh-401");
  check("password preserved on refresh", secret.password === "pw401");

  // 无 JWT 且无密码 → jwt_expired
  const up2 = await mod.createUpstream(env, { name: "nai-nojwt", type: "nai-compatible", base_url: "https://nai-nojwt.example" });
  const acc2 = await mod.createAccount(env, { upstream_id: up2.id, username: "nojwt" });
  const fetchImpl2 = makeFetch(() => jsonResponse({ error: "should_not_be_called" }, 500));
  const res2 = await mod.performCheckin(env, acc2, "2026-10-01T09:05", { fetch: fetchImpl2 });
  check("no JWT yields jwt_expired", res2.status === "jwt_expired" && res2.ok === false);
  check("no upstream request for JWT-less account", fetchLog.filter((f) => f.url.includes("nai-nojwt.example")).length === 0);
  const after2 = await mod.getAccount(env, acc2.id);
  check("account marked jwt_expired", after2.status === "jwt_expired");
}

/* ================= 4. turnstile -> manual_required 终态 ================= */
section("4. turnstile -> manual_required (terminal, no retry)");
{
  const up = await mod.createUpstream(env, { name: "nai-ts", type: "nai-compatible", base_url: "https://nai-ts.example" });
  await insertAccountRow("ts1", { upstreamId: up.id, username: "ts1", secret: { jwt: "jwt-ts" } });
  const account = await mod.getAccount(env, "ts1");
  const checkinAuths = [];
  const fetchImpl = makeFetch((url, _init, { auth }) => {
    if (url.includes("/api/user/checkin")) {
      checkinAuths.push(auth);
      return jsonResponse({ message: "turnstile verification required" }, 403);
    }
    if (url.includes("/api/ynai/user/balance")) return jsonResponse({ data: { balance_gems: 1 } });
    return jsonResponse({ error: "no_route" }, 404);
  });
  await mod.updateSettings(env, { weekday_times: ["00:00"], weekend_times: ["00:00"] });
  const res = await mod.performCheckin(env, account, "2026-10-01T00:00", { fetch: fetchImpl });
  check("turnstile classified manual_required", res.status === "manual_required");
  check("turnstile recorded as failure", res.ok === false);
  check("turnstile not auto-retried within performCheckin", checkinAuths.filter((a) => a === "Bearer jwt-ts").length === 1);

  await setCheckinState("ts1", { last_attempt_slot: "2026-10-01T00:00", status: "manual_required", retry_count: 0 });
  const tsBefore = checkinAuths.filter((a) => a === "Bearer jwt-ts").length;
  const summary = await mod.runScheduled(env, fetchImpl, { now: new Date("2026-10-01T04:00:00.000Z"), gapMs: [0, 0] });
  check("runScheduled skips terminal manual_required", checkinAuths.filter((a) => a === "Bearer jwt-ts").length === tsBefore);
  check("runScheduled ran to completion (not lease-skipped)", summary.skipped === null);
}

/* ================= 5. 重试退避 ================= */
section("5. retry backoff (30min / retry_count>=4)");
{
  await DB.prepare("UPDATE accounts SET enabled=0").run();
  const up = await mod.createUpstream(env, { name: "nai-retry", type: "nai-compatible", base_url: "https://nai-retry.example" });
  await insertAccountRow("r1", { upstreamId: up.id, username: "r1", secret: { jwt: "jwt-r1" }, status: "retry" });
  await insertAccountRow("r2", { upstreamId: up.id, username: "r2", secret: { jwt: "jwt-r2" }, status: "retry" });
  await insertAccountRow("r3", { upstreamId: up.id, username: "r3", secret: { jwt: "jwt-r3" } });
  await mod.updateSettings(env, { weekday_times: ["00:00"], weekend_times: ["00:00"] });

  const now = new Date("2026-10-01T04:00:00.000Z"); // 12:00 Shanghai, slot 00:00 already due
  // r1: 5 分钟前失败一次 -> 退避内应跳过
  await DB.prepare(
    "INSERT INTO checkin_logs (account_id, attempted_at, slot, ok, status_code, message) VALUES (?,?,?,?,?,?)"
  ).bind("r1", new Date(now.getTime() - 5 * 60 * 1000).toISOString(), "2026-10-01T00:00", 0, 500, "boom").run();
  await setCheckinState("r1", { last_attempt_slot: "2026-10-01T00:00", status: "retry", retry_count: 1 });
  // r2: retry_count=4 达上限 -> 跳过
  await DB.prepare(
    "INSERT INTO checkin_logs (account_id, attempted_at, slot, ok, status_code, message) VALUES (?,?,?,?,?,?)"
  ).bind("r2", new Date(now.getTime() - 60 * 60 * 1000).toISOString(), "2026-10-01T00:00", 0, 500, "boom").run();
  await setCheckinState("r2", { last_attempt_slot: "2026-10-01T00:00", status: "retry", retry_count: 4 });
  // r3: 全新槽 -> 应尝试
  await setCheckinState("r3", { last_attempt_slot: null, status: "pending", retry_count: 0 });

  const checkinCalls = [];
  // 清空旧日志计数引用
  const beforeCount = (await DB.prepare("SELECT COUNT(*) AS n FROM checkin_logs WHERE account_id='r3'").first()).n;
  const fetchImpl = makeFetch((url, _init, { auth }) => {
    if (url.includes("/api/user/checkin")) {
      checkinCalls.push(auth);
      return jsonResponse({ message: "签到成功", data: { balance_gems: 9 } });
    }
    if (url.includes("/api/ynai/user/balance")) return jsonResponse({ data: { balance_gems: 9 } });
    return jsonResponse({ error: "no_route" }, 404);
  });

  await DB.prepare("UPDATE checkin_settings SET lease_until=NULL, next_run_at=NULL WHERE id=1").run();
  const summary = await mod.runScheduled(env, fetchImpl, { now, gapMs: [0, 0] });
  check("runScheduled attempts exactly the fresh account", checkinCalls.length === 1 && checkinCalls[0] === "Bearer jwt-r3");
  check("runScheduled does not call backoff-retry account", !checkinCalls.includes("Bearer jwt-r1"));
  check("runScheduled does not call max-retry account", !checkinCalls.includes("Bearer jwt-r2"));
  check("summary success=1", summary.success === 1);
  const r3Logs = (await DB.prepare("SELECT COUNT(*) AS n FROM checkin_logs WHERE account_id='r3'").first()).n;
  check("fresh account got a new log row", r3Logs === beforeCount + 1);

  // 退避已过（31 分钟前）且 retry_count<4 -> 允许重试
  const later = new Date("2026-10-01T05:00:00.000Z");
  await setCheckinState("r1", { last_attempt_slot: "2026-10-01T00:00", status: "retry", retry_count: 1, last_message: null });
  await DB.prepare("UPDATE checkin_logs SET attempted_at=? WHERE account_id='r1'")
    .bind(new Date(later.getTime() - 31 * 60 * 1000).toISOString())
    .run();
  await setCheckinState("r2", { last_attempt_slot: "2026-10-01T00:00", status: "retry", retry_count: 4 });
  await setCheckinState("r3", { last_attempt_slot: "2026-10-01T00:00", last_success_slot: "2026-10-01T00:00", status: "success", retry_count: 0 });
  checkinCalls.length = 0;
  await DB.prepare("UPDATE checkin_settings SET lease_until=NULL WHERE id=1").run();
  const summary2 = await mod.runScheduled(env, fetchImpl, { now: later, gapMs: [0, 0] });
  check("after backoff elapsed, retry account attempted", checkinCalls.includes("Bearer jwt-r1"));
  check("second run retries only r1", checkinCalls.length === 1);
  check("summary2 attempted=1", summary2.attempted === 1);
}

/* ================= 6. 租约 ================= */
section("6. lease prevents concurrent run");
{
  const now = new Date("2026-10-01T06:00:00.000Z");
  // 抢一个覆盖当前时刻的租约（手工写入未来时间）
  await DB.prepare("UPDATE checkin_settings SET lease_until=?, updated_at=? WHERE id=1")
    .bind(new Date(now.getTime() + 600 * 1000).toISOString(), now.toISOString())
    .run();
  const checkinCalls = [];
  const fetchImpl = makeFetch((url) => {
    if (url.includes("/api/user/checkin")) checkinCalls.push(url);
    if (url.includes("/api/ynai/user/balance")) return jsonResponse({ data: { balance_gems: 0 } });
    return jsonResponse({ message: "ok" });
  });
  const summary = await mod.runScheduled(env, fetchImpl, { now, gapMs: [0, 0] });
  check("runScheduled skipped when lease held", summary.skipped === "lease_held");
  check("no checkin attempted under held lease", checkinCalls.length === 0);

  // 清除租约后可正常抢占
  await DB.prepare("UPDATE checkin_settings SET lease_until=NULL WHERE id=1").run();
  const claimed = await mod.claimLease(env, now);
  check("claimLease succeeds when free", claimed === true);
  const claimedAgain = await mod.claimLease(env, now);
  check("claimLease fails when held", claimedAgain === false);
}

/* ================= 7. settings 校验 ================= */
section("7. settings validation");
{
  let threwTz = null;
  try {
    await mod.updateSettings(env, { timezone: "Not/AZone" });
  } catch (err) {
    threwTz = err;
  }
  check("illegal timezone throws BAD_TIMEZONE", threwTz && threwTz.code === "BAD_TIMEZONE" && threwTz.status === 400);

  let threwEmpty = null;
  try {
    await mod.updateSettings(env, { weekday_times: [] });
  } catch (err) {
    threwEmpty = err;
  }
  check("empty times throws SCHEDULE_EMPTY", threwEmpty && threwEmpty.code === "SCHEDULE_EMPTY" && threwEmpty.status === 400);

  const updated = await mod.updateSettings(env, {
    timezone: "UTC",
    weekday_times: ["09:05", "09:05", "25:00", "bad", "18:30"],
    weekend_times: ["10:00"]
  });
  check("invalid times filtered, duplicates removed, sorted", updated.weekday_times.join(",") === "09:05,18:30");
  check("valid timezone persisted", updated.timezone === "UTC");
  const reread = await mod.getSettings(env);
  check("settings round-trip persists times", reread.weekday_times.join(",") === "09:05,18:30");
  check("defaults applied for missing row", mod.DEFAULT_TIMEZONE === "Asia/Shanghai" && mod.RETRY_MAX === 4 && mod.RETRY_BACKOFF_MS === 30 * 60 * 1000);
}

/* ================= 8. 冷却回收 ================= */
section("8. cooldown recovery");
{
  const up = await mod.createUpstream(env, { name: "nai-cool", type: "nai-compatible", base_url: "https://nai-cool.example" });
  const past = new Date("2026-01-01T00:00:00.000Z").toISOString();
  await insertAccountRow("c1", { upstreamId: up.id, username: "c1", secret: { jwt: "jwt-c1" }, status: "cooling" });
  await DB.prepare("UPDATE accounts SET cooldown_until=?, failure_count=3 WHERE id='c1'").bind(past).run();
  await DB.prepare(
    "INSERT INTO account_rate_state(account_id, failure_count, cooldown_until, last_status, updated_at) VALUES(?,?,?,?,?)"
  ).bind("c1", 3, past, 429, past).run();

  const recovered = await mod.recoverCooldowns(env, new Date("2026-06-01T00:00:00.000Z"));
  check("recoverCooldowns reports one recovery", recovered === 1);
  const row = await mod.getAccount(env, "c1");
  check("expired cooldown cleared on account", row.cooldown_until === null && row.failure_count === 0);
  check("cooling account restored to active", row.status === "active");
  const rate = await DB.prepare("SELECT cooldown_until, failure_count FROM account_rate_state WHERE account_id='c1'").first();
  check("rate_state cooldown cleared", rate.cooldown_until === null && rate.failure_count === 0);

  const noop = await mod.recoverCooldowns(env, new Date("2026-06-01T00:00:00.000Z"));
  check("recoverCooldowns idempotent", noop === 0);
}

console.log(`\nselftest-checkin: ${passed} checks passed`);
