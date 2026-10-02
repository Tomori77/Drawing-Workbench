import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { ApiKeyRow } from "../db/apiKeys";
import {
  authenticateGatewayKey,
  gatewayKeyAllowedModels,
  gatewayKeyAllowedUpstreams,
  gatewayKeyToPolicy
} from "../gateway/auth";
import {
  applyPolicyToCanonical,
  GatewayError,
  type GatewayPolicy
} from "../gateway/policy";
import { acquireLease, addUsageGems, releaseLease, reserveDaily } from "../gateway/quota";
import { inboundToCanonical, mimeFrom, parseSize } from "./generate";
import { runPipeline, type PipelineResult } from "../pipeline/run";
import { b64ToBytes, type CanonicalRequest } from "../pipeline/types";
import { listModels, listUpstreams } from "../db/upstreams";
import type { AppEnv } from "../types";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};

const LEASE_TTL_MS = 130_000;
const MAX_N = 8;
const DEFAULT_MODEL = "nai-diffusion-4-5-full";

type JsonStatus = 400 | 401 | 403 | 413 | 422 | 429 | 500 | 502 | 504;

const corsMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(CORS_HEADERS)) c.header(name, value);
});

function jsonError(
  c: import("hono").Context<AppEnv>,
  status: JsonStatus,
  error: string,
  message: string
) {
  return c.json({ error, message }, status);
}

function applyCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/* ---------------- 入站形状归一化 ---------------- */

interface OpenAiInbound {
  model?: string;
  prompt?: string | string[];
  n?: number;
  size?: string;
  response_format?: string;
  negative_prompt?: string;
  parameters?: Record<string, unknown>;
}

export function openaiInboundToCanonical(body: OpenAiInbound): CanonicalRequest {
  const prompt = Array.isArray(body.prompt) ? body.prompt.join(", ") : String(body.prompt ?? "");
  const params: Record<string, unknown> = {};
  const size = parseSize(body.size);
  if (size) {
    params.width = size.width;
    params.height = size.height;
  }
  if (typeof body.negative_prompt === "string") params.negative_prompt = body.negative_prompt;
  if (body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters)) {
    Object.assign(params, body.parameters);
  }
  const n = Math.min(Math.max(Number(body.n) || 1, 1), MAX_N);
  params.n_samples = n;
  return {
    model: String(body.model ?? DEFAULT_MODEL),
    action: "generate",
    prompt: {
      positive: prompt,
      negative: typeof params.negative_prompt === "string" ? params.negative_prompt : ""
    },
    params,
    references: [],
    n
  };
}

function queryInboundToCanonical(url: URL): CanonicalRequest {
  const q = url.searchParams;
  const params: Record<string, unknown> = {};
  const size = parseSize(q.get("size") ?? undefined);
  if (size) {
    params.width = size.width;
    params.height = size.height;
  }
  const steps = q.get("steps");
  if (steps) params.steps = Number(steps);
  const scale = q.get("scale") ?? q.get("cfg");
  if (scale) params.scale = Number(scale);
  const sampler = q.get("sampler");
  if (sampler) params.sampler = sampler;
  const noise = q.get("noise_schedule");
  if (noise) params.noise_schedule = noise;
  const negative = q.get("negative");
  if (negative) params.negative_prompt = negative;
  const nocache = q.get("nocache");
  if (nocache) params.nocache = nocache;
  params.n_samples = 1;

  return {
    model: q.get("model") || DEFAULT_MODEL,
    action: q.get("action") || "generate",
    prompt: {
      positive: q.get("tag") ?? q.get("prompt") ?? "",
      negative: negative ?? ""
    },
    params,
    references: [],
    n: 1
  };
}

/* ---------------- 核心流程 ---------------- */

interface GatewayCall {
  key: ApiKeyRow;
  policy: GatewayPolicy;
  mode: string;
  canonical: CanonicalRequest;
  rawBody?: Uint8Array;
  allowedUpstreams: string[];
  allowedModels: string[];
}

interface CoreOutcome {
  result: PipelineResult;
  requestId: string;
}

