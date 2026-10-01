import type { Env } from "../types";
import {
  getAccountSecret,
  listAccounts,
  type AccountRow,
  type AccountSecret
} from "../db/accounts";
import { getUpstream, parseAccountStrategy, type AccountStrategy } from "../db/upstreams";
import { bumpKv } from "./kv";

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
  degraded: "cooldown" | null;
}

function isCoolingDown(row: AccountRow, nowMs: number): boolean {
  if (!row.cooldown_until) return false;
  const until = Date.parse(row.cooldown_until);
  return Number.isFinite(until) && until > nowMs;
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

export async function selectAccounts(
  env: Env,
  upstreamId: string,
  strategy: AccountStrategy = "round_robin",
  _fetchImpl?: FetchLike
): Promise<SelectResult> {
  const candidates = await loadCandidates(env, upstreamId);
  const nowMs = Date.now();
  const ready = candidates.filter((item) => item.account.enabled !== 0 && !isCoolingDown(item.account, nowMs));
  const cooldownSkipped = candidates.length - ready.length;
  const pool = ready.length ? ready : [];

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
      let start = 0;
      if (sorted.length) {
        try {
          const cursor = await bumpKv(env, `rr_cursor:${upstreamId}`);
          start = (cursor - 1) % sorted.length;
        } catch {
          start = 0;
        }
      }
      ordered = rotate(sorted, start);
      break;
    }
  }

  return {
    candidates: ordered,
    strategy,
    cooldown_skipped: cooldownSkipped,
    degraded: !ready.length && candidates.length ? "cooldown" : null
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
