import type { Env } from "../types";
import { getAccountSecret, updateAccount, type AccountRow } from "../db/accounts";
import { getUpstream } from "../db/upstreams";
import { getKv, setKv } from "../pool/kv";
import { joinUrl } from "../lib/url";
import { truncateLog } from "../lib/log";
import { parseJson } from "../lib/json";
import { nowIso } from "../lib/time";
import { refreshJwt, type FetchLike } from "../pool/login";
import { refreshAllGems } from "../pool/balance";
import {
  getSettings,
  RETRY_BACKOFF_MS,
  RETRY_MAX,
  LEASE_MS,
  type CheckinSettings
} from "./settings";
import { dueSlot, nextSlot, localParts, slotKey } from "./schedule";

export const CHECKIN_PATH = "/api/user/checkin";
export const CHECKIN_TIMEOUT_MS = 30_000;
export const MIN_GAP_MS = 3_000;
export const MAX_GAP_MS = 8_000;

export type CheckinStatus = "success" | "retry" | "jwt_expired" | "manual_required" | "skipped";

export interface CheckinResult {
  account_id: string;
  ok: boolean;
  status: CheckinStatus;
  slot: string | null;
  status_code: number | null;
  message: string;
}

export interface CheckinState {
  last_attempt_slot: string | null;
  last_success_slot: string | null;
  retry_count: number;
  status: string;
  last_message: string | null;
}

export interface RunOptions {
  now?: Date;
  gapMs?: [number, number];
}

export interface ScheduledSummary {
  skipped: string | null;
  attempted: number;
  success: number;
  retry: number;
  terminal: number;
  refreshed: number;
  recovered: number;
  idle: number;
}

const EMPTY_STATE: CheckinState = {
  last_attempt_slot: null,
  last_success_slot: null,
  retry_count: 0,
  status: "pending",
  last_message: null
};

function stateKey(accountId: string): string {
  return `checkin_state:${accountId}`;
}

export async function getCheckinState(env: Env, accountId: string): Promise<CheckinState> {
  const raw = await getKv(env, stateKey(accountId));
  const parsed = parseJson<Partial<CheckinState> | null>(raw, null);
  if (!parsed) return { ...EMPTY_STATE };
  return {
    last_attempt_slot: typeof parsed.last_attempt_slot === "string" ? parsed.last_attempt_slot : null,
    last_success_slot: typeof parsed.last_success_slot === "string" ? parsed.last_success_slot : null,
    retry_count: Number.isFinite(Number(parsed.retry_count)) ? Number(parsed.retry_count) : 0,
    status: typeof parsed.status === "string" ? parsed.status : "pending",
    last_message: typeof parsed.last_message === "string" ? parsed.last_message : null
  };
}

async function saveCheckinState(
  env: Env,
  accountId: string,
  patch: Partial<CheckinState>
): Promise<CheckinState> {
  const next = { ...(await getCheckinState(env, accountId)), ...patch };
  await setKv(env, stateKey(accountId), JSON.stringify(next));
  return next;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function pickMessage(data: Record<string, unknown>, fallback: string): string {
  const detail =
    data.detail ?? data.message ?? (data.error as Record<string, unknown> | undefined)?.message;
  return truncateLog(typeof detail === "string" && detail ? detail : fallback);
}

function pickGems(data: Record<string, unknown>): number | null {
  const inner = data.data as Record<string, unknown> | undefined;
  const candidates: unknown[] = [inner?.balance_gems, data.balance_gems, inner?.gems, data.gems];
  for (const raw of candidates) {
    const n = Number(raw);
    if (raw !== undefined && raw !== null && Number.isFinite(n)) return n;
  }
  return null;
}

export function classifyCheckin(status: number, rawText: string): CheckinStatus {
  if (status === 401) return "jwt_expired";
  if (/turnstile/i.test(rawText)) return "manual_required";
  return status >= 200 && status < 300 ? "success" : "retry";
}

async function recordLog(
  env: Env,
  accountId: string,
  slot: string,
  ok: boolean,
  statusCode: number | null,
  message: string
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO checkin_logs (account_id, attempted_at, slot, ok, status_code, message) VALUES (?,?,?,?,?,?)"
  )
    .bind(accountId, nowIso(), slot, ok ? 1 : 0, statusCode, truncateLog(message))
    .run();
}