async function runGateway(
  env: AppEnv["Bindings"],
  call: GatewayCall
): Promise<CoreOutcome | { failure: { status: JsonStatus; error: string; message: string } }> {
  const { key, policy, mode } = call;

  const reserved = await reserveDaily(env, key.id, policy.daily_requests, policy.daily_gems);
  if (!reserved.ok) {
    return {
      failure: {
        status: 429,
        error: reserved.reason === "requests" ? "GATEWAY_DAILY_REQUEST_LIMIT" : "GATEWAY_DAILY_GEMS_LIMIT",
        message: reserved.reason === "requests" ? "已达到每日请求数限制" : "已达到每日 Gems 限制"
      }
    };
  }

  const lease = await acquireLease(env, key.id, policy.max_concurrency, LEASE_TTL_MS);
  if (!lease) {
    return {
      failure: { status: 429, error: "GATEWAY_CONCURRENCY_LIMIT", message: "当前并发已达限制" }
    };
  }

  try {
    const result = await runPipeline(call.canonical, {
      env,
      gatewayKeyId: key.id,
      mode,
      rawBody: mode === "passthrough" ? call.rawBody : undefined,
      allowedUpstreams: call.allowedUpstreams.length ? call.allowedUpstreams : undefined,
      allowedModels: call.allowedModels.length ? call.allowedModels : undefined
    });
    return { result, requestId: result.request_id ?? "" };
  } finally {
    await releaseLease(env, lease);
  }
}

function mapGatewayError(result: PipelineResult): { status: JsonStatus; error: string; message: string } {
  const code = result.error?.code ?? "UPSTREAM_ERROR";
  const raw = result.error?.status ?? result.status ?? 502;
  let status: JsonStatus;
  if (raw >= 400 && raw < 500) status = raw as JsonStatus;
  else status = 502;
  return { status, error: code, message: result.error?.message ?? "upstream_error" };
}

function setResultHeaders(c: import("hono").Context<AppEnv>, result: PipelineResult): void {
  c.header("Cache-Control", "no-store");
  if (result.account_id) c.header("X-Account-Id", result.account_id);
  if (result.attempts !== undefined) c.header("X-Gateway-Attempts", String(result.attempts));
  if (result.request_id) c.header("X-Gateway-Request-Id", result.request_id);
}

async function authenticate(
  c: import("hono").Context<AppEnv>,
  allowQueryToken: boolean
): Promise<ApiKeyRow | null> {
  return authenticateGatewayKey(c.env, c.req.raw, { allowQueryToken });
}

/* ---------------- 子应用 ---------------- */

export const gatewayV1 = new Hono<AppEnv>();
gatewayV1.use("*", corsMiddleware);

gatewayV1.options("*", (c) => c.body(null, 204));

// POST /v1/nai/generate-image —— NAI 原生兼容
gatewayV1.post("/nai/generate-image", async (c) => {
  const key = await authenticate(c, false);
  if (!key) return jsonError(c, 401, "GATEWAY_KEY_INVALID", "Gateway API Key 无效或未提供");

  const rawBody = new Uint8Array(await c.req.arrayBuffer());
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>;
  } catch {
    return jsonError(c, 400, "INVALID_JSON", "请求 JSON 无效");
  }

  const policy = gatewayKeyToPolicy(key);
  const mode = key.mode === "passthrough" ? "passthrough" : "restricted";
  let canonical = inboundToCanonical(parsed);
  if (mode === "restricted") {
    try {
      canonical = applyPolicyToCanonical(canonical, policy);
    } catch (err) {
      if (err instanceof GatewayError) return jsonError(c, err.status as JsonStatus, err.code, err.message);
      throw err;
    }
  }

  const outcome = await runGateway(c.env, {
    key,
    policy,
    mode,
    canonical,
    rawBody,
    allowedUpstreams: gatewayKeyAllowedUpstreams(key),
    allowedModels: gatewayKeyAllowedModels(key)
  });
  if ("failure" in outcome) return jsonError(c, outcome.failure.status, outcome.failure.error, outcome.failure.message);

  const { result } = outcome;
  if (!result.ok) {
    const mapped = mapGatewayError(result);
    setResultHeaders(c, result);
    return jsonError(c, mapped.status, mapped.error, mapped.message);
  }

  await addUsageGems(c.env, key.id, result.cost_gems ?? 0);
  setResultHeaders(c, result);
  const images = (result.images ?? []).map((image) => ({ b64: image.b64 ?? null, url: image.url ?? null }));
  return c.json({
    cost_gems: result.cost_gems ?? null,
    images,
    b64_images: images.map((i) => i.b64).filter((b): b is string => Boolean(b))
  });
});

