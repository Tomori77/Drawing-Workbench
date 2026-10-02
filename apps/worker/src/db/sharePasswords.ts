import type { Env } from "../types";
import { sha256Hex, timingSafeEqualStr } from "../lib/crypto";
import { randomKey, newId } from "../lib/ids";
import { nowIso } from "../lib/time";

export const DEFAULT_SHARE_QUOTA_BYTES = 524288000; // 500MB

export interface SharePasswordRow {
  id: string;
  label: string;
  salt: string;
  password_hash: string;
  role: string;
  quota_bytes: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface SharePasswordPublic {
  id: string;
  label: string;
  role: string;
  quota_bytes: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SharePasswordInput {
  label?: string;
  password: string;
  quota_bytes?: number;
}

export interface SharePasswordPatch {
  label?: string;
  password?: string;
  quota_bytes?: number;
  enabled?: boolean;
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`);
}

function toPublic(row: SharePasswordRow): SharePasswordPublic {
  return {
    id: row.id,
    label: row.label,
    role: row.role,
    quota_bytes: row.quota_bytes,
    enabled: row.enabled !== 0,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function defaultQuota(env: Env): number {
  const raw = env.DEFAULT_SHARE_QUOTA_BYTES;
  const n = Number(raw);
  if (raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0) return Math.floor(n);
  return DEFAULT_SHARE_QUOTA_BYTES;
}

export async function listSharePasswords(env: Env): Promise<SharePasswordPublic[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM share_passwords ORDER BY created_at DESC, rowid DESC"
  ).all<SharePasswordRow>();
  return (results ?? []).map(toPublic);
}

export async function getSharePassword(env: Env, id: string): Promise<SharePasswordRow | null> {
  return env.DB.prepare("SELECT * FROM share_passwords WHERE id=?").bind(id).first<SharePasswordRow>();
}

export async function createSharePassword(
  env: Env,
  input: SharePasswordInput
): Promise<SharePasswordPublic> {
  const id = newId();
  const salt = randomKey("", 16);
  const passwordHash = await hashPassword(input.password, salt);
  const quota =
    input.quota_bytes !== undefined && Number.isFinite(input.quota_bytes)
      ? Math.max(0, Math.floor(input.quota_bytes))
      : defaultQuota(env);
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO share_passwords (id, label, salt, password_hash, role, quota_bytes, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
  )
    .bind(id, input.label ?? "", salt, passwordHash, "friend", quota, 1, now, now)
    .run();
  const row = (await getSharePassword(env, id))!;
  return toPublic(row);
}

export async function updateSharePassword(
  env: Env,
  id: string,
  patch: SharePasswordPatch
): Promise<SharePasswordPublic | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column}=?`);
    vals.push(value);
  };

  if (patch.label !== undefined) set("label", patch.label);
  if (patch.quota_bytes !== undefined && Number.isFinite(patch.quota_bytes)) {
    set("quota_bytes", Math.max(0, Math.floor(patch.quota_bytes)));
  }
  if (patch.enabled !== undefined) set("enabled", patch.enabled ? 1 : 0);
  if (patch.password !== undefined && patch.password !== "") {
    const salt = randomKey("", 16);
    set("salt", salt);
    set("password_hash", await hashPassword(patch.password, salt));
  }

  if (!sets.length) {
    const current = await getSharePassword(env, id);
    return current ? toPublic(current) : null;
  }
  set("updated_at", nowIso());
  vals.push(id);
  await env.DB.prepare(`UPDATE share_passwords SET ${sets.join(", ")} WHERE id=?`).bind(...vals).run();
  const row = await getSharePassword(env, id);
  return row ? toPublic(row) : null;
}

export async function deleteSharePassword(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM share_passwords WHERE id=?").bind(id).run();
}

/**
 * 命中启用中的分享密码则返回该行（含 id/role/quota），否则 null。
 * 数量少，遍历可接受；逐行加盐哈希后常量时间比较。
 */
export async function verifySharePassword(
  env: Env,
  password: string
): Promise<SharePasswordRow | null> {
  if (!password) return null;
  const { results } = await env.DB.prepare(
    "SELECT * FROM share_passwords WHERE enabled=1"
  ).all<SharePasswordRow>();
  for (const row of results ?? []) {
    const candidate = await hashPassword(password, row.salt);
    if (timingSafeEqualStr(candidate, row.password_hash)) return row;
  }
  return null;
}

export async function shareQuotaFor(env: Env, sid: string): Promise<number | null> {
  const row = await getSharePassword(env, sid);
  return row ? row.quota_bytes : null;
}

export async function usedBytesFor(env: Env, sid: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(size_bytes),0) AS used FROM assets WHERE owner_sid=?"
  )
    .bind(sid)
    .first<{ used: number }>();
  return row?.used ?? 0;
}
