import type { Env } from "../types";
import { getSharePassword } from "../db/sharePasswords";
import { deleteKv, getKv, setKv } from "./kv";

const SID_ACTIVE_PREFIX = "sid_active:";

/**
 * 判断某会话 sid 是否仍然有效。
 * - owner 恒有效，不查库。
 * - friend：先查 runtime_kv 缓存（"1"/"0"），命中即返回，零 D1 读分享密码表；
 *   未命中才查 share_passwords（存在且 enabled=1），并把结果写回缓存。
 * 删除/停用分享密码时调用 invalidateSid 清除缓存，使其立即失效。
 */
export async function isSidActive(env: Env, sid: string): Promise<boolean> {
  if (sid === "owner") return true;
  const key = SID_ACTIVE_PREFIX + sid;
  const cached = await getKv(env, key);
  if (cached === "1") return true;
  if (cached === "0") return false;
  const row = await getSharePassword(env, sid);
  const active = row !== null && row.enabled !== 0;
  await setKv(env, key, active ? "1" : "0");
  return active;
}

/** 清除某 sid 的有效性缓存，使其下次请求重新判定。owner 无需处理。 */
export async function invalidateSid(env: Env, sid: string): Promise<void> {
  if (sid === "owner") return;
  await deleteKv(env, SID_ACTIVE_PREFIX + sid);
}
