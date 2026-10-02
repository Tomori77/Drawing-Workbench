import type { Env } from "../types";
import { newId } from "../lib/ids";
import { nowIso, todayInShanghai } from "../lib/time";

export type ReserveFailure = "requests" | "gems";

export type ReserveResult = { ok: true } | { ok: false; reason: ReserveFailure };

function changesOf(result: { meta?: { changes?: number } }): number {
  return result.meta?.changes ?? 0;
}

export async function reserveDaily(
  env: Env,
  keyId: string,
  dailyRequests: number,
  dailyGems: number
): Promise<ReserveResult> {
  const usageDate = todayInShanghai();
  const result = await env.DB.prepare(
    `INSERT INTO daily_usage(gateway_key_id, usage_date, request_count, gem_count, updated_at)
     VALUES (?,?,1,0,?)
     ON CONFLICT(gateway_key_id, usage_date)
     DO UPDATE SET request_count=request_count+1, updated_at=excluded.updated_at
     WHERE (? <= 0 OR request_count < ?) AND (? <= 0 OR gem_count < ?)`
  )
    .bind(keyId, usageDate, nowIso(), dailyRequests, dailyRequests, dailyGems, dailyGems)
    .run();

  if (changesOf(result) > 0) return { ok: true };

  const usage = await env.DB.prepare(
    "SELECT request_count, gem_count FROM daily_usage WHERE gateway_key_id=? AND usage_date=?"
  )
    .bind(keyId, usageDate)
    .first<{ request_count: number; gem_count: number }>();

  if (dailyRequests > 0 && (usage?.request_count ?? 0) >= dailyRequests) {
    return { ok: false, reason: "requests" };
  }
  return { ok: false, reason: "gems" };
}

export async function addUsageGems(env: Env, keyId: string, costGems: number): Promise<void> {
  if (!(costGems > 0)) return;
  const usageDate = todayInShanghai();
  await env.DB.prepare(
    `INSERT INTO daily_usage(gateway_key_id, usage_date, request_count, gem_count, updated_at)
     VALUES (?,?,0,?,?)
     ON CONFLICT(gateway_key_id, usage_date)
     DO UPDATE SET gem_count=gem_count+excluded.gem_count, updated_at=excluded.updated_at`
  )
    .bind(keyId, usageDate, costGems, nowIso())
    .run();
}

export interface LeaseHandle {
  leaseId: string;
  tracked: boolean;
}

export async function acquireLease(
  env: Env,
  keyId: string,
  maxConcurrency: number,
  ttlMs: number
): Promise<LeaseHandle | null> {
  const leaseId = newId();
  if (!(maxConcurrency > 0)) {
    return { leaseId, tracked: false };
  }

  const now = nowIso();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO concurrency_leases(lease_id, gateway_key_id, account_id, expires_at, created_at)
     SELECT ?,?,?,?,?
     WHERE (SELECT COUNT(*) FROM concurrency_leases WHERE gateway_key_id=? AND expires_at>?) < ?`
  )
    .bind(leaseId, keyId, null, expiresAt, now, keyId, now, maxConcurrency)
    .run();

  if (changesOf(result) === 0) return null;
  return { leaseId, tracked: true };
}

export async function releaseLease(env: Env, handle: LeaseHandle): Promise<void> {
  await env.DB.prepare("DELETE FROM concurrency_leases WHERE lease_id=?")
    .bind(handle.leaseId)
    .run()
    .catch(() => {});
}
