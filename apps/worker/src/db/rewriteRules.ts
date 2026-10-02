import type { Env } from "../types";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import {
  normalizeRewriteScope,
  toRewriteRule,
  type RewriteRule,
  type RewriteRuleInput,
  type RewriteRuleRow,
  type RewriteScope
} from "../rewrite/types";

export interface ListRewriteRulesFilter {
  scope?: RewriteScope | string;
  enabledOnly?: boolean;
}

export interface RewriteRuleRecord extends RewriteRule {
  match_json: string;
  action_json: string;
}

function toRecord(row: RewriteRuleRow): RewriteRuleRecord {
  const rule = toRewriteRule(row);
  return {
    ...rule,
    match_json: JSON.stringify(rule.match),
    action_json: JSON.stringify(rule.action)
  };
}

export async function listRewriteRules(
  env: Env,
  filter: ListRewriteRulesFilter = {}
): Promise<RewriteRuleRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.scope) {
    conditions.push("scope=?");
    params.push(filter.scope);
  }
  if (filter.enabledOnly) conditions.push("enabled=1");
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const { results } = await env.DB.prepare(
    `SELECT * FROM rewrite_rules${where} ORDER BY priority DESC, created_at ASC`
  )
    .bind(...params)
    .all<RewriteRuleRow>();
  return results ?? [];
}

export async function getRewriteRule(env: Env, id: string): Promise<RewriteRuleRow | null> {
  return env.DB.prepare("SELECT * FROM rewrite_rules WHERE id=?").bind(id).first<RewriteRuleRow>();
}

function serializeInput(input: RewriteRuleInput): {
  scope: string;
  matchJson: string;
  actionJson: string;
  priority: number;
  enabled: number;
} {
  return {
    scope: normalizeRewriteScope(input.scope),
    matchJson: JSON.stringify(input.match ?? {}),
    actionJson: JSON.stringify(input.action ?? {}),
    priority: input.priority ?? 0,
    enabled: input.enabled === false ? 0 : 1
  };
}

export async function createRewriteRule(env: Env, input: RewriteRuleInput): Promise<RewriteRuleRecord> {
  const id = newId();
  const { scope, matchJson, actionJson, priority, enabled } = serializeInput(input);
  await env.DB.prepare(
    "INSERT INTO rewrite_rules (id, scope, match_json, action_json, priority, enabled, created_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(id, scope, matchJson, actionJson, priority, enabled, nowIso())
    .run();
  return toRecord((await getRewriteRule(env, id))!);
}

export async function updateRewriteRule(
  env: Env,
  id: string,
  patch: RewriteRuleInput
): Promise<RewriteRuleRecord | null> {
  const existing = await getRewriteRule(env, id);
  if (!existing) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column}=?`);
    vals.push(value);
  };

  if (patch.scope !== undefined) set("scope", normalizeRewriteScope(patch.scope));
  if (patch.match !== undefined) set("match_json", JSON.stringify(patch.match));
  if (patch.action !== undefined) set("action_json", JSON.stringify(patch.action));
  if (patch.priority !== undefined) set("priority", patch.priority);
  if (patch.enabled !== undefined) set("enabled", patch.enabled ? 1 : 0);

  if (sets.length) {
    vals.push(id);
    await env.DB.prepare(`UPDATE rewrite_rules SET ${sets.join(", ")} WHERE id=?`).bind(...vals).run();
  }
  return toRecord((await getRewriteRule(env, id))!);
}

export async function deleteRewriteRule(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM rewrite_rules WHERE id=?").bind(id).run();
}

/** DB 行 → 供引擎使用的规则（解析 JSON，忽略损坏行）。 */
export function rowsToRules(rows: RewriteRuleRow[]): RewriteRule[] {
  return rows.map(toRewriteRule);
}
