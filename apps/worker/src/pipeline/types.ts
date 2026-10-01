export interface CanonicalPrompt {
  positive: string;
  negative: string;
}

export interface CanonicalRequest {
  model: string;
  action: string;
  prompt: CanonicalPrompt;
  params: Record<string, unknown>;
  references: string[];
  n: number;
}

export interface UpstreamConfig {
  id: string;
  type: string;
  base_url: string;
  credential?: string | null;
  models: string[];
  capabilities: Record<string, unknown>;
  transform: Record<string, unknown>;
  priority: number;
  weight: number;
}

export interface Credential {
  token: string;
}

export interface UpstreamRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface CanonicalImage {
  b64?: string;
  url?: string;
}

export interface CanonicalError {
  message: string;
  code: string;
  status?: number;
  retryable?: boolean;
}

export interface CanonicalResult {
  ok: boolean;
  status?: number;
  images?: CanonicalImage[];
  cost_gems?: number | null;
  error?: CanonicalError;
}

export interface Adapter {
  readonly type: string;
  buildRequest(
    canonical: CanonicalRequest,
    upstream: UpstreamConfig,
    credential: Credential
  ): UpstreamRequest;
  parseResponse(resp: Response): Promise<CanonicalResult>;
}

export function emptyResult(ok = true): CanonicalResult {
  return { ok };
}

export function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export { joinUrl } from "../lib/url";

export async function errorFromResponse(resp: Response): Promise<CanonicalResult> {
  const data = await resp.json().catch(() => ({} as Record<string, unknown>));
  const record = data as Record<string, unknown>;
  const message = String(record.detail ?? record.message ?? (record.error as Record<string, unknown> | undefined)?.message ?? resp.statusText ?? "upstream_error");
  return {
    ok: false,
    status: resp.status,
    error: {
      message,
      code: "UPSTREAM_ERROR",
      status: resp.status,
      retryable: resp.status === 401 || resp.status === 402 || resp.status === 429 || resp.status >= 500
    }
  };
}
