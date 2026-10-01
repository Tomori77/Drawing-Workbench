import type { Env } from "../types";

export async function getKv(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT v FROM runtime_kv WHERE k=?").bind(key).first<{ v: string }>();
  return row?.v ?? null;
}

export async function setKv(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO runtime_kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v"
  )
    .bind(key, value)
    .run();
}

export async function bumpKv(env: Env, key: string): Promise<number> {
  const row = await env.DB.prepare(
    "INSERT INTO runtime_kv(k, v) VALUES(?, '1') ON CONFLICT(k) DO UPDATE SET v=CAST(CAST(v AS INTEGER)+1 AS TEXT) RETURNING v"
  )
    .bind(key)
    .first<{ v: string }>();
  const n = Number(row?.v);
  return Number.isFinite(n) ? n : 1;
}
