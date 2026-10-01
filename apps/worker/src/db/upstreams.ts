import type { Env } from "../types";
import { encrypt, decrypt } from "../lib/crypto";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import { parseJson } from "../lib/json";

export const UPSTREAM_AUTH_INFO = "upstreams";

export interface UpstreamRow {
  id: string;
  name: string;
  type: string;
  base_url: string;
  auth_enc: string | null;
  models_json: string;
  capabilities_json: string;
  transform_json: string;
  priority: number;
  weight: number;
  enabled: number;
  created_at: string;
}

export interface UpstreamPublic {
  id: string;
  name: string;
  type: string;
  base_url: string;
  has_auth: boolean;
  models: string[];
  capabilities: Record<string, unknown>;
  transform: Record<string, unknown>;
  priority: number;
  weight: number;
  enabled: boolean;
  created_at: string;
}

export interface UpstreamInput {
  name?: string;
  type?: string;
  base_url?: string;
  auth?: string | null;
  models?: string[];
  capabilities?: Record<string, unknown>;
  transform?: Record<string, unknown>;
  priority?: number;
  weight?: number;
  enabled?: boolean;
}

export const ACCOUNT_STRATEGIES = ["round_robin", "balance_first", "fixed"] as const;
export type AccountStrategy = (typeof ACCOUNT_STRATEGIES)[number];
export const DEFAULT_ACCOUNT_STRATEGY: AccountStrategy = "round_robin";

export function parseAccountStrategy(capabilitiesJson: string | null | undefined): AccountStrategy {
  const caps = parseJson<Record<string, unknown>>(capabilitiesJson, {});
  const raw = caps.account_strategy;
  return typeof raw === "string" && (ACCOUNT_STRATEGIES as readonly string[]).includes(raw)
    ? (raw as AccountStrategy)
    : DEFAULT_ACCOUNT_STRATEGY;
}

export interface ModelRow {
  logical_name: string;
  upstream_id: string;
  upstream_model: string;
  enabled: number;
}

function bool(value: number | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value !== 0;
}

export function toUpstreamPublic(row: UpstreamRow): UpstreamPublic {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    base_url: row.base_url,
    has_auth: Boolean(row.auth_enc),
    models: parseJson<string[]>(row.models_json, []),
    capabilities: parseJson<Record<string, unknown>>(row.capabilities_json, {}),
    transform: parseJson<Record<string, unknown>>(row.transform_json, {}),
    priority: row.priority,
    weight: row.weight,
    enabled: bool(row.enabled, true),
    created_at: row.created_at
  };
}

export async function listUpstreams(env: Env): Promise<UpstreamPublic[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM upstreams ORDER BY priority DESC, created_at ASC"
  ).all<UpstreamRow>();
  return (results ?? []).map(toUpstreamPublic);
}

export async function getUpstream(env: Env, id: string): Promise<UpstreamRow | null> {
  return env.DB.prepare("SELECT * FROM upstreams WHERE id=?").bind(id).first<UpstreamRow>();
}

export async function getUpstreamSecret(env: Env, id: string): Promise<string | null> {
  const row = await getUpstream(env, id);
  if (!row?.auth_enc) return null;
  return decrypt(row.auth_enc, env.ENCRYPTION_KEY, UPSTREAM_AUTH_INFO);
}

export async function createUpstream(env: Env, input: UpstreamInput): Promise<UpstreamRow> {
  const id = newId();
  const authEnc = input.auth
    ? await encrypt(input.auth, env.ENCRYPTION_KEY, UPSTREAM_AUTH_INFO)
    : null;
  await env.DB.prepare(
    "INSERT INTO upstreams (id, name, type, base_url, auth_enc, models_json, capabilities_json, transform_json, priority, weight, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      id,
      input.name ?? "",
      input.type ?? "nai-compatible",
      input.base_url ?? "",
      authEnc,
      JSON.stringify(input.models ?? []),
      JSON.stringify(input.capabilities ?? {}),
      JSON.stringify(input.transform ?? {}),
      input.priority ?? 0,
      input.weight ?? 1,
      input.enabled === false ? 0 : 1,
      nowIso()
    )
    .run();
  return (await getUpstream(env, id))!;
}

export async function updateUpstream(
  env: Env,
  id: string,
  patch: UpstreamInput
): Promise<UpstreamRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column}=?`);
    vals.push(value);
  };

  if (patch.name !== undefined) set("name", patch.name);
  if (patch.type !== undefined) set("type", patch.type);
  if (patch.base_url !== undefined) set("base_url", patch.base_url);
  if (patch.auth !== undefined) {
    set(
      "auth_enc",
      patch.auth ? await encrypt(patch.auth, env.ENCRYPTION_KEY, UPSTREAM_AUTH_INFO) : null
    );
  }
  if (patch.models !== undefined) set("models_json", JSON.stringify(patch.models));
  if (patch.capabilities !== undefined) set("capabilities_json", JSON.stringify(patch.capabilities));
  if (patch.transform !== undefined) set("transform_json", JSON.stringify(patch.transform));
  if (patch.priority !== undefined) set("priority", patch.priority);
  if (patch.weight !== undefined) set("weight", patch.weight);
  if (patch.enabled !== undefined) set("enabled", patch.enabled ? 1 : 0);

  if (!sets.length) return getUpstream(env, id);
  vals.push(id);
  await env.DB.prepare(`UPDATE upstreams SET ${sets.join(", ")} WHERE id=?`).bind(...vals).run();
  return getUpstream(env, id);
}

export async function deleteUpstream(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM upstreams WHERE id=?").bind(id).run();
}

export async function upsertModel(
  env: Env,
  logicalName: string,
  upstreamId: string,
  upstreamModel: string,
  enabled = true
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO models (logical_name, upstream_id, upstream_model, enabled) VALUES (?,?,?,?) ON CONFLICT(logical_name, upstream_id) DO UPDATE SET upstream_model=excluded.upstream_model, enabled=excluded.enabled"
  )
    .bind(logicalName, upstreamId, upstreamModel, enabled ? 1 : 0)
    .run();
}

export async function listModels(env: Env): Promise<ModelRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT logical_name, upstream_id, upstream_model, enabled FROM models ORDER BY logical_name ASC"
  ).all<ModelRow>();
  return results ?? [];
}
