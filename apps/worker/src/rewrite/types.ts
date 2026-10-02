import type { CanonicalRequest } from "../pipeline/types";
import { parseJson } from "../lib/json";

export const REWRITE_SCOPES = ["prompt", "params", "model", "gateway", "all"] as const;
export type RewriteScope = (typeof REWRITE_SCOPES)[number];

export const REWRITE_ACTION_TYPES = [
  "prepend",
  "append",
  "replace",
  "block",
  "param_default",
  "param_clamp",
  "set_model"
] as const;
export type RewriteActionType = (typeof REWRITE_ACTION_TYPES)[number];

export type PromptKind = "positive" | "negative";

export interface RewriteMatch {
  model?: string;
  action?: string;
  prompt_kind?: PromptKind;
  contains?: string;
  regex?: string;
  min_n?: number;
  max_n?: number;
}

export interface RewriteAction {
  type: RewriteActionType;
  value?: string;
  find?: string;
  replace?: string;
  params?: Record<string, unknown>;
  field?: string;
  min?: number;
  max?: number;
  message?: string;
  status?: number;
  prompt_kind?: PromptKind;
}

export interface RewriteRuleRow {
  id: string;
  scope: string;
  match_json: string;
  action_json: string;
  priority: number;
  enabled: number;
  created_at: string;
}

export interface RewriteRule {
  id: string;
  scope: RewriteScope;
  match: RewriteMatch;
  action: RewriteAction;
  priority: number;
  enabled: boolean;
  created_at: string;
}

export interface RewriteRuleInput {
  scope?: string;
  match?: RewriteMatch;
  action?: RewriteAction;
  priority?: number;
  enabled?: boolean;
}

export interface RewriteResult {
  canonical: CanonicalRequest;
  applied: string[];
}

/**
 * 声明式改写规则命中内容策略时抛出。规则来自 D1 JSON，绝不执行任意代码。
 */
export class RewriteBlockedError extends Error {
  readonly code: string = "CONTENT_BLOCKED";
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RewriteBlockedError";
    this.status = status;
  }
}

export type RewriteError = RewriteBlockedError;

export function isRewriteScope(value: unknown): value is RewriteScope {
  return typeof value === "string" && (REWRITE_SCOPES as readonly string[]).includes(value);
}

export function isRewriteActionType(value: unknown): value is RewriteActionType {
  return typeof value === "string" && (REWRITE_ACTION_TYPES as readonly string[]).includes(value);
}

export function normalizeRewriteScope(value: unknown): RewriteScope {
  return isRewriteScope(value) ? value : "all";
}

export function toRewriteRule(row: RewriteRuleRow): RewriteRule {
  return {
    id: row.id,
    scope: normalizeRewriteScope(row.scope),
    match: parseJson<RewriteMatch>(row.match_json, {}),
    action: parseJson<RewriteAction>(row.action_json, {} as RewriteAction),
    priority: row.priority,
    enabled: row.enabled !== 0,
    created_at: row.created_at
  };
}
