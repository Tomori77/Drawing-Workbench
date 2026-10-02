import type { Env } from "../types";
import type { ApiKeyRow } from "../db/apiKeys";
import { getApiKeyByKey } from "../db/apiKeys";
import { normalizePolicy, type GatewayPolicy } from "./policy";

function extractBearer(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

// GET /generate 允许 query token（下游魔改版兼容）；其余端点仅认 Bearer。
export function extractGatewayKey(request: Request, allowQueryToken: boolean): string {
  const bearer = extractBearer(request);
  if (bearer) return bearer;
  if (allowQueryToken) {
    try {
      return (new URL(request.url).searchParams.get("token") ?? "").trim();
    } catch {
      return "";
    }
  }
  return "";
}

function isExpired(row: ApiKeyRow, nowMs: number): boolean {
  if (!row.expires_at) return false;
  const at = Date.parse(row.expires_at);
  return Number.isFinite(at) && at <= nowMs;
}

export async function authenticateGatewayKey(
  env: Env,
  request: Request,
  options: { allowQueryToken?: boolean } = {}
): Promise<ApiKeyRow | null> {
  const key = extractGatewayKey(request, options.allowQueryToken === true);
  if (!key) return null;

  const row = await getApiKeyByKey(env, key);
  if (!row) return null;
  if (row.enabled === 0) return null;
  if (isExpired(row, Date.now())) return null;
  return row;
}

export function gatewayKeyToPolicy(row: ApiKeyRow): GatewayPolicy {
  let raw: unknown = {};
  try {
    raw = JSON.parse(row.policy_json || "{}");
  } catch {
    raw = {};
  }
  return normalizePolicy(raw);
}

export function gatewayKeyAllowedModels(row: ApiKeyRow): string[] {
  try {
    const list = JSON.parse(row.allowed_models_json || "[]") as unknown;
    return Array.isArray(list) ? list.map((m) => String(m)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function gatewayKeyAllowedUpstreams(row: ApiKeyRow): string[] {
  try {
    const list = JSON.parse(row.allowed_upstreams_json || "[]") as unknown;
    return Array.isArray(list) ? list.map((m) => String(m)).filter(Boolean) : [];
  } catch {
    return [];
  }
}
