import type { Env } from "../types";
import {
  getAccountSecret,
  listAccounts,
  type AccountRow,
  type AccountSecret
} from "../db/accounts";
import { getUpstream, parseAccountStrategy, type AccountStrategy } from "../db/upstreams";
import { bumpKv } from "./kv";
import {
  getAccountLimit,
  remainingFromUsage
} from "./limit";

type FetchLike = typeof fetch;

export type { AccountStrategy };

export interface SelectedAccount {
  account: AccountRow;
  token: string;
}

export interface ActiveAccount {
  account: AccountRow;
  secret: AccountSecret | null;
  token: string;
}

export interface SelectResult {
  candidates: SelectedAccount[];
  strategy: AccountStrategy;
  cooldown_skipped: number;
  limited_skipped: number;
  degraded: "cooldown" | "limit" | null;
  fallback: boolean;
}

function isCoolingDown(row: AccountRow, nowMs: number): boolean {
  if (!row.cooldown_until) return false;
  const until = Date.parse(row.cooldown_until);
  return Number.isFinite(until) && until > nowMs;
}

function cooldownDeadline(row: AccountRow): number {
  if (!row.cooldown_until) return -Infinity;
  const until = Date.parse(row.cooldown_until);
  return Number.isFinite(until) ? until : -Infinity;
}

interface UsageRow {
  account_id: string;
  window_start: string;
  image_count: number;
}

async function loadUsageMap(env: Env, accountIds: string[]): Promise<Map<string, { window_start: string; image_count: number }>> {
  const out = new Map<string, { window_start: string; image_count: number }>();
  if (!accountIds.length) return out;
  const placeholders = accountIds.map(() => "?").join(", ");
  const sql = `SELECT account_id, window_start, image_count FROM account_usage WHERE account_id IN (${placeholders})`;
  const { results } = await env.DB.prepare(sql).bind(...accountIds).all<UsageRow>();
  for (const row of results ?? []) out.set(row.account_id, row);
  return out;
}

function rotate<T>(items: T[], start: number): T[] {
  if (items.length <= 1) return items;
  const idx = ((start % items.length) + items.length) % items.length;
  return [...items.slice(idx), ...items.slice(0, idx)];
}

async function loadCandidates(env: Env, upstreamId: string): Promise<SelectedAccount[]> {
  const rows = await listAccounts(env, upstreamId);
  const out: SelectedAccount[] = [];
  for (const row of rows) {
    const secret = await getAccountSecret(env, row.id);
    if (!secret?.apiToken) continue;
    out.push({ account: row, token: secret.apiToken });
  }
  return out;
}

export interface SelectOptions {
  cursorKey?: string;
  accountId?: string;
}

export async function selectAccounts(
  env: Env,
  upstreamId: string,
  strategy: AccountStrategy = "round_robin",
  opts?: SelectOptions
): Promise<SelectResult> {
  const candidates = await loadCandidates(env, upstreamId);
  const nowMs = Date.now();
  const limit = await getAccountLimit(env, upstreamId);
  const usage = await loadUsageMap(
    env,
    candidates.map((item) => item.account.id)
  );
  const remaining = (item: SelectedAccount): number =>
    remainingFromUsage(usage.get(item.account.id) ?? null, limit, nowMs);

  const active = candidates.filter((item) => item.account.enabled !== 0);
  const ready = active.filter((item) => !isCoolingDown(item.account, nowMs));
  const notLimited = ready.filter((item) => remaining(item) > 0);
  const cooldownSkipped = candidates.length - active.length + (active.length - ready.length);
  const limitedSkipped = ready.length - notLimited.length;
  const pool = notLimited.length ? notLimited : [];

  let ordered: SelectedAccount[];
  switch (strategy) {
    case "balance_first":
      ordered = [...pool].sort(
        (a, b) => (b.account.gems_last ?? -1) - (a.account.gems_last ?? -1) || a.account.id.localeCompare(b.account.id)
      );
      break;
    case "fixed":
      ordered = [...pool].sort(
        (a, b) => a.account.created_at.localeCompare(b.account.created_at) || a.account.id.localeCompare(b.account.id)
      );
      break;
    case "round_robin":
    default: {
      const sorted = [...pool].sort((a, b) => a.account.id.localeCompare(b.account.id));
      const cursorKey = opts?.cursorKey ?? `rr_cursor:${upstreamId}`;
      let start = 0;
      if (sorted.length) {
        try {
          const cursor = await bumpKv(env, cursorKey);
          start = (cursor - 1) % sorted.length;
        } catch {
          start = 0;
        }
      }
      ordered = rotate(sorted, start);
      break;
    }
  }

  let degraded: SelectResult["degraded"] = null;
  let fallback = false;

  // 全部可用账号都被限额：以"剩余额度最多、其次冷却最早到期"作为兜底候选继续尝试。
  if (!pool.length && ready.length) {
    degraded = "limit";
    fallback = true;
    ordered = [...ready].sort(
      (a, b) =>
        remaining(b) - remaining(a) ||
        cooldownDeadline(a.account) - cooldownDeadline(b.account) ||
        a.account.id.localeCompare(b.account.id)
    );
  } else if (!pool.length && active.length) {
    // 全部账号都在冷却：以"冷却最早到期"作为兜底候选继续尝试。
    degraded = "cooldown";
    fallback = true;
    ordered = [...active].sort(
      (a, b) =>
        cooldownDeadline(a.account) - cooldownDeadline(b.account) ||
        remaining(b) - remaining(a) ||
        a.account.id.localeCompare(b.account.id)
    );
  }

  // 指定账号：若在候选中则提到第一位，其余按原策略顺序紧随其后（用于失败转移）。
  if (opts?.accountId) {
    const idx = ordered.findIndex((item) => item.account.id === opts.accountId);
    if (idx > 0) {
      const [picked] = ordered.splice(idx, 1);
      ordered = [picked!, ...ordered];
    }
  }

  return {
    candidates: ordered,
    strategy,
    cooldown_skipped: cooldownSkipped,
    limited_skipped: limitedSkipped,
    degraded,
    fallback
  };
}

export async function getActiveAccountForUpstream(
  env: Env,
  upstreamId: string,
  _fetchImpl?: FetchLike
): Promise<ActiveAccount | null> {
  const upstream = await getUpstream(env, upstreamId);
  const strategy = parseAccountStrategy(upstream?.capabilities_json);
  const result = await selectAccounts(env, upstreamId, strategy);
  const first = result.candidates[0];
  if (!first) return null;
  return {
    account: first.account,
    secret: await getAccountSecret(env, first.account.id),
    token: first.token
  };
}
