import type { Env } from "../types";
import { encrypt, decrypt } from "../lib/crypto";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";

export const ACCOUNT_AUTH_INFO = "credentials";

export interface AccountSecret {
  jwt?: string;
  password?: string;
  apiToken?: string;
}

export interface AccountRow {
  id: string;
  upstream_id: string;
  label: string | null;
  username: string;
  credential_enc: string | null;
  gems_last: number | null;
  enabled: number;
  status: string;
  failure_count: number;
  cooldown_until: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountPublic {
  id: string;
  upstream_id: string;
  label: string | null;
  username: string;
  has_jwt: boolean;
  has_password: boolean;
  has_api_token: boolean;
  gems_last: number | null;
  enabled: boolean;
  status: string;
  failure_count: number;
  cooldown_until: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountInput {
  upstream_id: string;
  username: string;
  label?: string | null;
  jwt?: string | null;
  password?: string | null;
  apiToken?: string | null;
}

export interface AccountWithSecret {
  account: AccountRow;
  secret: AccountSecret | null;
}

export interface AccountPatch {
  label?: string | null;
  username?: string;
  enabled?: boolean;
  status?: string;
  gems_last?: number | null;
  failure_count?: number;
  cooldown_until?: string | null;
  last_success_at?: string | null;
  jwt?: string | null;
  password?: string | null;
  apiToken?: string | null;
}

function normalizeSecret(input: AccountSecret): AccountSecret {
  const out: AccountSecret = {};
  if (input.jwt) out.jwt = input.jwt;
  if (input.password) out.password = input.password;
  if (input.apiToken) out.apiToken = input.apiToken;
  return out;
}

async function sealSecret(env: Env, secret: AccountSecret): Promise<string | null> {
  const normalized = normalizeSecret(secret);
  if (!Object.keys(normalized).length) return null;
  return encrypt(JSON.stringify(normalized), env.ENCRYPTION_KEY, ACCOUNT_AUTH_INFO);
}

export function toAccountPublic(row: AccountRow, secret?: AccountSecret | null): AccountPublic {
  return {
    id: row.id,
    upstream_id: row.upstream_id,
    label: row.label,
    username: row.username,
    has_jwt: Boolean(secret?.jwt),
    has_password: Boolean(secret?.password),
    has_api_token: Boolean(secret?.apiToken),
    gems_last: row.gems_last,
    enabled: row.enabled !== 0,
    status: row.status,
    failure_count: row.failure_count,
    cooldown_until: row.cooldown_until,
    last_success_at: row.last_success_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function decryptCredential(env: Env, cipher: string | null): Promise<AccountSecret | null> {
  if (!cipher) return null;
  try {
    return JSON.parse(await decrypt(cipher, env.ENCRYPTION_KEY, ACCOUNT_AUTH_INFO)) as AccountSecret;
  } catch {
    return null;
  }
}

export async function presentAccount(env: Env, row: AccountRow): Promise<AccountPublic> {
  return toAccountPublic(row, await decryptCredential(env, row.credential_enc));
}

export async function listAccounts(env: Env, upstreamId?: string): Promise<AccountRow[]> {
  if (upstreamId) {
    const { results } = await env.DB.prepare(
      "SELECT * FROM accounts WHERE upstream_id=? ORDER BY created_at ASC, id ASC"
    )
      .bind(upstreamId)
      .all<AccountRow>();
    return results ?? [];
  }
  const { results } = await env.DB.prepare(
    "SELECT * FROM accounts ORDER BY created_at ASC, id ASC"
  ).all<AccountRow>();
  return results ?? [];
}

export async function listAccountsPublic(env: Env, upstreamId?: string): Promise<AccountPublic[]> {
  const rows = await listAccounts(env, upstreamId);
  return Promise.all(rows.map((row) => presentAccount(env, row)));
}

export async function getAccount(env: Env, id: string): Promise<AccountRow | null> {
  return env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(id).first<AccountRow>();
}

export async function createAccount(env: Env, input: AccountInput): Promise<AccountRow> {
  const id = newId();
  const now = nowIso();
  const enc = await sealSecret(env, {
    jwt: input.jwt ?? undefined,
    password: input.password ?? undefined,
    apiToken: input.apiToken ?? undefined
  });
  await env.DB.prepare(
    "INSERT INTO accounts (id, upstream_id, label, username, credential_enc, gems_last, enabled, status, failure_count, cooldown_until, last_success_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      id,
      input.upstream_id,
      input.label ?? null,
      input.username,
      enc,
      null,
      1,
      "pending",
      0,
      null,
      null,
      now,
      now
    )
    .run();
  return (await getAccount(env, id))!;
}

export async function updateAccount(
  env: Env,
  id: string,
  patch: AccountPatch
): Promise<AccountRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column}=?`);
    vals.push(value);
  };

  if (patch.label !== undefined) set("label", patch.label);
  if (patch.username !== undefined) set("username", patch.username);
  if (patch.enabled !== undefined) set("enabled", patch.enabled ? 1 : 0);
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.gems_last !== undefined) set("gems_last", patch.gems_last);
  if (patch.failure_count !== undefined) set("failure_count", patch.failure_count);
  if (patch.cooldown_until !== undefined) set("cooldown_until", patch.cooldown_until);
  if (patch.last_success_at !== undefined) set("last_success_at", patch.last_success_at);

  const touchesSecret =
    patch.jwt !== undefined || patch.password !== undefined || patch.apiToken !== undefined;
  if (touchesSecret) {
    const current = await getAccountSecret(env, id);
    const next: AccountSecret = { ...(current ?? {}) };
    if (patch.jwt !== undefined) {
      if (patch.jwt) next.jwt = patch.jwt;
      else delete next.jwt;
    }
    if (patch.password !== undefined) {
      if (patch.password) next.password = patch.password;
      else delete next.password;
    }
    if (patch.apiToken !== undefined) {
      if (patch.apiToken) next.apiToken = patch.apiToken;
      else delete next.apiToken;
    }
    set("credential_enc", await sealSecret(env, next));
  }

  if (!sets.length) return getAccount(env, id);
  set("updated_at", nowIso());
  vals.push(id);
  await env.DB.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id=?`).bind(...vals).run();
  return getAccount(env, id);
}

export async function deleteAccount(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM accounts WHERE id=?").bind(id).run();
}

export async function getAccountSecret(env: Env, id: string): Promise<AccountSecret | null> {
  const row = await getAccount(env, id);
  return decryptCredential(env, row?.credential_enc ?? null);
}

export async function getAccountWithSecret(env: Env, id: string): Promise<AccountWithSecret | null> {
  const account = await getAccount(env, id);
  if (!account) return null;
  return { account, secret: await decryptCredential(env, account.credential_enc) };
}

export async function setAccountSecret(env: Env, id: string, secret: AccountSecret): Promise<void> {
  await env.DB.prepare("UPDATE accounts SET credential_enc=?, updated_at=? WHERE id=?")
    .bind(await sealSecret(env, secret), nowIso(), id)
    .run();
}