async function callCheckin(fetchImpl: FetchLike, baseUrl: string, jwt: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECKIN_TIMEOUT_MS);
  try {
    return await fetchImpl(joinUrl(baseUrl, CHECKIN_PATH), {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function performCheckin(
  env: Env,
  account: AccountRow,
  slot: string | null = null,
  opts: { manual?: boolean; fetch?: FetchLike } = {}
): Promise<CheckinResult> {
  const manual = opts.manual === true;
  const fetchImpl = opts.fetch ?? fetch;
  const settings = await getSettings(env);
  const state = await getCheckinState(env, account.id);

  let actualSlot = slot ?? dueSlot(settings, state);
  if (!actualSlot && manual) {
    actualSlot =
      nextSlot(settings) ??
      slotKey(localParts(new Date(), settings.timezone), settings.weekday_times[0] ?? "09:05");
  }
  if (!actualSlot) {
    return {
      account_id: account.id,
      ok: false,
      status: "skipped",
      slot: null,
      status_code: null,
      message: "当前没有到点的签到时间"
    };
  }

  const upstream = await getUpstream(env, account.upstream_id);
  if (!upstream) {
    const message = "upstream_not_found";
    await recordLog(env, account.id, actualSlot, false, null, message);
    await saveCheckinState(env, account.id, {
      last_attempt_slot: actualSlot,
      status: "retry",
      last_message: message
    });
    await updateAccount(env, account.id, { status: "retry" });
    return {
      account_id: account.id,
      ok: false,
      status: "retry",
      slot: actualSlot,
      status_code: null,
      message
    };
  }

  const secret = await getAccountSecret(env, account.id);
  let jwt = secret?.jwt ?? null;
  if (!jwt) jwt = await refreshJwt(env, account, fetchImpl).catch(() => null);
  if (!jwt) {
    const message = "账户无可用 JWT（可先刷新登录）";
    await recordLog(env, account.id, actualSlot, false, null, message);
    await saveCheckinState(env, account.id, {
      last_attempt_slot: actualSlot,
      status: "jwt_expired",
      last_message: message
    });
    await updateAccount(env, account.id, { status: "jwt_expired" });
    return {
      account_id: account.id,
      ok: false,
      status: "jwt_expired",
      slot: actualSlot,
      status_code: null,
      message
    };
  }

  let response: Response;
  try {
    response = await callCheckin(fetchImpl, upstream.base_url, jwt);
    if (response.status === 401) {
      const fresh = await refreshJwt(env, account, fetchImpl).catch(() => null);
      if (fresh) {
        jwt = fresh;
        response = await callCheckin(fetchImpl, upstream.base_url, jwt);
      }
    }
  } catch (err) {
    const message = truncateLog(err instanceof Error ? err.message : "checkin request failed");
    const isNewSlot = state.last_attempt_slot !== actualSlot;
    await saveCheckinState(env, account.id, {
      last_attempt_slot: actualSlot,
      status: "retry",
      last_message: message,
      retry_count: manual ? state.retry_count : isNewSlot ? 1 : state.retry_count + 1
    });
    await updateAccount(env, account.id, { status: "retry" });
    await recordLog(env, account.id, actualSlot, false, null, message);
    return {
      account_id: account.id,
      ok: false,
      status: "retry",
      slot: actualSlot,
      status_code: null,
      message
    };
  }

  const rawText = await response.text().catch(() => "");
  const data = parseJson<Record<string, unknown>>(rawText || null, {});
  const status = classifyCheckin(response.status, rawText);
  const message = pickMessage(data, response.ok ? "签到成功" : `HTTP ${response.status}`);
  const isNewSlot = state.last_attempt_slot !== actualSlot;
  const gems = response.ok ? pickGems(data) : null;

  if (manual) {
    if (response.ok) {
      await saveCheckinState(env, account.id, {
        last_attempt_slot: actualSlot,
        last_success_slot: actualSlot,
        status: "success",
        last_message: message,
        retry_count: 0
      });
    } else {
      await saveCheckinState(env, account.id, {
        last_attempt_slot: actualSlot,
        status,
        last_message: message
      });
    }
    await updateAccount(env, account.id, {
      status,
      ...(response.ok ? { last_success_at: nowIso(), failure_count: 0, cooldown_until: null } : {}),
      ...(gems !== null ? { gems_last: gems } : {})
    });
  } else {
    await saveCheckinState(env, account.id, {
      last_attempt_slot: actualSlot,
      last_success_slot: response.ok ? actualSlot : null,
      status,
      last_message: message,
      retry_count: response.ok ? 0 : isNewSlot ? 1 : state.retry_count + 1
    });
    await updateAccount(env, account.id, {
      status,
      ...(response.ok ? { last_success_at: nowIso(), failure_count: 0, cooldown_until: null } : {}),
      ...(gems !== null ? { gems_last: gems } : {})
    });
  }

  await recordLog(env, account.id, actualSlot, response.ok, response.status, message);
  return {
    account_id: account.id,
    ok: response.ok,
    status,
    slot: actualSlot,
    status_code: response.status,
    message
  };
}

export async function claimLease(env: Env, now: Date = new Date()): Promise<boolean> {
  await env.DB.prepare("INSERT OR IGNORE INTO checkin_settings (id) VALUES (1)").run();
  const nowIsoStr = now.toISOString();
  const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
  const result = await env.DB.prepare(
    "UPDATE checkin_settings SET lease_until=?, updated_at=? WHERE id=1 AND (lease_until IS NULL OR lease_until<?)"
  )
    .bind(leaseUntil, nowIsoStr, nowIsoStr)
    .run();
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  return changes > 0;
}

export async function recoverCooldowns(env: Env, now: Date = new Date()): Promise<number> {
  const iso = now.toISOString();
  await env.DB.prepare(
    "UPDATE account_rate_state SET failure_count=0, cooldown_until=NULL, updated_at=? WHERE cooldown_until IS NOT NULL AND cooldown_until<=?"
  )
    .bind(iso, iso)
    .run();
  const result = await env.DB.prepare(
    "UPDATE accounts SET failure_count=0, cooldown_until=NULL, status=CASE WHEN status='cooling' THEN 'active' ELSE status END, updated_at=? WHERE cooldown_until IS NOT NULL AND cooldown_until<=?"
  )
    .bind(iso, iso)
    .run();
  return Number((result.meta as { changes?: number } | undefined)?.changes ?? 0);
}

async function lastAttemptAt(env: Env, accountId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT attempted_at FROM checkin_logs WHERE account_id=? ORDER BY id DESC LIMIT 1"
  )
    .bind(accountId)
    .first<{ attempted_at: string }>();
  if (!row) return 0;
  const parsed = Date.parse(row.attempted_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function runScheduled(
  env: Env,
  fetchImpl: FetchLike = fetch,
  opts: RunOptions = {}
): Promise<ScheduledSummary> {
  const now = opts.now ?? new Date();
  const [gapMin, gapMax] = opts.gapMs ?? [MIN_GAP_MS, MAX_GAP_MS];
  const summary: ScheduledSummary = {
    skipped: null,
    attempted: 0,
    success: 0,
    retry: 0,
    terminal: 0,
    refreshed: 0,
    recovered: 0,
    idle: 0
  };

  const settings: CheckinSettings = await getSettings(env);
  if (!settings.enabled) {
    summary.skipped = "disabled";
    return summary;
  }
  if (!(await claimLease(env, now))) {
    summary.skipped = "lease_held";
    return summary;
  }

  summary.recovered = await recoverCooldowns(env, now);

  const { results } = await env.DB.prepare(
    "SELECT * FROM accounts WHERE enabled=1 ORDER BY created_at ASC, id ASC"
  ).all<AccountRow>();
  const accounts = shuffle(results ?? []);

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]!;
    if (i > 0) await sleep(gapMin + Math.random() * (gapMax - gapMin));
    try {
      const state = await getCheckinState(env, account.id);
      const slot = dueSlot(settings, state, now);
      if (!slot) {
        summary.idle += 1;
        continue;
      }
      const fresh = state.last_attempt_slot !== slot;
      const lastAttempt = await lastAttemptAt(env, account.id);
      const backoffOk = !lastAttempt || now.getTime() - lastAttempt >= RETRY_BACKOFF_MS;
      const retryable = state.status === "retry" && state.retry_count < RETRY_MAX && backoffOk;
      if (!fresh && !retryable) continue;

      summary.attempted += 1;
      const result = await performCheckin(env, account, slot, { fetch: fetchImpl });
      if (result.ok) summary.success += 1;
      else if (result.status === "retry") summary.retry += 1;
      else summary.terminal += 1;
    } catch (err) {
      console.error("[scheduled]", account.id, err);
    }
  }

  try {
    const refresh = await refreshAllGems(env, fetchImpl);
    summary.refreshed = refresh.refreshed;
  } catch (err) {
    console.error("[scheduled] refresh_gems", err);
  }

  const next = nextSlot(settings, now);
  await env.DB.prepare("UPDATE checkin_settings SET next_run_at=?, updated_at=? WHERE id=1")
    .bind(next, nowIso())
    .run();

  return summary;
}
