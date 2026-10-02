import type { Env } from "../types";
import { getKv, setKv } from "./kv";
import { parseJson } from "../lib/json";

export const WORKSPACE_SETTINGS_KEY = "workspace:generate_settings";

export const WORKSPACE_ACCOUNT_MODES = ["auto", "balance", "fixed"] as const;
export type WorkspaceAccountMode = (typeof WORKSPACE_ACCOUNT_MODES)[number];

export interface WorkspaceSettings {
  upstream_id?: string;
  account_mode: WorkspaceAccountMode;
  account_id?: string;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = { account_mode: "auto" };

function isAccountMode(value: unknown): value is WorkspaceAccountMode {
  return typeof value === "string" && (WORKSPACE_ACCOUNT_MODES as readonly string[]).includes(value);
}

export function normalizeWorkspaceSettings(raw: Record<string, unknown> | null): WorkspaceSettings {
  const out: WorkspaceSettings = { ...DEFAULT_WORKSPACE_SETTINGS };
  if (!raw) return out;
  if (typeof raw.upstream_id === "string" && raw.upstream_id) out.upstream_id = raw.upstream_id;
  if (isAccountMode(raw.account_mode)) out.account_mode = raw.account_mode;
  if (typeof raw.account_id === "string" && raw.account_id) out.account_id = raw.account_id;
  return out;
}

export async function getWorkspaceSettings(env: Env): Promise<WorkspaceSettings> {
  const value = await getKv(env, WORKSPACE_SETTINGS_KEY);
  return normalizeWorkspaceSettings(parseJson<Record<string, unknown> | null>(value, null));
}

export async function setWorkspaceSettings(
  env: Env,
  patch: Partial<WorkspaceSettings>
): Promise<WorkspaceSettings> {
  const current = await getWorkspaceSettings(env);
  const next: WorkspaceSettings = { ...current };

  if (patch.upstream_id !== undefined) {
    if (patch.upstream_id) next.upstream_id = patch.upstream_id;
    else delete next.upstream_id;
  }
  if (patch.account_mode !== undefined && isAccountMode(patch.account_mode)) {
    next.account_mode = patch.account_mode;
  }
  if (patch.account_id !== undefined) {
    if (patch.account_id) next.account_id = patch.account_id;
    else delete next.account_id;
  }

  await setKv(env, WORKSPACE_SETTINGS_KEY, JSON.stringify(next));
  return next;
}
