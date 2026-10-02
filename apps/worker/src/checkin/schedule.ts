import {
  WEEKEND_WEEKDAYS,
  type CheckinSettings
} from "./settings";

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

export interface AttemptedSlots {
  last_attempt_slot: string | null;
  last_success_slot: string | null;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let fmt = partFormatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    partFormatters.set(timezone, fmt);
  }
  return fmt;
}

export function localParts(date: Date, timezone: string): LocalParts {
  const parts = formatterFor(timezone).formatToParts(date);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: p.weekday ?? ""
  };
}

export function isWeekend(weekday: string): boolean {
  return WEEKEND_WEEKDAYS.has(weekday);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function slotKey(parts: LocalParts, time: string): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${time}`;
}

export function slotMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function dayTimes(settings: CheckinSettings, date: Date = new Date()): string[] {
  const parts = localParts(date, settings.timezone);
  return isWeekend(parts.weekday) ? [...settings.weekend_times] : [...settings.weekday_times];
}

export function dueSlot(
  settings: CheckinSettings,
  attempted: AttemptedSlots,
  date: Date = new Date()
): string | null {
  const parts = localParts(date, settings.timezone);
  const times = dayTimes(settings, date);
  const current = parts.hour * 60 + parts.minute;
  const due = times
    .filter((t) => current >= slotMinutes(t))
    .sort((a, b) => slotMinutes(a) - slotMinutes(b));
  if (!due.length) return null;
  const unattempted = due.find((t) => {
    const key = slotKey(parts, t);
    return key !== attempted.last_attempt_slot && key !== attempted.last_success_slot;
  });
  return slotKey(parts, unattempted ?? due[due.length - 1]!);
}

export function nextSlot(settings: CheckinSettings, from: Date = new Date()): string | null {
  for (let d = 0; d < 8; d++) {
    const probe = new Date(from.getTime() + d * 86_400_000);
    const parts = localParts(probe, settings.timezone);
    const times = isWeekend(parts.weekday)
      ? [...settings.weekend_times].sort()
      : [...settings.weekday_times].sort();
    const current = d === 0 ? parts.hour * 60 + parts.minute + 1 : -1;
    const found = times.find((t) => slotMinutes(t) >= current);
    if (found) return slotKey(parts, found);
  }
  return null;
}
