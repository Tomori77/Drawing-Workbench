import type { Env } from "../types";
import { sha256Hex } from "../lib/crypto";
import { randomKey, newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import { parseJson } from "../lib/json";

export const API_KEY_PREFIX = "dwb-";

export interface ApiKeyRow {
  id: string;
  key_hash: string;
  name: string | null;
  role: string;
  mode: string;
  policy_json: string;
  allowed_models_json: string;
  allowed_upstreams_json: string;
  quota: number | null;
  used_count: number;
  rate_limit: number | null;
  expires_at: string | null;
  enabled: number;
  created_at: string;
}

export interface ApiKeyPublic {
  id: string;
  name: string | null;
  role: string;
  mode: string;
  policy: Record<string, unknown>;
  allowed_models: string[];
  allowed_upstreams: string[];
  quota: number | null;
  used_count: number;
  rate_limit: number | null;
  expires_at: string | null;
  enabled: boolean;
  created_at: string;
}

export interface ApiKeyInput {
  name?: string | null;
  role?: string;
  mode?: string;
  policy?: Record<string, unknown>;
  allowed_models?: string[];
  allowed_upstreams?: string[];
  quota?: number | null;
  rate_limit?: number | null;
  expires_at?: string | null;
  enabled?: boolean;
}

export interface CreatedApiKey {
  key: string;
  record: ApiKeyPublic;
}

export function toApiKeyPublic(row: ApiKeyRow): ApiKeyPublic {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    mode: row.mode,
    policy: parseJson<Record<string, unknown>>(row.policy_json, {}),
    allowed_models: parseJson<string[]>(row.allowed_models_json, []),
    allowed_upstreams: parseJson<string[]>(row.allowed_upstreams_json, []),
    quota: row.quota,
    used_count: row.used_count,
    rate_limit: row.rate_limit,
    expires_at: row.expires_at,
    enabled: row.enabled !== 0,
    created_at: row.created_at
  };
}

export async function createApiKey(env: Env, input: ApiKeyInput): Promise<CreatedApiKey> {
  const id = newId();
  const key = randomKey(API_KEY_PREFIX);
  const keyHash = await sha256Hex(key);
  await env.DB.prepare(
    "INSERT INTO api_keys (id, key_hash, name, role, mode, policy_json, allowed_models_json, allowed_upstreams_json, quota, used_count, rate_limit, expires_at, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      id,
      keyHash,
      input.name ?? null,
      input.role ?? "friend",
      input.mode ?? "restricted",
      JSON.stringify(input.policy ?? {}),
      JSON.stringify(input.allowed_models ?? []),
      JSON.stringify(input.allowed_upstreams ?? []),
      input.quota ?? null,
      0,
      input.rate_limit ?? null,
      input.expires_at ?? null,
      input.enabled === false ? 0 : 1,
      nowIso()
    )
    .run();
  const row = (await getApiKey(env, id))!;
  return { key, record: toApiKeyPublic(row) };
}

export async function getApiKey(env: Env, id: string): Promise<ApiKeyRow | null> {
  return env.DB.prepare("SELECT * FROM api_keys WHERE id=?").bind(id).first<ApiKeyRow>();
}

export async function getApiKeyByKey(env: Env, plainKey: string): Promise<ApiKeyRow | null> {
  const keyHash = await sha256Hex(plainKey);
  return env.DB.prepare("SELECT * FROM api_keys WHERE key_hash=?").bind(keyHash).first<ApiKeyRow>();
}

export async function listApiKeys(env: Env): Promise<ApiKeyPublic[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM api_keys ORDER BY created_at DESC"
  ).all<ApiKeyRow>();
  return (results ?? []).map(toApiKeyPublic);
}

export async function updateApiKey(
  env: Env,
  id: string,
  patch: ApiKeyInput
): Promise<ApiKeyRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column}=?`);
    vals.push(value);
  };

  if (patch.name !== undefined) set("name", patch.name);
  if (patch.role !== undefined) set("role", patch.role);
  if (patch.mode !== undefined) set("mode", patch.mode);
  if (patch.policy !== undefined) set("policy_json", JSON.stringify(patch.policy));
  if (patch.allowed_models !== undefined) set("allowed_models_json", JSON.stringify(patch.allowed_models));
  if (patch.allowed_upstreams !== undefined) {
    set("allowed_upstreams_json", JSON.stringify(patch.allowed_upstreams));
  }
  if (patch.quota !== undefined) set("quota", patch.quota);
  if (patch.rate_limit !== undefined) set("rate_limit", patch.rate_limit);
  if (patch.expires_at !== undefined) set("expires_at", patch.expires_at);
  if (patch.enabled !== undefined) set("enabled", patch.enabled ? 1 : 0);

  if (!sets.length) return getApiKey(env, id);
  vals.push(id);
  await env.DB.prepare(`UPDATE api_keys SET ${sets.join(", ")} WHERE id=?`).bind(...vals).run();
  return getApiKey(env, id);
}

export async function deleteApiKey(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM api_keys WHERE id=?").bind(id).run();
}
