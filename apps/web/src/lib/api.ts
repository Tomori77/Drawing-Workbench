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
  owner_sid?: string;
  size_bytes?: number;
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
  sid?: string;
}

export function listGallery({ limit = 24, offset = 0, sid }: ListGalleryArgs = {}): Promise<GalleryPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (sid) params.set("sid", sid);
  return apiFetch<GalleryPage>(`/api/gallery?${params.toString()}`);
}

export interface GalleryOverviewItem {
  sid: string;
  label: string;
  role: string;
  quota_bytes: number | null;
  used_bytes: number;
  count: number;
}

export interface GalleryOverviewResponse {
  items: GalleryOverviewItem[];
}

export function getGalleryOverview(): Promise<GalleryOverviewResponse> {
  return apiFetch<GalleryOverviewResponse>("/api/gallery/overview");
}

export interface SharePassword {
  id: string;
  label: string;
  role: string;
  quota_bytes: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  used_bytes?: number;
  count?: number;
}

export interface SharePasswordInput {
  label?: string;
  password: string;
  quota_bytes?: number;
}

export interface SharePasswordPatch {
  label?: string;
  password?: string;
  quota_bytes?: number;
  enabled?: boolean;
}

export interface SharePasswordListResponse {
  items: SharePassword[];
}

export function listSharePasswords(): Promise<SharePasswordListResponse> {
  return apiFetch<SharePasswordListResponse>("/api/share-passwords");
}

