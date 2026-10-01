export interface ApiErrorBody {
  error?: string;
  message?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function readError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = {};
  }
  const code = body.error ?? `http_${res.status}`;
  const message = body.message ?? body.error ?? `请求失败（${res.status}）`;
  return new ApiError(res.status, code, message);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include"
  });
  if (!res.ok) throw await readError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface GenerateImage {
  id: string;
  url: string;
  thumb_url?: string;
  width?: number;
  height?: number;
}

export interface GenerateResult {
  generation_id: string;
  images: GenerateImage[];
  cost_gems?: number | null;
  upstream_id?: string | null;
  account_id?: string | null;
  attempts?: number;
}

export interface GenerateParams {
  model: string;
  prompt: string;
  negative_prompt: string;
  action: string;
  n: number;
  size: string;
  parameters: {
    width: number;
    height: number;
    steps: number;
    scale: number;
    seed: number;
    sampler: string;
    noise_schedule: string;
  };
}

export function generate(body: GenerateParams): Promise<GenerateResult> {
  return apiFetch<GenerateResult>("/api/generate", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export interface GalleryItem {
  id: string;
  generation_id: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
  url: string;
  thumb_url: string | null;
}

export interface GalleryPage {
  items: GalleryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListGalleryArgs {
  limit?: number;
  offset?: number;
}

export function listGallery({ limit = 24, offset = 0 }: ListGalleryArgs = {}): Promise<GalleryPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return apiFetch<GalleryPage>(`/api/gallery?${params.toString()}`);
}

export function deleteAsset(id: string): Promise<{ ok: boolean; id: string }> {
  return apiFetch<{ ok: boolean; id: string }>(`/api/gallery/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function clearGallery(): Promise<{ ok: boolean; deleted_images: number; deleted_thumbs: number }> {
  return apiFetch("/api/gallery/clear", {
    method: "POST",
    body: JSON.stringify({ confirm: true })
  });
}

export function uploadThumb(id: string, image: string, mime = "image/webp"): Promise<{ ok: boolean; id: string; thumb_url: string }> {
  return apiFetch(`/api/gallery/${encodeURIComponent(id)}/thumb`, {
    method: "POST",
    body: JSON.stringify({ image, mime })
  });
}

export type AccountStatus =
  | "pending"
  | "success"
  | "retry"
  | "jwt_expired"
  | "manual_required"
  | (string & {});

export interface AccountPublic {
  id: string;
  upstream_id: string;
  label: string | null;
  username: string;
  has_jwt: boolean;
  has_password: boolean;
  has_api_token: boolean;
  gems_last: number | null;
  enabled: boolean;
  status: AccountStatus;
  failure_count: number;
  cooldown_until: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
  provision_error?: string;
}

export interface ProvisionTokenResult {
  ok: boolean;
  id: string;
  has_api_token: boolean;
}

export interface AccountListResponse {
  items: AccountPublic[];
  total_gems: number;
}

export interface UpstreamPublic {
  id: string;
  name: string;
  type: string;
  base_url: string;
  has_auth: boolean;
  models: string[];
  capabilities: Record<string, unknown>;
  transform: Record<string, unknown>;
  priority: number;
  weight: number;
  enabled: boolean;
  created_at: string;
}

export interface UpstreamListResponse {
  items: UpstreamPublic[];
}

export interface CreateAccountBody {
  upstream_id: string;
  username: string;
  password: string;
  api_token?: string;
  label?: string;
}

export interface BatchCreateAccountBody {
  upstream_id: string;
  items: Array<{ username: string; password: string }>;
}

export interface BatchCreateResultItem {
  username: string;
  ok: boolean;
  id?: string;
  error?: string;
}

export interface BatchCreateResult {
  created: number;
  failed: number;
  items: BatchCreateResultItem[];
}

export interface UpdateAccountPatch {
  label?: string | null;
  enabled?: boolean;
  api_token?: string | null;
  password?: string;
}

export interface AccountBalance {
  id: string;
  gems_last: number | null;
}

export interface RefreshAllResult {
  refreshed: number;
  failed: number;
  total_gems: number;
  items: Array<{ id: string; ok: boolean; gems?: number; error?: string }>;
}

export function listAccounts(upstreamId?: string): Promise<AccountListResponse> {
  const suffix = upstreamId ? `?upstream_id=${encodeURIComponent(upstreamId)}` : "";
  return apiFetch<AccountListResponse>(`/api/accounts${suffix}`);
}

export function createAccount(body: CreateAccountBody): Promise<AccountPublic> {
  return apiFetch<AccountPublic>("/api/accounts", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function batchCreateAccounts(body: BatchCreateAccountBody): Promise<BatchCreateResult> {
  return apiFetch<BatchCreateResult>("/api/accounts/batch", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function updateAccount(id: string, patch: UpdateAccountPatch): Promise<AccountPublic> {
  return apiFetch<AccountPublic>(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteAccount(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function refreshAccountGems(id: string): Promise<AccountBalance> {
  return apiFetch<AccountBalance>(`/api/accounts/${encodeURIComponent(id)}/balance`);
}

export function refreshAllGems(): Promise<RefreshAllResult> {
  return apiFetch<RefreshAllResult>("/api/accounts/refresh_gems", {
    method: "POST"
  });
}

export function provisionAccountToken(id: string): Promise<ProvisionTokenResult> {
  return apiFetch<ProvisionTokenResult>(`/api/accounts/${encodeURIComponent(id)}/provision_token`, {
    method: "POST"
  });
}

export function listUpstreams(): Promise<UpstreamListResponse> {
  return apiFetch<UpstreamListResponse>("/api/upstreams");
}
