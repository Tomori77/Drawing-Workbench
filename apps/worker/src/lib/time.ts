const shanghaiDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });

const shanghaiParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayInShanghai(date: Date = new Date()): string {
  return shanghaiDate.format(date);
}

export function shanghaiTimestamp(date: Date = new Date()): string {
  const parts: Record<string, string> = {};
  for (const { type, value } of shanghaiParts.formatToParts(date)) parts[type] = value;
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}
