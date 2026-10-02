import type { Env } from "../types";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import { parseJson } from "../lib/json";
import { getKv, setKv } from "../pool/kv";
import { BUILTIN_ARTISTS } from "../presets/builtinArtists";

export type PresetKind = "recipe" | "artist";

export interface PresetRow {
  id: string;
  owner_sid: string;
  kind: string;
  name: string;
  content: string | null;
  payload_json: string;
  builtin: number;
  created_at: string;
  updated_at: string;
}

export interface PresetPublic {
  id: string;
  owner_sid: string;
  kind: PresetKind;
  name: string;
  content?: string;
  payload?: Record<string, unknown>;
  builtin: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListPresetsArgs {
  sid: string;
  kind: PresetKind;
  all?: boolean;
}

export interface CreatePresetInput {
  sid: string;
  kind: PresetKind;
  name: string;
  content?: string;
  payload?: Record<string, unknown>;
}

export interface UpdatePresetPatch {
  name?: string;
  content?: string;
  payload?: Record<string, unknown>;
}

export function isPresetKind(value: unknown): value is PresetKind {
  return value === "recipe" || value === "artist";
}

function toPublic(row: PresetRow): PresetPublic {
  const kind = row.kind === "artist" ? "artist" : "recipe";
  return {
    id: row.id,
    owner_sid: row.owner_sid,
    kind,
    name: row.name,
    ...(kind === "artist" ? { content: row.content ?? "" } : {}),
    ...(kind === "recipe" ? { payload: parseJson<Record<string, unknown>>(row.payload_json, {}) } : {}),
    builtin: row.builtin !== 0,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function listPresets(env: Env, args: ListPresetsArgs): Promise<PresetPublic[]> {
  const { results } = args.all
    ? await env.DB.prepare(
        "SELECT * FROM presets WHERE kind=? ORDER BY owner_sid ASC, updated_at DESC, rowid DESC"
      )
        .bind(args.kind)
        .all<PresetRow>()
    : await env.DB.prepare(
        "SELECT * FROM presets WHERE owner_sid=? AND kind=? ORDER BY updated_at DESC, rowid DESC"
      )
        .bind(args.sid, args.kind)
        .all<PresetRow>();
  return (results ?? []).map(toPublic);
}

export async function countPresets(env: Env, sid: string, kind: PresetKind): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM presets WHERE owner_sid=? AND kind=?"
  )
    .bind(sid, kind)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/**
 * 给该 sid 种入内置画师串（builtin=1）。
 * - 每个 sid 只种一次：完成后在 runtime_kv 记 `preset_seed:artist:<sid>`；
 * - 若用户把内置项全部删掉，也**不会**再次种入（尊重用户删除）；
 * - 仅在尚未种过时执行，因此新建分享密码时调用即可获得一份内置画师串。
 */
export async function ensureBuiltinArtists(env: Env, sid: string): Promise<void> {
  const seedKey = `preset_seed:artist:${sid}`;
  if (await getKv(env, seedKey)) return;

  const now = nowIso();
  for (const artist of BUILTIN_ARTISTS) {
    await env.DB.prepare(
      "INSERT INTO presets (id, owner_sid, kind, name, content, payload_json, builtin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
    )
      .bind(newId(), sid, "artist", artist.name, artist.content, "{}", 1, now, now)
      .run();
  }
  await setKv(env, seedKey, "1");
}

export async function getPreset(env: Env, id: string): Promise<PresetRow | null> {
  return env.DB.prepare("SELECT * FROM presets WHERE id=?").bind(id).first<PresetRow>();
}

export async function createPreset(env: Env, input: CreatePresetInput): Promise<PresetPublic> {
  const id = newId();
  const now = nowIso();
  const content = input.kind === "artist" ? input.content ?? "" : null;
  const payload = input.kind === "recipe" ? JSON.stringify(input.payload ?? {}) : "{}";
  await env.DB.prepare(
    "INSERT INTO presets (id, owner_sid, kind, name, content, payload_json, builtin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
  )
    .bind(id, input.sid, input.kind, input.name, content, payload, 0, now, now)
    .run();
  const row = (await getPreset(env, id))!;
  return toPublic(row);
}

/** 只有属于该 sid 的记录才允许修改；owner 亦不能改他人。 */
export async function updatePreset(
  env: Env,
  id: string,
  sid: string,
  patch: UpdatePresetPatch
): Promise<PresetPublic | null> {
  const current = await getPreset(env, id);
  if (!current || current.owner_sid !== sid) return null;

  const kind: PresetKind = current.kind === "artist" ? "artist" : "recipe";
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column}=?`);
    vals.push(value);
  };

  if (patch.name !== undefined) set("name", patch.name);
  if (kind === "artist" && patch.content !== undefined) set("content", patch.content);
  if (kind === "recipe" && patch.payload !== undefined) set("payload_json", JSON.stringify(patch.payload));

  if (!sets.length) return toPublic(current);
  set("updated_at", nowIso());
  vals.push(id);
  await env.DB.prepare(`UPDATE presets SET ${sets.join(", ")} WHERE id=?`).bind(...vals).run();
  const row = await getPreset(env, id);
  return row ? toPublic(row) : null;
}

/** 只有属于该 sid 的记录才允许删除。返回是否删除成功。 */
export async function deletePreset(env: Env, id: string, sid: string): Promise<boolean> {
  const current = await getPreset(env, id);
  if (!current || current.owner_sid !== sid) return false;
  await env.DB.prepare("DELETE FROM presets WHERE id=?").bind(id).run();
  return true;
}
