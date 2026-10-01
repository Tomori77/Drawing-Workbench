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

function sizeFromParams(params: Record<string, unknown>): string {
  if (typeof params.size === "string") return params.size;
  const width = Number(params.width);
  const height = Number(params.height);
  if (width > 0 && height > 0) return `${width}x${height}`;
  return "832x1216";
}

export const openaiAdapter: Adapter = {
  type: "openai-compatible",

  buildRequest(
    canonical: CanonicalRequest,
    upstream: UpstreamConfig,
    credential: Credential
  ): UpstreamRequest {
    const body = {
      model: canonical.model,
      prompt: canonical.prompt.positive,
      n: canonical.n,
      size: sizeFromParams(canonical.params),
      response_format: "b64_json",
      ...(canonical.prompt.negative ? { negative_prompt: canonical.prompt.negative } : {}),
      parameters: canonical.params
    };

    return {
      url: joinUrl(upstream.base_url, "/v1/images/generations"),
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
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const images = (data.data ?? []).map((item) => ({ b64: item.b64_json, url: item.url }));
    return { ok: true, status: resp.status, images, cost_gems: null };
  }
};
