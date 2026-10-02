import type { Env } from "../types";
import { parseJson } from "../lib/json";
import { nowIso } from "../lib/time";

export const DEFAULT_TIMEZONE = "Asia/Shanghai";
export const DEFAULT_WEEKDAY_TIMES = ["09:05"];
export const DEFAULT_WEEKEND_TIMES = ["10:00"];
export const RETRY_BACKOFF_MS = 30 * 60 * 1000;
export const RETRY_MAX = 4;
export const LEASE_MS = 10 * 60 * 1000;
export const WEEKEND_WEEKDAYS = new Set(["Sat", "Sun"]);

export interface CheckinSettings {
  enabled: boolean;
  timezone: string;
  weekday_times: string[];
  weekend_times: string[];
  lease_until: string | null;
  next_run_at: string | null;
  last_attempt_slot: string | null;
  last_success_slot: string | null;
  status: string;
  last_message: string | null;
  retry_count: number;
  updated_at: string;
}

export interface CheckinSettingsPatch {
  enabled?: boolean;
  timezone?: string;
  weekday_times?: string[];
  weekend_times?: string[];
}

interface CheckinSettingsRow {
  id: number;
  enabled: number;
  timezone: string;
  weekday_times: string;
  weekend_times: string;
  lease_until: string | null;
  next_run_at: string | null;
  last_attempt_slot: string | null;
  last_success_slot: string | null;
  status: string;
  last_message: string | null;
  retry_count: number;
  updated_at: string;
}

export class CheckinSettingsError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = "INVALID_SETTINGS", status = 400) {
    super(message);
    this.name = "CheckinSettingsError";
    this.code = code;
    this.status = status;
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimes(input: unknown, fallback: string[]): string[] {
  const source = Array.isArray(input) ? input : fallback;
  const out: string[] = [];
  for (const raw of source) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (!TIME_PATTERN.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  out.sort();
  return out.length ? out : [...fallback].sort();
}

function defaultSettings(): CheckinSettings {
  return {
    enabled: true,
    timezone: DEFAULT_TIMEZONE,
    weekday_times: [...DEFAULT_WEEKDAY_TIMES],
    weekend_times: [...DEFAULT_WEEKEND_TIMES],
    lease_until: null,
    next_run_at: null,
    last_attempt_slot: null,
    last_success_slot: null,
    status: "pending",
    last_message: null,
    retry_count: 0,
    updated_at: nowIso()
  };
}

export async function getSettings(env: Env): Promise<CheckinSettings> {
  const row = await env.DB.prepare("SELECT * FROM checkin_settings WHERE id=1").first<CheckinSettingsRow>();
  if (!row) return defaultSettings();
  return {
    enabled: row.enabled !== 0,
    timezone: isValidTimezone(row.timezone) ? row.timezone : DEFAULT_TIMEZONE,
    weekday_times: normalizeTimes(
      parseJson<string[]>(row.weekday_times, DEFAULT_WEEKDAY_TIMES),
      DEFAULT_WEEKDAY_TIMES
    ),
    weekend_times: normalizeTimes(
      parseJson<string[]>(row.weekend_times, DEFAULT_WEEKEND_TIMES),
      DEFAULT_WEEKEND_TIMES
    ),
    lease_until: row.lease_until ?? null,
    next_run_at: row.next_run_at ?? null,
    last_attempt_slot: row.last_attempt_slot ?? null,
    last_success_slot: row.last_success_slot ?? null,
    status: row.status ?? "pending",
    last_message: row.last_message ?? null,
    retry_count: row.retry_count ?? 0,
    updated_at: row.updated_at ?? nowIso()
  };
}

export async function updateSettings(
  env: Env,
  patch: CheckinSettingsPatch
): Promise<CheckinSettings> {
  const current = await getSettings(env);

  let timezone = current.timezone;
  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) {
      throw new CheckinSettingsError("时区无效（需 IANA 名称，如 Asia/Shanghai）", "BAD_TIMEZONE");
    }
    timezone = patch.timezone;
  }

  let weekdayTimes = current.weekday_times;
  if (patch.weekday_times !== undefined) {
    weekdayTimes = normalizeTimes(patch.weekday_times, []);
    if (!weekdayTimes.length) throw new CheckinSettingsError("至少保留一个签到时间", "SCHEDULE_EMPTY");
  }

  let weekendTimes = current.weekend_times;
  if (patch.weekend_times !== undefined) {
    weekendTimes = normalizeTimes(patch.weekend_times, []);
    if (!weekendTimes.length) throw new CheckinSettingsError("至少保留一个签到时间", "SCHEDULE_EMPTY");
  }

  if (!weekdayTimes.length && !weekendTimes.length) {
    throw new CheckinSettingsError("至少保留一个签到时间", "SCHEDULE_EMPTY");
  }

  const enabled = patch.enabled === undefined ? current.enabled : Boolean(patch.enabled);
  await env.DB.prepare(
    "INSERT INTO checkin_settings (id, enabled, timezone, weekday_times, weekend_times, updated_at) VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, timezone=excluded.timezone, weekday_times=excluded.weekday_times, weekend_times=excluded.weekend_times, updated_at=excluded.updated_at"
  )
    .bind(enabled ? 1 : 0, timezone, JSON.stringify(weekdayTimes), JSON.stringify(weekendTimes), nowIso())
    .run();

  return getSettings(env);
}
