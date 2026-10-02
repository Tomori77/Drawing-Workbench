import type { Env } from "../types";
import { parseJson } from "../lib/json";
import { nowIso } from "../lib/time";

export interface AccountLimit {
  window_ms: number;
  max_images: number;
}

export const DEFAULT_ACCOUNT_LIMIT: AccountLimit = {
  window_ms: 600_000,
  max_images: 20
};

function pickPositive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function normalizeAccountLimit(raw: unknown): AccountLimit {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ACCOUNT_LIMIT };
  const record = raw as Record<string, unknown>;
  return {
    window_ms: pickPositive(record.window_ms, DEFAULT_ACCOUNT_LIMIT.window_ms),
    max_images: pickPositive(record.max_images, DEFAULT_ACCOUNT_LIMIT.max_images)
  };
}

export async function getAccountLimit(env: Env, upstreamId: string): Promise<AccountLimit> {
  const row = await env.DB.prepare("SELECT capabilities_json FROM upstreams WHERE id=?")
    .bind(upstreamId)
    .first<{ capabilities_json: string }>();
  const caps = parseJson<Record<string, unknown>>(row?.capabilities_json ?? null, {});
  return normalizeAccountLimit(caps.account_limit);
}

interface UsageRow {
  window_start: string;
  image_count: number;
}

async function readUsage(env: Env, accountId: string): Promise<UsageRow | null> {
  return env.DB.prepare("SELECT window_start, image_count FROM account_usage WHERE account_id=?")
    .bind(accountId)
    .first<UsageRow>();
}

function windowExpired(usage: UsageRow, limit: AccountLimit, nowMs: number): boolean {
  const start = Date.parse(usage.window_start);
  if (!Number.isFinite(start)) return true;
  return nowMs - start >= limit.window_ms;
}

export function remainingFromUsage(usage: UsageRow | null, limit: AccountLimit, nowMs: number): number {
  if (!usage) return limit.max_images;
  if (windowExpired(usage, limit, nowMs)) return limit.max_images;
  const remaining = limit.max_images - usage.image_count;
  return remaining > 0 ? remaining : 0;
}

export async function remainingImages(
  env: Env,
  accountId: string,
  limit: AccountLimit,
  now?: number
): Promise<number> {
  const nowMs = now ?? Date.now();
  return remainingFromUsage(await readUsage(env, accountId), limit, nowMs);
}

export async function isAccountLimited(
  env: Env,
  accountId: string,
  limit: AccountLimit,
  now?: number
): Promise<boolean> {
  return (await remainingImages(env, accountId, limit, now)) <= 0;
}

export async function addAccountImages(
  env: Env,
  accountId: string,
  n: number,
  limit: AccountLimit,
  now?: number
): Promise<void> {
  if (!Number.isFinite(n) || n <= 0) return;
  const nowMs = now ?? Date.now();
  const usage = await readUsage(env, accountId);
  const expired = usage ? windowExpired(usage, limit, nowMs) : true;
  const base = expired ? 0 : usage!.image_count;
  const windowStart = expired ? new Date(nowMs).toISOString() : usage!.window_start;
  await env.DB.prepare(
    "INSERT INTO account_usage (account_id, window_start, image_count, updated_at) VALUES (?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET window_start=excluded.window_start, image_count=excluded.image_count, updated_at=excluded.updated_at"
  )
    .bind(accountId, windowStart, base + n, nowIso())
    .run();
}
