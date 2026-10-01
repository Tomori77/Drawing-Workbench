import type { Env } from "../types";
import { getAccountSecret, setAccountSecret, type AccountRow, type AccountSecret } from "../db/accounts";
import { getUpstream } from "../db/upstreams";
import { joinUrl } from "../lib/url";
import { truncateLog } from "../lib/log";

export type FetchLike = typeof fetch;

export class UpstreamHttpError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "UPSTREAM_ERROR") {
    super(message);
    this.name = "UpstreamHttpError";
    this.status = status;
    this.code = code;
  }
}

async function readJson(resp: Response): Promise<Record<string, unknown>> {
  return (await resp.json().catch(() => ({}))) as Record<string, unknown>;
}

function pickMessage(data: Record<string, unknown>, fallback: string): string {
  const detail = data.detail ?? data.message ?? (data.error as Record<string, unknown> | undefined)?.message;
  return truncateLog(typeof detail === "string" && detail ? detail : fallback);
}

export async function loginUpstreamAccount(
  baseUrl: string,
  username: string,
  password: string,
  fetchImpl: FetchLike = fetch
): Promise<{ jwt: string }> {
  const resp = await fetchImpl(joinUrl(baseUrl, "/api/ynai/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await readJson(resp);
  const payload = (data.data ?? {}) as Record<string, unknown>;
  const jwt = payload.access_token;
  if (!resp.ok || typeof jwt !== "string" || !jwt) {
    const status = resp.ok ? 400 : resp.status === 401 ? 401 : 502;
    throw new UpstreamHttpError(
      pickMessage(data, `login failed (HTTP ${resp.status})`),
      status,
      "LOGIN_FAILED"
    );
  }
  return { jwt };
}

export async function refreshJwt(
  env: Env,
  account: AccountRow,
  fetchImpl: FetchLike = fetch
): Promise<string | null> {
  const secret = await getAccountSecret(env, account.id);
  if (!secret?.password) return null;
  const upstream = await getUpstream(env, account.upstream_id);
  if (!upstream) return null;
  const { jwt } = await loginUpstreamAccount(upstream.base_url, account.username, secret.password, fetchImpl);
  const next: AccountSecret = { ...secret, jwt };
  await setAccountSecret(env, account.id, next);
  return jwt;
}
