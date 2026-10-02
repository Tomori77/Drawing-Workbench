import type { Env } from "../types";
import { nowIso } from "../lib/time";
import { parseJson } from "../lib/json";

export interface ProfileRow {
  id: number;
  nickname: string;
  avatar_color: string;
  preferences_json: string;
  updated_at: string;
}

export interface ProfilePublic {
  nickname: string;
  avatar_color: string;
  preferences: Record<string, unknown>;
  updated_at: string;
}

export interface ProfilePatch {
  nickname?: string;
  avatar_color?: string;
  preferences?: Record<string, unknown>;
}

const PROFILE_ID = 1;
const DEFAULT_AVATAR_COLOR = "#0071e3";

function toProfilePublic(row: ProfileRow): ProfilePublic {
  return {
    nickname: row.nickname,
    avatar_color: row.avatar_color,
    preferences: parseJson<Record<string, unknown>>(row.preferences_json, {}),
    updated_at: row.updated_at
  };
}

async function ensureProfileRow(env: Env): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO app_profile (id) VALUES (?)")
    .bind(PROFILE_ID)
    .run();
}

export async function getProfile(env: Env): Promise<ProfilePublic> {
  let row = await env.DB.prepare("SELECT * FROM app_profile WHERE id=?")
    .bind(PROFILE_ID)
    .first<ProfileRow>();
  if (!row) {
    await ensureProfileRow(env);
    row = await env.DB.prepare("SELECT * FROM app_profile WHERE id=?")
      .bind(PROFILE_ID)
      .first<ProfileRow>();
  }
  if (!row) {
    return {
      nickname: "",
      avatar_color: DEFAULT_AVATAR_COLOR,
      preferences: {},
      updated_at: ""
    };
  }
  return toProfilePublic(row);
}

export async function updateProfile(env: Env, patch: ProfilePatch): Promise<ProfilePublic> {
  await ensureProfileRow(env);
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.nickname !== undefined) {
    sets.push("nickname=?");
    vals.push(patch.nickname);
  }
  if (patch.avatar_color !== undefined) {
    sets.push("avatar_color=?");
    vals.push(patch.avatar_color);
  }
  if (patch.preferences !== undefined) {
    sets.push("preferences_json=?");
    vals.push(JSON.stringify(patch.preferences));
  }

  if (sets.length) {
    sets.push("updated_at=?");
    vals.push(nowIso());
    vals.push(PROFILE_ID);
    await env.DB.prepare(`UPDATE app_profile SET ${sets.join(", ")} WHERE id=?`)
      .bind(...vals)
      .run();
  }

  return getProfile(env);
}
