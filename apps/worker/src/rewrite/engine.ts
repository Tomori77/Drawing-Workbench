import type { Env } from "../types";
import type { CanonicalRequest } from "../pipeline/types";
import { listRewriteRules, rowsToRules } from "../db/rewriteRules";
import {
  RewriteBlockedError,
  type PromptKind,
  type RewriteAction,
  type RewriteMatch,
  type RewriteRule,
  type RewriteScope
} from "./types";

const MAX_REGEX_LENGTH = 512;
const MAX_REGEX_INPUT = 20_000;

const PROMPT_ACTIONS: ReadonlySet<string> = new Set(["prepend", "append", "replace"]);
const PARAM_ACTIONS: ReadonlySet<string> = new Set(["param_default", "param_clamp"]);

function cloneCanonical(canonical: CanonicalRequest): CanonicalRequest {
  const params =
    typeof structuredClone === "function"
      ? structuredClone(canonical.params)
      : (JSON.parse(JSON.stringify(canonical.params)) as Record<string, unknown>);
  return {
    model: canonical.model,
    action: canonical.action,
    prompt: { ...canonical.prompt },
    params,
    references: [...canonical.references],
    n: canonical.n
  };
}

/** 通配匹配：`*` 匹配任意字符；其余按字面量。 */
export function modelGlob(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (!pattern.includes("*")) return false;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}$`).test(value);
  } catch {
    return false;
  }
}

function promptText(canonical: CanonicalRequest, kind: PromptKind): string {
  return kind === "negative" ? canonical.prompt.negative : canonical.prompt.positive;
}

function regexMatches(pattern: string, value: string): boolean {
  if (pattern.length > MAX_REGEX_LENGTH || value.length > MAX_REGEX_INPUT) return false;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    // 非法正则：忽略该规则（不抛错、不崩溃）。
    return false;
  }
}

export function matchRule(rule: Pick<RewriteRule, "match">, canonical: CanonicalRequest): boolean {
  const match: RewriteMatch = rule.match ?? {};

  if (match.model !== undefined && !modelGlob(String(match.model), canonical.model)) return false;
  if (match.action !== undefined && String(match.action) !== canonical.action) return false;

  if (match.min_n !== undefined || match.max_n !== undefined) {
    const n = canonical.n;
    if (match.min_n !== undefined && n < match.min_n) return false;
    if (match.max_n !== undefined && n > match.max_n) return false;
  }

  const hasTextCondition = match.contains !== undefined || match.regex !== undefined;
  if (hasTextCondition) {
    const kinds: PromptKind[] = match.prompt_kind ? [match.prompt_kind] : ["positive", "negative"];
    const hits = kinds.some((kind) => {
      const text = promptText(canonical, kind);
      if (match.contains !== undefined && !text.includes(String(match.contains))) return false;
      if (match.regex !== undefined && !regexMatches(String(match.regex), text)) return false;
      return true;
    });
    if (!hits) return false;
  }

  return true;
}

function scopeApplies(scope: RewriteScope, type: string): boolean {
  if (scope === "all") return true;
  if (type === "block") return true;
  if (scope === "prompt") return PROMPT_ACTIONS.has(type);
  if (scope === "params") return PARAM_ACTIONS.has(type);
  if (scope === "model") return type === "set_model";
  return false;
}

function resolvePromptKind(action: RewriteAction, match: RewriteMatch): PromptKind {
  return action.prompt_kind ?? match.prompt_kind ?? "positive";
}

function applyPromptAction(
  action: RewriteAction,
  canonical: CanonicalRequest,
  kind: PromptKind
): CanonicalRequest {
  const next = cloneCanonical(canonical);
  const current = promptText(next, kind);
  const value = String(action.value ?? "");
  if (action.type === "prepend") next.prompt[kind] = value + current;
  else if (action.type === "append") next.prompt[kind] = current + value;
  else if (action.type === "replace") {
    const find = action.find ?? "";
    const replacement = action.replace ?? action.value ?? "";
    next.prompt[kind] = find ? current.split(find).join(replacement) : replacement;
  }
  return next;
}

function applyParamAction(action: RewriteAction, canonical: CanonicalRequest): CanonicalRequest {
  const next = cloneCanonical(canonical);
  if (action.type === "param_default") {
    const defaults = action.params ?? {};
    for (const [key, value] of Object.entries(defaults)) {
      if (next.params[key] === undefined) next.params[key] = value;
    }
  } else if (action.type === "param_clamp") {
    const field = action.field;
    if (field) {
      const value = Number(next.params[field]);
      if (Number.isFinite(value)) {
        let clamped = value;
        if (action.min !== undefined && clamped < action.min) clamped = action.min;
        if (action.max !== undefined && clamped > action.max) clamped = action.max;
        next.params[field] = clamped;
      }
    }
  }
  return next;
}

export function applyAction(
  action: RewriteAction,
  canonical: CanonicalRequest,
  match: RewriteMatch = {}
): CanonicalRequest {
  switch (action.type) {
    case "block": {
      const status = Number.isFinite(action.status) ? Number(action.status) : 400;
      const message = action.message ?? "内容被策略拦截";
      throw new RewriteBlockedError(status, message);
    }
    case "prepend":
    case "append":
    case "replace":
      return applyPromptAction(action, canonical, resolvePromptKind(action, match));
    case "param_default":
    case "param_clamp":
      return applyParamAction(action, canonical);
    case "set_model":
      if (action.value === undefined) return canonical;
      return { ...cloneCanonical(canonical), model: String(action.value) };
    default:
      return canonical;
  }
}

/**
 * 纯函数式应用规则：按传入顺序逐条匹配，命中即应用；`block` 抛 `RewriteBlockedError`。
 * 调用方应保证 rules 已按 `priority DESC, created_at ASC` 排序。
 */
export function applyRules(canonical: CanonicalRequest, rules: RewriteRule[]): CanonicalRequest {
  let current = canonical;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!scopeApplies(rule.scope, rule.action?.type)) continue;
    if (!matchRule(rule, current)) continue;
    current = applyAction(rule.action, current, rule.match);
  }
  return current;
}

export async function loadRules(env: Env, scope?: RewriteScope): Promise<RewriteRule[]> {
  const rows = await listRewriteRules(env, { scope, enabledOnly: true });
  return rowsToRules(rows);
}

export { RewriteBlockedError } from "./types";