export function createSharePassword(body: SharePasswordInput): Promise<SharePassword> {
  return apiFetch<SharePassword>("/api/share-passwords", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function updateSharePassword(id: string, patch: SharePasswordPatch): Promise<SharePassword> {
  return apiFetch<SharePassword>(`/api/share-passwords/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteSharePassword(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/share-passwords/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function deleteAsset(id: string): Promise<{ ok: boolean; id: string }> {
  return apiFetch<{ ok: boolean; id: string }>(`/api/gallery/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function clearGallery(sid?: string): Promise<{ ok: boolean }> {
  return apiFetch("/api/gallery/clear", {
    method: "POST",
    body: JSON.stringify(sid ? { confirm: true, sid } : { confirm: true })
  });
}

export interface AuthMe {
  role: "owner" | "friend";
  sid?: string;
}

export function getMe(): Promise<AuthMe> {
  return apiFetch<AuthMe>("/api/auth/me");
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

export interface ProvisionAllAccountTokensBody {
  ids?: string[];
  upstream_id?: string;
}

export interface ProvisionAllResultItem {
  id: string;
  username: string;
  ok: boolean;
  has_api_token: boolean;
  error?: string;
}

export interface ProvisionAllResult {
  total: number;
  success: number;
  failed: number;
  items: ProvisionAllResultItem[];
}

export interface BatchDeleteAccountsResult {
  deleted: number;
  items: Array<{ id: string; ok: boolean; error?: string }>;
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

export function provisionAllAccountTokens(
  body: ProvisionAllAccountTokensBody
): Promise<ProvisionAllResult> {
  return apiFetch<ProvisionAllResult>("/api/accounts/provision_all", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function batchDeleteAccounts(ids: string[]): Promise<BatchDeleteAccountsResult> {
  return apiFetch<BatchDeleteAccountsResult>("/api/accounts/batch_delete", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}

export function listUpstreams(): Promise<UpstreamListResponse> {
  return apiFetch<UpstreamListResponse>("/api/upstreams");
}

export interface UpstreamInput {
  name?: string;
  type?: string;
  base_url?: string;
  auth?: string | null;
  models?: string[];
  capabilities?: Record<string, unknown>;
  transform?: Record<string, unknown>;
  priority?: number;
  weight?: number;
  enabled?: boolean;
}

export interface ModelRow {
  logical_name: string;
  upstream_id: string;
  upstream_model: string;
  enabled: number;
}

export interface ModelListResponse {
  items: ModelRow[];
}

export function createUpstream(body: UpstreamInput): Promise<UpstreamPublic> {
  return apiFetch<UpstreamPublic>("/api/upstreams", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function updateUpstream(id: string, patch: UpstreamInput): Promise<UpstreamPublic> {
  return apiFetch<UpstreamPublic>(`/api/upstreams/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteUpstream(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/upstreams/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function listModels(): Promise<ModelListResponse> {
  return apiFetch<ModelListResponse>("/api/models");
}

export interface ApiKeyPolicy {
  allowed_models?: string[];
  daily_requests?: number;
  daily_gems?: number;
  max_concurrency?: number;
  parameter_mode?: "merge" | "fixed";
  fixed_parameters?: Record<string, unknown>;
  limits?: Record<string, { min?: number; max?: number }>;
  allow_img2img?: boolean;
  allow_inpaint?: boolean;
  allow_extra_parameters?: boolean;
  [key: string]: unknown;
}

export interface ApiKeyPublic {
  id: string;
  name: string | null;
  role: string;
  mode: string;
  policy: ApiKeyPolicy;
  allowed_models: string[];
  allowed_upstreams: string[];
  quota: number | null;
  used_count: number;
  rate_limit: number | null;
  expires_at: string | null;
  enabled: boolean;
  created_at: string;
}

export interface ApiKeyInput {
  name?: string | null;
  role?: string;
  mode?: string;
  policy?: ApiKeyPolicy;
  allowed_models?: string[];
  allowed_upstreams?: string[];
  quota?: number | null;
  rate_limit?: number | null;
  expires_at?: string | null;
  enabled?: boolean;
}

export interface ApiKeyCreated extends ApiKeyPublic {
  key: string;
}

export interface ApiKeyListResponse {
  items: ApiKeyPublic[];
}

export function listApiKeys(): Promise<ApiKeyListResponse> {
  return apiFetch<ApiKeyListResponse>("/api/keys");
}

export function getApiKey(id: string): Promise<ApiKeyPublic> {
  return apiFetch<ApiKeyPublic>(`/api/keys/${encodeURIComponent(id)}`);
}

export function createApiKey(body: ApiKeyInput): Promise<ApiKeyCreated> {
  return apiFetch<ApiKeyCreated>("/api/keys", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function updateApiKey(id: string, patch: ApiKeyInput): Promise<ApiKeyPublic> {
  return apiFetch<ApiKeyPublic>(`/api/keys/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteApiKey(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/keys/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export interface CheckinSettings {
  enabled: boolean;
  timezone: string;
  weekday_times: string[];
  weekend_times: string[];
  next_run_at: string | null;
  lease_until: string | null;
  status: string;
  last_message: string | null;
  updated_at: string;
}

export interface CheckinSettingsPatch {
  enabled?: boolean;
  timezone?: string;
  weekday_times?: string[];
  weekend_times?: string[];
}

export type CheckinStatus = "success" | "retry" | "jwt_expired" | "manual_required" | "skipped" | (string & {});

export interface CheckinResult {
  account_id: string;
  ok: boolean;
  status: CheckinStatus;
  slot: string | null;
  status_code: number | null;
  message: string;
}

export interface CheckinTestResult {
  total: number;
  success: number;
  items: CheckinResult[];
}

export function getCheckinSettings(): Promise<CheckinSettings> {
  return apiFetch<CheckinSettings>("/api/checkin/settings");
}

export function updateCheckinSettings(patch: CheckinSettingsPatch): Promise<CheckinSettings> {
  return apiFetch<CheckinSettings>("/api/checkin/settings", {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function runCheckinTest(): Promise<CheckinTestResult> {
  return apiFetch<CheckinTestResult>("/api/checkin/test", {
    method: "POST"
  });
}

export function checkinAccount(id: string): Promise<CheckinResult> {
  return apiFetch<CheckinResult>(`/api/accounts/${encodeURIComponent(id)}/test`, {
    method: "POST"
  });
}

export type LogSource = "workbench" | "gateway";

export interface LogItem {
  id: number;
  request_id: string;
  source: LogSource;
  path: string;
  mode: string;
  status_code: number | null;
  ok: boolean;
  duration_ms: number | null;
  bytes_in: number | null;
  bytes_out: number | null;
  cost_gems: number;
  created_at: string;
  key_name: string | null;
  account_label: string | null;
}

export interface LogsPage {
  items: LogItem[];
  total: number;
  counts: { workbench: number; gateway: number };
  limit: number;
  offset: number;
}

export interface ListLogsArgs {
  source?: "all" | LogSource;
  status?: "all" | "ok" | "fail";
  limit?: number;
  offset?: number;
}

export function listLogs({
  source = "all",
  status = "all",
  limit = 50,
  offset = 0
}: ListLogsArgs = {}): Promise<LogsPage> {
  const params = new URLSearchParams({
    source,
    status,
    limit: String(limit),
    offset: String(offset)
  });
  return apiFetch<LogsPage>(`/api/logs?${params.toString()}`);
}

export interface LogAttempt {
  id: number;
  request_id: string;
  gateway_key_id: string | null;
  account_id: string | null;
  attempt_no: number;
  status_code: number | null;
  error: string | null;
  created_at: string;
  account_label: string | null;
}

export interface LogAttemptsResponse {
  items: LogAttempt[];
  total: number;
}

export function getLogAttempts(requestId: string): Promise<LogAttemptsResponse> {
  return apiFetch<LogAttemptsResponse>(
    `/api/logs/${encodeURIComponent(requestId)}/attempts`
  );
}

export interface SiteCounts {
  accounts: number;
  upstreams: number;
  api_keys: number;
  generations: number;
  logs: number;
}

export interface Profile {
  nickname: string;
  avatar_color: string;
  preferences: Record<string, unknown>;
  updated_at: string;
  identity: { role: string };
  site: {
    version: string;
    environment: string;
    domain: string | null;
    counts: SiteCounts;
  };
}

export interface ProfilePatch {
  nickname?: string;
  avatar_color?: string;
  preferences?: Record<string, unknown>;
}

export function getProfile(): Promise<Profile> {
  return apiFetch<Profile>("/api/profile");
}

export function updateProfile(patch: ProfilePatch): Promise<Profile> {
  return apiFetch<Profile>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}
