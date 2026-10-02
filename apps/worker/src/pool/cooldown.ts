import type { Env } from "../types";
import { getKv } from "./kv";
import { parseJson } from "../lib/json";
import { nowIso } from "../lib/time";

export interface CooldownConfig {
  enabled: boolean;
  threshold: number;
  duration_ms: number;
}

export const DEFAULT_COOLDOWN_CONFIG: CooldownConfig = {
  enabled: true,
  threshold: 3,
  duration_ms: 300_000
};

export const COOLDOWN_STATUS_CODES = new Set([401, 402, 429]);

export function isCooldownTrigger(statusCode: number): boolean {
  return COOLDOWN_STATUS_CODES.has(statusCode) || statusCode >= 500;
}

export function cooldownKvKey(upstreamId: string): string {
  return `account_cooldown:${upstreamId}`;
}

function normalizeConfig(raw: Record<string, unknown>): CooldownConfig {
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_COOLDOWN_CONFIG.enabled;
  const threshold = Number(raw.threshold);
  const duration = Number(raw.duration_ms);
  return {
    enabled,
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_COOLDOWN_CONFIG.threshold,
    duration_ms: Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_COOLDOWN_CONFIG.duration_ms
  };
}

export async function getCooldownConfig(env: Env, upstreamId: string): Promise<CooldownConfig> {
  const kv = await getKv(env, cooldownKvKey(upstreamId));
  const parsed = parseJson<Record<string, unknown> | null>(kv, null);
  if (parsed) return normalizeConfig(parsed);

  const upstream = await env.DB.prepare("SELECT capabilities_json FROM upstreams WHERE id=?")
    .bind(upstreamId)
    .first<{ capabilities_json: string }>();
  const caps = parseJson<Record<string, unknown>>(upstream?.capabilities_json ?? null, {});
  const fromCaps = caps.account_cooldown;
  if (fromCaps && typeof fromCaps === "object") return normalizeConfig(fromCaps as Record<string, unknown>);
  return { ...DEFAULT_COOLDOWN_CONFIG };
}

async function readRateState(
  env: Env,
  accountId: string
): Promise<{ failure_count: number } | null> {
  return env.DB.prepare("SELECT failure_count FROM account_rate_state WHERE account_id=?")
    .bind(accountId)
    .first<{ failure_count: number }>();
}

export async function markAccountFailure(
  env: Env,
  accountId: string,
  statusCode: number,
  upstreamId?: string
): Promise<{ failure_count: number; cooldown_until: string | null }> {
  const account = await env.DB.prepare("SELECT upstream_id, failure_count FROM accounts WHERE id=?")
    .bind(accountId)
    .first<{ upstream_id: string; failure_count: number }>();
  if (!account) return { failure_count: 0, cooldown_until: null };

  const config = await getCooldownConfig(env, upstreamId ?? account.upstream_id);
  const state = await readRateState(env, accountId);
  const failureCount = (state?.failure_count ?? account.failure_count ?? 0) + 1;

  let cooldownUntil: string | null = null;
  if (isCooldownTrigger(statusCode) && config.enabled && failureCount >= config.threshold) {
    cooldownUntil = new Date(Date.now() + config.duration_ms).toISOString();
  }

  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO account_rate_state (account_id, failure_count, cooldown_until, last_status, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET failure_count=excluded.failure_count, cooldown_until=excluded.cooldown_until, last_status=excluded.last_status, updated_at=excluded.updated_at"
  )
    .bind(accountId, failureCount, cooldownUntil, statusCode, now)
    .run();

  // 仅在触发冷却时改写 status 为 "cooling"；未达阈值时保持原 status，避免账号状态被失败污染。
  await env.DB.prepare(
    "UPDATE accounts SET failure_count=?, cooldown_until=?, status=CASE WHEN ?=1 THEN 'cooling' ELSE status END, updated_at=? WHERE id=?"
  )
    .bind(failureCount, cooldownUntil, cooldownUntil ? 1 : 0, now, accountId)
    .run();

  return { failure_count: failureCount, cooldown_until: cooldownUntil };
}

export async function markAccountSuccess(env: Env, accountId: string): Promise<void> {
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO account_rate_state (account_id, failure_count, cooldown_until, last_status, updated_at) VALUES (?,0,NULL,200,?) ON CONFLICT(account_id) DO UPDATE SET failure_count=0, cooldown_until=NULL, last_status=200, updated_at=excluded.updated_at"
  )
    .bind(accountId, now)
    .run();
  await env.DB.prepare(
    "UPDATE accounts SET failure_count=0, cooldown_until=NULL, status=?, last_success_at=?, updated_at=? WHERE id=?"
  )
    .bind("active", now, now, accountId)
    .run();
}
