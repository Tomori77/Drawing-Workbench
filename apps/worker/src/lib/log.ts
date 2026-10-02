const MAX_LOG_LENGTH = 200;

// 客户端可见的上游消息上限：宽松，正常情况保留上游原文；仅防超大响应。
export const UPSTREAM_MESSAGE_MAX = 4000;

export function truncateLog(value: string, max = MAX_LOG_LENGTH): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function clientMessage(value: string, max = UPSTREAM_MESSAGE_MAX): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function redact(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}