// POST /v1/images/generations —— OpenAI 图像兼容
gatewayV1.post("/images/generations", async (c) => {
  const key = await authenticate(c, false);
  if (!key) return jsonError(c, 401, "GATEWAY_KEY_INVALID", "Gateway API Key 无效或未提供");

  const rawBody = new Uint8Array(await c.req.arrayBuffer());
  let parsed: OpenAiInbound = {};
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBody)) as OpenAiInbound;
  } catch {
    return jsonError(c, 400, "INVALID_JSON", "请求 JSON 无效");
  }

  const policy = gatewayKeyToPolicy(key);
  const mode = key.mode === "passthrough" ? "passthrough" : "restricted";
  const responseFormat = parsed.response_format === "url" ? "url" : "b64_json";
  let canonical = openaiInboundToCanonical(parsed);
  if (mode === "restricted") {
    try {
      canonical = applyPolicyToCanonical(canonical, policy);
    } catch (err) {
      if (err instanceof GatewayError) return jsonError(c, err.status as JsonStatus, err.code, err.message);
      throw err;
    }
  }

  const outcome = await runGateway(c.env, {
    key,
    policy,
    mode,
    canonical,
    rawBody,
    allowedUpstreams: gatewayKeyAllowedUpstreams(key),
    allowedModels: gatewayKeyAllowedModels(key)
  });
  if ("failure" in outcome) return jsonError(c, outcome.failure.status, outcome.failure.error, outcome.failure.message);

  const { result } = outcome;
  if (!result.ok) {
    const mapped = mapGatewayError(result);
    setResultHeaders(c, result);
    return jsonError(c, mapped.status, mapped.error, mapped.message);
  }

  await addUsageGems(c.env, key.id, result.cost_gems ?? 0);
  setResultHeaders(c, result);
  const data = (result.images ?? []).map((image) => {
    if (responseFormat === "url") {
      if (image.url) return { url: image.url };
      if (image.b64) return { url: `data:${mimeFrom(image.b64, null)};base64,${image.b64}` };
      return {};
    }
    return { b64_json: image.b64 ?? null };
  });
  return c.json({ created: Math.floor(Date.now() / 1000), data });
});

// GET /v1/models —— 归一化模型列表
gatewayV1.get("/models", async (c) => {
  const key = await authenticate(c, false);
  if (!key) return jsonError(c, 401, "GATEWAY_KEY_INVALID", "Gateway API Key 无效或未提供");

  const ids = new Set<string>();
  for (const row of await listModels(c.env)) {
    if (row.enabled !== 0) ids.add(row.logical_name);
  }
  for (const upstream of await listUpstreams(c.env)) {
    if (!upstream.enabled) continue;
    for (const model of upstream.models) ids.add(model);
  }
  c.header("Cache-Control", "no-store");
  return c.json({ object: "list", data: [...ids].map((id) => ({ id, object: "model" })) });
});

/* ---------------- GET /generate（下游魔改版兼容） ---------------- */

export const gatewayGenerateRoute = new Hono<AppEnv>();
gatewayGenerateRoute.use("*", corsMiddleware);

gatewayGenerateRoute.options("*", (c) => c.body(null, 204));

gatewayGenerateRoute.get("/", async (c) => {
  const key = await authenticate(c, true);
  if (!key) return jsonError(c, 401, "GATEWAY_KEY_INVALID", "Gateway API Key 无效或未提供");

  const policy = gatewayKeyToPolicy(key);
  const mode = key.mode === "passthrough" ? "passthrough" : "restricted";
  let canonical = queryInboundToCanonical(new URL(c.req.url));
  if (mode === "restricted") {
    try {
      canonical = applyPolicyToCanonical(canonical, policy);
    } catch (err) {
      if (err instanceof GatewayError) return jsonError(c, err.status as JsonStatus, err.code, err.message);
      throw err;
    }
  }

  const outcome = await runGateway(c.env, {
    key,
    policy,
    mode,
    canonical,
    allowedUpstreams: gatewayKeyAllowedUpstreams(key),
    allowedModels: gatewayKeyAllowedModels(key)
  });
  if ("failure" in outcome) return jsonError(c, outcome.failure.status, outcome.failure.error, outcome.failure.message);

  const { result } = outcome;
  if (!result.ok) {
    const mapped = mapGatewayError(result);
    return jsonError(c, mapped.status, mapped.error, mapped.message);
  }

  await addUsageGems(c.env, key.id, result.cost_gems ?? 0);
  const first = (result.images ?? []).find((image) => image.b64);
  if (!first?.b64) {
    return applyCors(jsonError(c, 502, "EMPTY_IMAGE", "上游未返回图片"));
  }
  const headers = new Headers({
    "Content-Type": mimeFrom(first.b64, null),
    "Cache-Control": "no-store",
    ...CORS_HEADERS
  });
  if (result.account_id) headers.set("X-Account-Id", result.account_id);
  if (result.attempts !== undefined) headers.set("X-Gateway-Attempts", String(result.attempts));
  if (result.request_id) headers.set("X-Gateway-Request-Id", result.request_id);
  return new Response(b64ToBytes(first.b64), { status: 200, headers });
});
