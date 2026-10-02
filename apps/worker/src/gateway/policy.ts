import type { CanonicalRequest } from "../pipeline/types";

export type ParameterMode = "merge" | "fixed";

export interface GatewayLimit {
  min?: number;
  max?: number;
}

export interface GatewayPolicy {
  allowed_models: string[];
  daily_requests: number;
  daily_gems: number;
  max_concurrency: number;
  parameter_mode: ParameterMode;
  fixed_parameters: Record<string, unknown>;
  limits: Record<string, GatewayLimit>;
  allow_img2img: boolean;
  allow_inpaint: boolean;
  allow_extra_parameters: boolean;
}

export const DEFAULT_GATEWAY_POLICY: GatewayPolicy = {
  allowed_models: [],
  daily_requests: 0,
  daily_gems: 0,
  max_concurrency: 0,
  parameter_mode: "merge",
  fixed_parameters: {},
  limits: {},
  allow_img2img: true,
  allow_inpaint: true,
  allow_extra_parameters: true
};

// 已知参数白名单：allow_extra_parameters=false 时用于拒绝未知参数。
export const GATEWAY_KNOWN_PARAMETERS = new Set<string>([
  "width",
  "height",
  "steps",
  "n_samples",
  "scale",
  "seed",
  "sampler",
  "noise_schedule",
  "negative_prompt",
  "image",
  "mask",
  "img2img",
  "inpaint",
  "cfg",
  "cfg_scale",
  "denoising_strength",
  "strength",
  "n",
  "size",
  "prompt",
  "parameters",
  "action",
  "model",
  "response_format",
  "artist",
  "nocache"
]);

export class GatewayError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
  }
}

function asNumberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeLimits(raw: unknown): Record<string, GatewayLimit> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, GatewayLimit> = {};
  for (const [field, rule] of Object.entries(raw as Record<string, unknown>)) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) continue;
    const r = rule as Record<string, unknown>;
    const limit: GatewayLimit = {};
    if (Number.isFinite(Number(r.min))) limit.min = Number(r.min);
    if (Number.isFinite(Number(r.max))) limit.max = Number(r.max);
    out[field] = limit;
  }
  return out;
}

function objectOrEmpty(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
}

export function normalizePolicy(raw: unknown): GatewayPolicy {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    allowed_models: Array.isArray(source.allowed_models)
      ? source.allowed_models.map((m) => String(m)).filter((m) => m.length > 0)
      : [],
    daily_requests: asNumberOrZero(source.daily_requests),
    daily_gems: asNumberOrZero(source.daily_gems),
    max_concurrency: asNumberOrZero(source.max_concurrency),
    parameter_mode: source.parameter_mode === "fixed" ? "fixed" : "merge",
    fixed_parameters: objectOrEmpty(source.fixed_parameters),
    limits: normalizeLimits(source.limits),
    allow_img2img: typeof source.allow_img2img === "boolean" ? source.allow_img2img : true,
    allow_inpaint: typeof source.allow_inpaint === "boolean" ? source.allow_inpaint : true,
    allow_extra_parameters:
      typeof source.allow_extra_parameters === "boolean" ? source.allow_extra_parameters : true
  };
}

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

function isImg2Img(action: string, params: Record<string, unknown>): boolean {
  return action === "img2img" || params.img2img != null || params.image != null;
}

function isInpaint(action: string, params: Record<string, unknown>): boolean {
  return action === "inpaint" || action === "infill" || params.inpaint != null || params.mask != null;
}

export function applyPolicyToCanonical(
  canonical: CanonicalRequest,
  policy: GatewayPolicy
): CanonicalRequest {
  const model = canonical.model;
  if (policy.allowed_models.length && !policy.allowed_models.includes(model)) {
    throw new GatewayError(403, "GATEWAY_MODEL_RESTRICTED", "模型不在该 Key 的允许列表中");
  }

  const action = String(canonical.action || "").toLowerCase();
  if (!policy.allow_img2img && isImg2Img(action, canonical.params)) {
    throw new GatewayError(403, "GATEWAY_IMG2IMG_RESTRICTED", "该 Key 不允许 img2img");
  }
  if (!policy.allow_inpaint && isInpaint(action, canonical.params)) {
    throw new GatewayError(403, "GATEWAY_INPAINT_RESTRICTED", "该 Key 不允许 inpaint");
  }

  if (!policy.allow_extra_parameters) {
    const unknown = Object.keys(canonical.params).filter((k) => !GATEWAY_KNOWN_PARAMETERS.has(k));
    if (unknown.length) {
      throw new GatewayError(
        403,
        "GATEWAY_UNKNOWN_PARAMETER",
        `请求包含未知参数：${unknown.slice(0, 10).join(", ")}`
      );
    }
  }

  const next = cloneCanonical(canonical);

  if (policy.parameter_mode === "fixed" && Object.keys(policy.fixed_parameters).length) {
    next.params = { ...next.params, ...policy.fixed_parameters };
  }

  for (const [field, rule] of Object.entries(policy.limits)) {
    const value = Number(next.params[field]);
    if (!Number.isFinite(value)) continue;
    let clamped = value;
    if (rule.min !== undefined && clamped < rule.min) clamped = rule.min;
    if (rule.max !== undefined && clamped > rule.max) clamped = rule.max;
    next.params[field] = clamped;
  }

  return next;
}
