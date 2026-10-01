const MAX_LOG_LENGTH = 200;

export function truncateLog(value: string, max = MAX_LOG_LENGTH): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function redact(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}
