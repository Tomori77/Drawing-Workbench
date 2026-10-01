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

export const templateAdapter: Adapter = {
  type: "template",

  buildRequest(
    canonical: CanonicalRequest,
    upstream: UpstreamConfig,
    credential: Credential
  ): UpstreamRequest {
    const template = upstream.transform as {
      path?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: Record<string, unknown>;
    };
    return {
      url: joinUrl(upstream.base_url, template.path ?? "/v1/generate"),
      method: template.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${credential.token}`,
        ...(template.headers ?? {})
      },
      body: JSON.stringify({
        model: canonical.model,
        action: canonical.action,
        prompt: canonical.prompt.positive,
        negative_prompt: canonical.prompt.negative,
        params: canonical.params,
        references: canonical.references,
        n: canonical.n,
        ...(template.body ?? {})
      })
    };
  },

  async parseResponse(resp: Response): Promise<CanonicalResult> {
    if (!resp.ok) return errorFromResponse(resp);
    const data = (await resp.json().catch(() => ({}))) as {
      images?: Array<string | { b64?: string; b64_json?: string; url?: string }>;
    };
    const images = (data.images ?? []).map((item) =>
      typeof item === "string"
        ? { b64: item }
        : { b64: item.b64 ?? item.b64_json, url: item.url }
    );
    return { ok: true, status: resp.status, images, cost_gems: null };
  }
};
