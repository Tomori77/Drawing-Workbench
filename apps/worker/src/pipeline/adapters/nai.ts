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

export const naiAdapter: Adapter = {
  type: "nai-compatible",

  buildRequest(
    canonical: CanonicalRequest,
    upstream: UpstreamConfig,
    credential: Credential
  ): UpstreamRequest {
    const parameters: Record<string, unknown> = {
      ...NAI_DEFAULTS,
      ...canonical.params,
      negative_prompt: canonical.prompt.negative || canonical.params.negative_prompt || "",
      n_samples: canonical.n
    };

    const body = {
      model: canonical.model,
      action: NAI_ACTION_MAP[canonical.action] ?? canonical.action,
      input: [canonical.prompt.positive],
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
