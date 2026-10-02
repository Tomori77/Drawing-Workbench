import { Hono } from "hono";
import { listUpstreams, getUpstream, type UpstreamPublic } from "../db/upstreams";
import { listAccountsPublic } from "../db/accounts";
import {
  getWorkspaceSettings,
  setWorkspaceSettings,
  WORKSPACE_ACCOUNT_MODES,
  type WorkspaceAccountMode,
  type WorkspaceSettings
} from "../pool/workspace";
import { readJson } from "../lib/json";
import { requireOrigin, requireSession } from "./guard";
import type { AppEnv } from "../types";

export const generateOptions = new Hono<AppEnv>();

generateOptions.use("*", requireSession);

export interface SizeOption {
  label: string;
  width: number;
  height: number;
  ratio?: string;
}

export interface ActionOption {
  value: string;
  label: string;
}

export interface UpstreamOptions {
  id: string;
  name: string;
  type: string;
  models: string[];
  samplers: string[];
  noise_schedules: string[];
  sizes: SizeOption[];
  actions: ActionOption[];
}

const NAI_SAMPLERS = [
  "k_euler_ancestral",
  "k_euler",
  "k_dpmpp_2m",
  "k_dpmpp_2m_sde",
  "k_dpmpp_sde",
  "ddim",
  "k_dpm_2",
  "k_dpm_2_ancestral",
  "k_heun",
  "k_lms",
  "plms"
];

const NAI_NOISE_SCHEDULES = ["karras", "native", "exponential", "polyexponential"];

const DEFAULT_SIZES: SizeOption[] = [
  { label: "竖图", width: 832, height: 1216, ratio: "2:3" },
  { label: "横图", width: 1216, height: 832, ratio: "3:2" },
  { label: "方图", width: 1024, height: 1024, ratio: "1:1" },
  { label: "512x512", width: 512, height: 512, ratio: "1:1" }
];

const DEFAULT_ACTIONS: ActionOption[] = [
  { value: "generate", label: "文生图" },
  { value: "img2img", label: "图生图" },
  { value: "infill", label: "局部重绘" }
];

const ACCOUNT_MODES: Array<{ value: WorkspaceAccountMode; label: string }> = [
  { value: "auto", label: "自动（轮询）" },
  { value: "balance", label: "余额优先" },
  { value: "fixed", label: "固定账号" }
];

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

function sizeArray(value: unknown): SizeOption[] | null {
  if (!Array.isArray(value)) return null;
  const out: SizeOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const width = Number(record.width);
    const height = Number(record.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    const option: SizeOption = {
      label: typeof record.label === "string" ? record.label : `${width}x${height}`,
      width,
      height
    };
    if (typeof record.ratio === "string") option.ratio = record.ratio;
    out.push(option);
  }
  return out;
}

function actionArray(value: unknown): ActionOption[] | null {
  if (!Array.isArray(value)) return null;
  const out: ActionOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.value !== "string") continue;
    out.push({
      value: record.value,
      label: typeof record.label === "string" ? record.label : record.value
    });
  }
  return out;
}

async function fallbackModels(env: AppEnv["Bindings"], upstreamId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT logical_name FROM models WHERE upstream_id=? ORDER BY logical_name ASC"
  )
    .bind(upstreamId)
    .all<{ logical_name: string }>();
  return (results ?? []).map((row) => row.logical_name);
}

async function toOptions(env: AppEnv["Bindings"], upstream: UpstreamPublic): Promise<UpstreamOptions> {
  const caps = upstream.capabilities;
  const models = upstream.models.length ? upstream.models : await fallbackModels(env, upstream.id);
  const samplers =
    stringArray(caps.samplers) ?? (upstream.type === "nai-compatible" ? NAI_SAMPLERS : []);
  const noise_schedules =
    stringArray(caps.noise_schedules) ?? (upstream.type === "nai-compatible" ? NAI_NOISE_SCHEDULES : []);
  const sizes = sizeArray(caps.sizes) ?? DEFAULT_SIZES;
  const actions = actionArray(caps.actions) ?? DEFAULT_ACTIONS;
  return {
    id: upstream.id,
    name: upstream.name,
    type: upstream.type,
    models,
    samplers,
    noise_schedules,
    sizes,
    actions
  };
}

generateOptions.get("/", async (c) => {
  const role = c.get("role");
  const queryUpstreamId = c.req.query("upstream_id") || undefined;
  const enabled = (await listUpstreams(c.env)).filter((upstream) => upstream.enabled);

  const settings = await getWorkspaceSettings(c.env);
  const selectedId = queryUpstreamId ?? settings.upstream_id;
  const upstreams = await Promise.all(enabled.map((upstream) => toOptions(c.env, upstream)));

  let accounts: Array<{
    id: string;
    label: string | null;
    username: string;
    enabled: boolean;
    status: string;
    gems_last: number | null;
    has_api_token: boolean;
  }> = [];
  if (role === "owner") {
    const rows = await listAccountsPublic(c.env, selectedId);
    accounts = rows.map((row) => ({
      id: row.id,
      label: row.label,
      username: row.username,
      enabled: row.enabled,
      status: row.status,
      gems_last: row.gems_last,
      has_api_token: row.has_api_token
    }));
  }

  return c.json({
    upstreams,
    settings,
    account_modes: ACCOUNT_MODES,
    accounts
  });
});

generateOptions.patch("/", requireOrigin, async (c) => {
  const role = c.get("role");
  const body = await readJson<Record<string, unknown>>(c);
  const patch: Partial<WorkspaceSettings> = {};

  if (body.upstream_id !== undefined) {
    const raw = body.upstream_id;
    if (raw !== null && typeof raw !== "string") {
      return c.json({ error: "invalid_upstream_id", message: "upstream_id 必须为字符串" }, 400);
    }
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) {
      const upstream = await getUpstream(c.env, value);
      if (!upstream) return c.json({ error: "upstream_not_found", message: "上游不存在" }, 400);
      patch.upstream_id = value;
    } else {
      patch.upstream_id = "";
    }
  }

  if (body.account_mode !== undefined) {
    const raw = body.account_mode;
    if (typeof raw !== "string" || !(WORKSPACE_ACCOUNT_MODES as readonly string[]).includes(raw)) {
      return c.json({ error: "invalid_account_mode", message: "account_mode 非法" }, 400);
    }
    patch.account_mode = raw as WorkspaceAccountMode;
  }

  if (body.account_id !== undefined) {
    if (role !== "owner") {
      return c.json({ error: "forbidden", message: "仅 owner 可指定账号" }, 403);
    }
    const raw = body.account_id;
    if (raw !== null && typeof raw !== "string") {
      return c.json({ error: "invalid_account_id", message: "account_id 必须为字符串" }, 400);
    }
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) {
      const account = await c.env.DB.prepare("SELECT id FROM accounts WHERE id=?").bind(value).first<{ id: string }>();
      if (!account) return c.json({ error: "account_not_found", message: "账号不存在" }, 400);
      patch.account_id = value;
    } else {
      patch.account_id = "";
    }
  }

  const settings = await setWorkspaceSettings(c.env, patch);
  return c.json({ settings });
});
