import { Hono } from "hono";
import { requireOwner } from "./guard";
import type { AppEnv } from "../types";

export const logs = new Hono<AppEnv>();

logs.use("*", requireOwner);

const PAGE_MAX = 200;
const DEFAULT_LIMIT = 50;

type Source = "all" | "workbench" | "gateway";
type Status = "all" | "ok" | "fail";

interface LogRow {
  id: number;
  request_id: string;
  gateway_key_id: string | null;
  account_id: string | null;
  path: string;
  mode: string;
  status_code: number | null;
  ok: number;
  duration_ms: number | null;
  bytes_in: number | null;
  bytes_out: number | null;
  cost_gems: number;
  created_at: string;
  key_name: string | null;
  account_label: string | null;
}

interface AttemptRow {
  id: number;
  request_id: string;
  gateway_key_id: string | null;
  account_id: string | null;
  attempt_no: number;
  status_code: number | null;
  error: string | null;
  created_at: string;
  account_label: string | null;
}

function parseSource(raw: string | undefined): Source {
  return raw === "workbench" || raw === "gateway" ? raw : "all";
}

function parseStatus(raw: string | undefined): Status {
  return raw === "ok" || raw === "fail" ? raw : "all";
}

function clampLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), PAGE_MAX);
}

function clampOffset(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function sourceClause(source: Source): { sql: string; params: unknown[] } {
  if (source === "gateway") return { sql: "r.gateway_key_id IS NOT NULL", params: [] };
  if (source === "workbench") return { sql: "r.gateway_key_id IS NULL", params: [] };
  return { sql: "", params: [] };
}

function statusClause(status: Status): { sql: string; params: unknown[] } {
  if (status === "ok") return { sql: "r.ok = 1", params: [] };
  if (status === "fail") return { sql: "r.ok = 0", params: [] };
  return { sql: "", params: [] };
}

function whereSql(clauses: string[]): string {
  const active = clauses.filter(Boolean);
  return active.length ? `WHERE ${active.join(" AND ")}` : "";
}

function sourceOf(row: LogRow): "workbench" | "gateway" {
  return row.gateway_key_id ? "gateway" : "workbench";
}

logs.get("/", async (c) => {
  const source = parseSource(c.req.query("source"));
  const status = parseStatus(c.req.query("status"));
  const limit = clampLimit(c.req.query("limit"));
  const offset = clampOffset(c.req.query("offset"));

  const src = sourceClause(source);
  const st = statusClause(status);
  const listWhere = whereSql([src.sql, st.sql]);
  const listParams = [...src.params, ...st.params];

  const { results } = await c.env.DB.prepare(
    `SELECT r.*, k.name AS key_name, COALESCE(a.label, a.username) AS account_label
     FROM request_logs r
     LEFT JOIN api_keys k ON r.gateway_key_id = k.id
     LEFT JOIN accounts a ON r.account_id = a.id
     ${listWhere}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...listParams, limit, offset)
    .all<LogRow>();

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c FROM request_logs r ${listWhere}`
  )
    .bind(...listParams)
    .first<{ c: number }>();

  // counts 反映当前状态过滤下的两类来源数量（不受 source 过滤影响）
  const countWhere = whereSql([st.sql]);
  const countsRow = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN r.gateway_key_id IS NULL THEN 1 ELSE 0 END) AS workbench,
       SUM(CASE WHEN r.gateway_key_id IS NOT NULL THEN 1 ELSE 0 END) AS gateway
     FROM request_logs r ${countWhere}`
  )
    .bind(...st.params)
    .first<{ workbench: number | null; gateway: number | null }>();

  const items = (results ?? []).map((row) => ({
    id: row.id,
    request_id: row.request_id,
    source: sourceOf(row),
    path: row.path,
    mode: row.mode,
    status_code: row.status_code,
    ok: row.ok !== 0,
    duration_ms: row.duration_ms,
    bytes_in: row.bytes_in,
    bytes_out: row.bytes_out,
    cost_gems: row.cost_gems,
    created_at: row.created_at,
    key_name: row.key_name,
    account_label: row.account_label
  }));

  return c.json({
    items,
    total: totalRow?.c ?? items.length,
    counts: {
      workbench: countsRow?.workbench ?? 0,
      gateway: countsRow?.gateway ?? 0
    },
    limit,
    offset
  });
});

logs.get("/:requestId/attempts", async (c) => {
  const requestId = c.req.param("requestId");
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, COALESCE(a.label, a.username) AS account_label
     FROM request_attempts t
     LEFT JOIN accounts a ON t.account_id = a.id
     WHERE t.request_id = ?
     ORDER BY t.attempt_no ASC, t.id ASC`
  )
    .bind(requestId)
    .all<AttemptRow>();

  const items = (results ?? []).map((row) => ({
    id: row.id,
    request_id: row.request_id,
    gateway_key_id: row.gateway_key_id,
    account_id: row.account_id,
    attempt_no: row.attempt_no,
    status_code: row.status_code,
    error: row.error,
    created_at: row.created_at,
    account_label: row.account_label
  }));

  return c.json({ items, total: items.length });
});
