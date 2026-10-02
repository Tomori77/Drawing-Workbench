import type { Env } from "../types";
import { getAccountSecret, updateAccount, type AccountRow } from "../db/accounts";
import { getUpstream, type UpstreamRow } from "../db/upstreams";
import { joinUrl } from "../lib/url";
import { truncateLog } from "../lib/log";
import { refreshJwt, UpstreamHttpError, type FetchLike } from "./login";
import { shanghaiTimestamp } from "../lib/time";

export const PROVISION_TOKEN_PREFIX = "DW";

export function provisionTokenName(date: Date = new Date()): string {
  return `${PROVISION_TOKEN_PREFIX}-${shanghaiTimestamp(date)}`;
}

function pickMessage(data: Record<string, unknown>, fallback: string): string {
  const detail = data.detail ?? data.message ?? (data.error as Record<string, unknown> | undefined)?.message;
  return truncateLog(typeof detail === "string" && detail ? detail : fallback);
}

async function createKey(
  baseUrl: string,
  jwt: string,
  name: string,
  fetchImpl: FetchLike
): Promise<string> {
  const resp = await fetchImpl(joinUrl(baseUrl, "/api/ynai/tokens"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      name,
      allowed_models: [],
      daily_gems_limit: null,
      total_gems_limit: null,
      max_gems_per_request: null,
      allow_paid_requests: true,
      allow_free_tier_requests: true
    })
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  const token = (data.data as Record<string, unknown> | undefined)?.token;
  if (resp.ok && typeof token === "string" && token) return token;
  const status = resp.ok ? 502 : resp.status === 401 ? 401 : 502;
  throw new UpstreamHttpError(
    pickMessage(data, `create token failed (HTTP ${resp.status})`),
    status,
    "TOKEN_PROVISION_FAILED"
  );
}

export interface ProvisionOptions {
  // force=true 时忽略已有 apiToken，强制向上游新建（owner 显式点击时使用）。
  force?: boolean;
}

export async function provisionToken(
  env: Env,
  account: AccountRow,
  upstream?: UpstreamRow | null,
  fetchImpl: FetchLike = fetch,
  name?: string,
  options?: ProvisionOptions
): Promise<string> {
  const row = upstream ?? (await getUpstream(env, account.upstream_id));
  if (!row) throw new UpstreamHttpError("upstream_not_found", 404, "NO_UPSTREAM");

  const secret = await getAccountSecret(env, account.id);
  // 复用：账号已有生图 key 且非强制新建时，直接返回，不请求上游。
  if (!options?.force && secret?.apiToken) return secret.apiToken;

  const jwt = secret?.jwt;
  if (!jwt) throw new UpstreamHttpError("account has no jwt", 400, "ACCOUNT_NO_JWT");

  const tokenName = name && name.trim() ? name.trim() : provisionTokenName();

  const attemptWith = async (useJwt: string): Promise<string> => {
    try {
      return await createKey(row.base_url, useJwt, tokenName, fetchImpl);
    } catch {
      return await createKey(row.base_url, useJwt, `${tokenName}-${Date.now() % 1000}`, fetchImpl);
    }
  };

  let token: string;
  try {
    token = await attemptWith(jwt);
  } catch (err) {
    const fresh = await refreshJwt(env, account, fetchImpl).catch(() => null);
    if (!fresh) throw err;
    token = await attemptWith(fresh);
  }

  await updateAccount(env, account.id, { apiToken: token });
  return token;
}
