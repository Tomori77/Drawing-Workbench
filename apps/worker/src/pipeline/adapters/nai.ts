import {
  type Adapter,
  type CanonicalRequest,
  type CanonicalResult,
  type Credential,
  type UpstreamConfig,
  type UpstreamRequest,
  errorFromResponse,
  joinUrl
} from "../types";

const NAI_ACTION_MAP: Record<string, string> = {
  txt2img: "generate",
  generate: "generate",
  img2img: "img2img",
  inpaint: "infill"
};

const NAI_DEFAULTS: Record<string, unknown> = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: "k_euler_ancestral",
  noise_schedule: "karras",
  negative_prompt: ""
};

// NAI 真正接受的生图参数白名单。网关协议里的字段（nocache/cfg/artist 等）
// 绝不能透传给上游，否则上游返回 502。此处按白名单过滤，作为最后一道防线。
const NAI_PARAM_KEYS = [
  "width",
  "height",
  "steps",
  "scale",
  "seed",
  "sampler",
  "noise_schedule",
  "negative_prompt",
  "n_samples",
  "image",
  "mask",
  "strength",
  "noise"
] as const;

function pickNaiParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of NAI_PARAM_KEYS) {
    if (params[key] !== undefined && params[key] !== null) out[key] = params[key];
  }
  return out;
}

export const naiAdapter: Adapter = {
  type: "nai-compatible",

  buildRequest(
    canonical: CanonicalRequest,
    upstream: UpstreamConfig,
    credential: Credential
  ): UpstreamRequest {
    // artist（画师串）应置于正向提示词最前；入站若已拼接则此处不再重复。
    const artist = typeof canonical.params.artist === "string" ? canonical.params.artist.trim() : "";
    const positive = canonical.prompt.positive || "";
    const composed = artist && !positive.startsWith(artist) ? `${artist}, ${positive}` : positive;

    const parameters: Record<string, unknown> = {
      ...NAI_DEFAULTS,
      ...pickNaiParams(canonical.params),
      negative_prompt: canonical.prompt.negative || canonical.params.negative_prompt || "",
      n_samples: canonical.n
    };

    const body = {
      model: canonical.model,
      action: NAI_ACTION_MAP[canonical.action] ?? canonical.action,
      input: [composed],
      parameters
    };

    return {
      url: joinUrl(upstream.base_url, "/v1/nai/generate-image"),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${credential.token}`
      },
      body: JSON.stringify(body)
    };
  },

  async parseResponse(resp: Response): Promise<CanonicalResult> {
    if (!resp.ok) return errorFromResponse(resp);
    const data = (await resp.json().catch(() => ({}))) as {
      images?: string[];
      job?: { cost_gems?: number };
      cost_gems?: number;
    };
    const headerRaw = resp.headers.get("X-Cost-Gems") ?? resp.headers.get("X-Cost");
    const headerCost = headerRaw === null ? Number.NaN : Number(headerRaw);
    const bodyCost = Number(data.job?.cost_gems ?? data.cost_gems);
    const cost = Number.isFinite(bodyCost) ? bodyCost : Number.isFinite(headerCost) ? headerCost : null;
    const images = (data.images ?? []).map((b64) => ({ b64 }));
    return { ok: true, status: resp.status, images, cost_gems: cost };
  }
};
