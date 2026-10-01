import type { Env } from "../types";
import { getAccountSecret, updateAccount, type AccountRow } from "../db/accounts";
import { getUpstream } from "../db/upstreams";
import { joinUrl } from "../lib/url";
import { refreshJwt, type FetchLike } from "./login";

export class BalanceError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "BALANCE_FAILED") {
    super(message);
    this.name = "BalanceError";
    this.status = status;
    this.code = code;
  }
}

function pickGems(data: Record<string, unknown>): number | null {
  const candidates: unknown[] = [
    (data.data as Record<string, unknown> | undefined)?.balance_gems,
    data.balance_gems,
    (data.data as Record<string, unknown> | undefined)?.gems,
    data.gems
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (raw !== undefined && raw !== null && Number.isFinite(n)) return n;
  }
  return null;
}

export async function fetchBalance(
  baseUrl: string,
  jwt: string,
  fetchImpl: FetchLike = fetch
): Promise<number> {
  const resp = await fetchImpl(joinUrl(baseUrl, "/api/ynai/user/balance"), {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${jwt}` }
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  const gems = pickGems(data);
  if (!resp.ok || gems === null) {
    throw new BalanceError(`balance query failed (HTTP ${resp.status})`, resp.ok ? 502 : resp.status);
  }
  return gems;
}

export async function refreshAccountGems(
  env: Env,
  account: AccountRow,
  fetchImpl: FetchLike = fetch
): Promise<number> {
  const upstream = await getUpstream(env, account.upstream_id);
  if (!upstream) throw new BalanceError("upstream_not_found", 404, "NO_UPSTREAM");

  let secret = await getAccountSecret(env, account.id);
  if (!secret?.jwt) {
    const jwt = await refreshJwt(env, account, fetchImpl);
    if (!jwt) throw new BalanceError("account has no jwt or password", 400, "ACCOUNT_NO_JWT");
    secret = { ...secret, jwt };
  }

  let gems: number;
  try {
    gems = await fetchBalance(upstream.base_url, secret.jwt!, fetchImpl);
  } catch (err) {
    if (!(err instanceof BalanceError) || err.status !== 401) throw err;
    const jwt = await refreshJwt(env, account, fetchImpl);
    if (!jwt) throw err;
    gems = await fetchBalance(upstream.base_url, jwt, fetchImpl);
  }

  await updateAccount(env, account.id, { gems_last: gems });
  return gems;
}

export interface RefreshAllResult {
  refreshed: number;
  failed: number;
  total_gems: number;
  items: Array<{ id: string; ok: boolean; gems?: number; error?: string }>;
}

export async function refreshAllGems(
  env: Env,
  fetchImpl: FetchLike = fetch
): Promise<RefreshAllResult> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM accounts WHERE enabled=1 ORDER BY created_at ASC, id ASC"
  ).all<AccountRow>();
  const rows = results ?? [];
  const items: RefreshAllResult["items"] = [];
  let total = 0;
  let refreshed = 0;
  for (const row of rows) {
    try {
      const gems = await refreshAccountGems(env, row, fetchImpl);
      total += gems;
      refreshed += 1;
      items.push({ id: row.id, ok: true, gems });
    } catch (err) {
      items.push({ id: row.id, ok: false, error: err instanceof Error ? err.message : "unknown" });
    }
  }
  return { refreshed, failed: rows.length - refreshed, total_gems: total, items };
}
