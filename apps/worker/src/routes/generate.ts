import { Hono } from "hono";
import { runPipeline, type PipelineResult } from "../pipeline/run";
import { b64ToBytes, type CanonicalRequest } from "../pipeline/types";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import { readJson } from "../lib/json";
import { requireSession, requireOrigin } from "./guard";
import { getWorkspaceSettings, type WorkspaceAccountMode } from "../pool/workspace";
import type { AccountStrategy } from "../db/upstreams";
import type { AppEnv } from "../types";

export const generate = new Hono<AppEnv>();

generate.use("*", requireSession);

const MAX_N = 8;
const DEFAULT_MODEL = "nai-diffusion-4-5-full";
export const SIZE_ALIAS: Record<string, string> = {
  "竖图": "832x1216",
  "横图": "1216x832",
  "方图": "1024x1024"
};

interface InboundBody {
  model?: string;
  prompt?: string | string[];
  input?: string | string[];
  negative_prompt?: string;
  action?: string;
  parameters?: Record<string, unknown>;
  n?: number;
  size?: string;
  upstream_id?: string;
  account_mode?: WorkspaceAccountMode;
  account_id?: string;
}

function isAccountMode(value: unknown): value is WorkspaceAccountMode {
  return value === "auto" || value === "balance" || value === "fixed";
}

function accountStrategyFor(mode: WorkspaceAccountMode): AccountStrategy {
  if (mode === "balance") return "balance_first";
  if (mode === "fixed") return "fixed";
  return "round_robin";
}

function asStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => String(item ?? "")).filter((item) => item.trim().length > 0);
}

export function parseSize(size: string | undefined): { width: number; height: number } | null {
  if (!size) return null;
  const raw = SIZE_ALIAS[size.trim()] ?? size.trim();
  const match = raw.match(/^(\d{2,5})\s*[xX×]\s*(\d{2,5})$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function inboundToCanonical(body: InboundBody): CanonicalRequest {
  const positives = asStringArray(body.prompt);
  const inputs = asStringArray(body.input);
  const positive = (positives.length ? positives : inputs).join(", ");
  const srcParams =
    body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters)
      ? body.parameters
      : {};
  const params: Record<string, unknown> = { ...srcParams };

  const negative = typeof body.negative_prompt === "string" ? body.negative_prompt : undefined;
  if (negative !== undefined) params.negative_prompt = negative;

  const size = parseSize(body.size);
  if (size) {
    if (params.width === undefined) params.width = size.width;
    if (params.height === undefined) params.height = size.height;
  }

  const n = Math.min(Math.max(Number(body.n) || Number(params.n_samples) || 1, 1), MAX_N);
  params.n_samples = n;

  return {
    model: String(body.model ?? DEFAULT_MODEL),
    action: String(body.action ?? "generate"),
    prompt: {
      positive,
      negative: typeof params.negative_prompt === "string" ? params.negative_prompt : ""
    },
    params,
    references: [],
    n
  };
}

export function mimeFrom(b64: string, contentType: string | null): string {
  if (contentType && contentType.startsWith("image/")) return contentType.split(";")[0]!.trim();
  if (b64.startsWith("iVBORw0KGgo")) return "image/png";
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

export interface PersistedImage {
  id: string;
  mime: string;
  bytes: Uint8Array;
}

export async function persistGeneration(
  env: AppEnv["Bindings"],
  canonical: CanonicalRequest,
  result: PipelineResult,
  role: string
): Promise<{ generation_id: string; images: PersistedImage[] }> {
  const generationId = newId();
  const created = nowIso();
  const images: PersistedImage[] = [];
  for (const image of result.images ?? []) {
    if (!image.b64) continue;
    images.push({
      id: newId(),
      mime: mimeFrom(image.b64, null),
      bytes: b64ToBytes(image.b64)
    });
  }

  await env.DB.prepare(
    "INSERT INTO generations (id, key_id, role, upstream_id, account_id, params_json, status, cost_gems, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      generationId,
      null,
      role,
      result.upstream_id ?? null,
      result.account_id ?? null,
      JSON.stringify(canonical.params),
      result.ok ? "success" : "failed",
      result.cost_gems ?? 0,
      created
    )
    .run();

  for (const image of images) {
    const r2Key = `img/${image.id}`;
    await env.BUCKET.put(r2Key, image.bytes, { httpMetadata: { contentType: image.mime } });
    await env.DB.prepare(
      "INSERT INTO assets (id, generation_id, r2_key, thumb_r2_key, mime, width, height, created_at) VALUES (?,?,?,?,?,?,?,?)"
    )
      .bind(image.id, generationId, r2Key, null, image.mime, null, null, created)
      .run();
  }

  return { generation_id: generationId, images };
}

export function mapUpstreamError(result: PipelineResult): { status: number; error: string; message: string } {
  const code = result.error?.code ?? "UPSTREAM_ERROR";
  const upstreamStatus = result.error?.status ?? result.status ?? 502;
  let status: number;
  if (code === "CONTENT_BLOCKED") status = upstreamStatus === 403 ? 403 : 400;
  else if (code === "UPSTREAM_RESPONSE_TOO_LARGE") status = 413;
  else if (code === "UPSTREAM_TIMEOUT") status = 504;
  else if (code === "NO_UPSTREAM" || code === "NO_ACCOUNT" || code === "ALL_ACCOUNTS_COOLING") status = 502;
  else if (upstreamStatus === 401 || upstreamStatus === 402 || upstreamStatus === 429) status = 429;
  else if (upstreamStatus === 413) status = 413;
  else if (upstreamStatus === 422) status = 422;
  else if (upstreamStatus >= 500) status = 502;
  else if (upstreamStatus >= 400) status = 400;
  else status = 502;
  return { status, error: code, message: result.error?.message ?? "upstream_error" };
}

generate.post("/", requireOrigin, async (c) => {
  const body = await readJson<InboundBody>(c);
  const canonical = inboundToCanonical(body);
  const role = c.get("role") ?? "friend";

  // 创作台独立于网关：读取工作台设置作为默认，body 可覆盖。
  const settings = await getWorkspaceSettings(c.env);
  const upstreamId = body.upstream_id ?? settings.upstream_id;
  const mode: WorkspaceAccountMode = isAccountMode(body.account_mode)
    ? body.account_mode
    : settings.account_mode;
  const accountId = mode === "fixed" ? body.account_id ?? settings.account_id : undefined;

  if (mode === "fixed" && !accountId) {
    return c.json({ error: "account_required", message: "固定账号模式需要 account_id" }, 400);
  }

  const result = await runPipeline(canonical, {
    env: c.env,
    upstreamId,
    accountId,
    accountStrategy: accountStrategyFor(mode),
    selectionScope: "workspace"
  });

  if (!result.ok) {
    const mapped = mapUpstreamError(result);
    return c.json(
      {
        error: mapped.error,
        message: mapped.message,
        generation_id: result.request_id ?? null,
        attempts: result.attempts ?? 0
      },
      mapped.status as 400
    );
  }

  const persisted = await persistGeneration(c.env, canonical, result, role);
  return c.json({
    generation_id: persisted.generation_id,
    cost_gems: result.cost_gems ?? null,
    upstream_id: result.upstream_id ?? null,
    account_id: result.account_id ?? null,
    attempts: result.attempts ?? 1,
    images: persisted.images.map((image) => ({
      id: image.id,
      url: `/api/gallery/i/${image.id}`,
      thumb_url: `/api/gallery/i/${image.id}?t=thumb`
    }))
  });
});
