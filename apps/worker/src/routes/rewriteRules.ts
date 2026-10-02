import { Hono } from "hono";
import {
  createRewriteRule,
  deleteRewriteRule,
  getRewriteRule,
  listRewriteRules,
  updateRewriteRule
} from "../db/rewriteRules";
import { readJson } from "../lib/json";
import { isRewriteActionType, REWRITE_ACTION_TYPES, type RewriteRuleInput } from "../rewrite/types";
import { requireOrigin, requireOwner } from "./guard";
import type { AppEnv } from "../types";

export const rewriteRules = new Hono<AppEnv>();

rewriteRules.use("*", requireOwner);

function validate(input: RewriteRuleInput): string | null {
  if (input.action === undefined || input.action === null) return "action_required";
  if (typeof input.action !== "object" || Array.isArray(input.action)) return "action_invalid";
  if (!isRewriteActionType((input.action as { type?: unknown }).type)) {
    return `action_type_invalid: expected one of ${REWRITE_ACTION_TYPES.join(", ")}`;
  }
  if (input.match !== undefined && (typeof input.match !== "object" || Array.isArray(input.match))) {
    return "match_invalid";
  }
  if (input.scope !== undefined && typeof input.scope !== "string") return "scope_invalid";
  if (input.priority !== undefined && !Number.isFinite(Number(input.priority))) return "priority_invalid";
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") return "enabled_invalid";
  return null;
}

rewriteRules.get("/", async (c) => {
  const scope = c.req.query("scope") ?? undefined;
  const enabledOnly = c.req.query("enabled") === "1" || c.req.query("enabled") === "true";
  const rows = await listRewriteRules(c.env, { scope, enabledOnly });
  return c.json({ items: rows });
});

rewriteRules.post("/", requireOrigin, async (c) => {
  const input = await readJson<RewriteRuleInput>(c);
  const error = validate(input);
  if (error) return c.json({ error: "invalid_rule", message: error }, 400);
  const row = await createRewriteRule(c.env, input);
  return c.json(row, 201);
});

rewriteRules.get("/:id", async (c) => {
  const row = await getRewriteRule(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(row);
});

rewriteRules.patch("/:id", requireOrigin, async (c) => {
  const input = await readJson<RewriteRuleInput>(c);
  if (input.action !== undefined) {
    const error = validate(input);
    if (error) return c.json({ error: "invalid_rule", message: error }, 400);
  }
  const row = await updateRewriteRule(c.env, c.req.param("id"), input);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(row);
});

rewriteRules.delete("/:id", requireOrigin, async (c) => {
  await deleteRewriteRule(c.env, c.req.param("id"));
  return c.json({ ok: true });
});
