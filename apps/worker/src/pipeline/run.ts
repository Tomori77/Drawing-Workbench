import type { Env } from "../types";
import { listUpstreams, getUpstreamSecret, getUpstream, parseAccountStrategy } from "../db/upstreams";
import { selectAccounts, type AccountStrategy } from "../pool/select";
import { markAccountFailure, markAccountSuccess, isCooldownTrigger } from "../pool/cooldown";
import { refreshJwt } from "../pool/login";
import { getAccountLimit, addAccountImages } from "../pool/limit";
import { getAdapter } from "./registry";
import { applyRules, loadRules, RewriteBlockedError } from "../rewrite/engine";
import type { RewriteRule } from "../rewrite/types";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";
import { truncateLog } from "../lib/log";
import {
  type Adapter,
  type CanonicalRequest,
  type CanonicalResult,
  type UpstreamConfig,
  type UpstreamRequest
} from "./types";

const UPSTREAM_TIMEOUT_MS = 120_000;
const UPSTREAM_MAX_BYTES = 16 * 1024 * 1024;
const ATTEMPT_ERROR_MAX = 300;

export interface PipelineOptions {
  env: Env;
  fetch?: typeof fetch;
  rewrite?: (canonical: CanonicalRequest) => Promise<CanonicalRequest>;
  rewriteRules?: RewriteRule[];
  skipRewrite?: boolean;
  selectUpstreams?: (upstreams: UpstreamConfig[]) => UpstreamConfig[];
  credential?: string;
  accountStrategy?: string;
  timeoutMs?: number;
  maxBytes?: number;
  gatewayKeyId?: string;
  mode?: string;
  rawBody?: Uint8Array | string;
  allowedUpstreams?: string[];
  allowedModels?: string[];
  upstreamId?: string;
  accountId?: string;
  cursorKey?: string;
  selectionScope?: "workspace" | "gateway";
}

export interface PipelineAttempt {
  account_id: string | null;
  attempt_no: number;
  status_code: number | null;
  error?: string;
}

export interface PipelineResult extends CanonicalResult {
  upstream_id?: string;
  account_id?: string | null;
  request_id?: string;
  attempts?: number;
  attempts_detail?: PipelineAttempt[];
  duration_ms?: number;
  request?: UpstreamRequest;
}

class BodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyTooLargeError";
  }
}

interface UpstreamCall {
  request: UpstreamRequest;
  adapter: Adapter;
}

function outputBytes(result: CanonicalResult): number {
  return (
    result.images?.reduce((sum, img) => sum + (img.b64 ? Math.ceil((img.b64.length * 3) / 4) : 0), 0) ?? 0
  );
}

async function loadUpstreams(env: Env): Promise<UpstreamConfig[]> {
  const rows = await listUpstreams(env);
  return rows
    .filter((row) => row.enabled)
    .map((row) => ({
      id: row.id,
      type: row.type,
      base_url: row.base_url,
      models: row.models,
      capabilities: row.capabilities,
      transform: row.transform,
      priority: row.priority,
      weight: row.weight
    }));
}

async function readBounded(resp: Response, maxBytes: number, controller: AbortController): Promise<Uint8Array> {
  if (!resp.body) return new Uint8Array(0);
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => {});
        throw new BodyTooLargeError(`upstream response exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function parseAttempt(
  adapter: Adapter,
  resp: Response,
  maxBytes: number,
  controller: AbortController
): Promise<CanonicalResult> {
  const bytes = await readBounded(resp, maxBytes, controller);
  const text = new TextDecoder().decode(bytes);
  let body: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        status: resp.status,
        error: {
          message: truncateLog(text || resp.statusText || "upstream_error"),
          code: "UPSTREAM_ERROR",
          status: resp.status,
          retryable: resp.status === 401 || resp.status === 402 || resp.status === 429 || resp.status >= 500
        }
      };
    }
  }
  const synthetic = new Response(JSON.stringify(body), {
    status: resp.status,
    statusText: resp.statusText,
    headers: { "Content-Type": resp.headers.get("Content-Type") ?? "application/json" }
  });
  return adapter.parseResponse(synthetic);
}

async function executeAttempt(
  doFetch: typeof fetch,
  adapter: Adapter,
  request: UpstreamRequest,
  timeoutMs: number,
  maxBytes: number
): Promise<{ result: CanonicalResult; status: number | null; timings: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const resp = await doFetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal
    });
    const result = await parseAttempt(adapter, resp, maxBytes, controller);
    return { result, status: resp.status, timings: Date.now() - started };
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return {
        result: {
          ok: false,
          status: 413,
          error: {
            message: "upstream_response_too_large",
            code: "UPSTREAM_RESPONSE_TOO_LARGE",
            status: 413,
            retryable: false
          }
        },
        status: 413,
        timings: Date.now() - started
      };
    }
    const aborted = controller.signal.aborted;
    const message = err instanceof Error ? err.message : "upstream_error";
    return {
      result: {
        ok: false,
        error: {
          message: aborted ? "upstream_timeout" : truncateLog(message),
          code: aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_CONNECT",
          retryable: true
        }
      },
      status: null,
      timings: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}

async function logAttempt(
  env: Env,
  requestId: string,
  gatewayKeyId: string | null,
  accountId: string | null,
  attemptNo: number,
  status: number | null,
  error?: string
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO request_attempts (request_id, gateway_key_id, account_id, attempt_no, status_code, error, created_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(requestId, gatewayKeyId, accountId, attemptNo, status, error ? truncateLog(error, ATTEMPT_ERROR_MAX) : null, nowIso())
    .run()
    .catch(() => {});
}

async function logRequest(
  env: Env,
  requestId: string,
  gatewayKeyId: string | null,
  mode: string,
  accountId: string | null,
  path: string,
  status: number,
  ok: boolean,
  durationMs: number,
  bytesIn: number | null,
  bytesOut: number | null,
  costGems: number
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO request_logs (request_id, gateway_key_id, account_id, path, mode, status_code, ok, duration_ms, bytes_in, bytes_out, cost_gems, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(requestId, gatewayKeyId, accountId, path, mode, status, ok ? 1 : 0, durationMs, bytesIn, bytesOut, costGems, nowIso())
    .run()
    .catch(() => {});
}

export async function runPipeline(
  canonical: CanonicalRequest,
  opts: PipelineOptions
): Promise<PipelineResult> {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? UPSTREAM_MAX_BYTES;
  const started = Date.now();
  const gatewayKeyId = opts.gatewayKeyId ?? null;
  const mode = opts.mode ?? "restricted";

  // 改写管线：参数映射 → 提示词改写 → 内容策略 → 请求控制。
  // 规则为 D1 中的声明式 JSON，不执行任意代码；命中 block 直接返回，不请求上游。
  let rewritten = canonical;
  try {
    if (opts.rewrite) {
      rewritten = await opts.rewrite(canonical);
    } else if (!opts.skipRewrite) {
      const rules = opts.rewriteRules ?? (await loadRules(opts.env));
      rewritten = applyRules(canonical, rules);
    }
  } catch (err) {
    if (err instanceof RewriteBlockedError) {
      return {
        ok: false,
        status: err.status,
        error: { message: err.message, code: err.code, status: err.status, retryable: false }
      };
    }
    throw err;
  }

  // TODO: 多上游路由（按 key 的模型权限筛选候选上游，按优先级/权重选择）。
  //       当前仅取 priority 首个启用上游。
  const upstreams = await loadUpstreams(opts.env);
  let ordered = opts.selectUpstreams ? opts.selectUpstreams(upstreams) : upstreams;
  if (opts.allowedUpstreams?.length) {
    const allowed = new Set(opts.allowedUpstreams);
    ordered = ordered.filter((u) => allowed.has(u.id));
  }
  // 显式指定上游（创作台）：仅在启用上游中取该 id；不存在或停用返回 NO_UPSTREAM。
  if (opts.upstreamId) {
    ordered = upstreams.filter((u) => u.id === opts.upstreamId);
  }
  const first = ordered[0];
  if (!first) {
    return { ok: false, error: { message: "no_upstream", code: "NO_UPSTREAM" } };
  }
  const upstream: UpstreamConfig = opts.credential ? { ...first, credential: opts.credential } : first;
  const upstreamRow = await getUpstream(opts.env, upstream.id);
  const strategyFromCaps = parseAccountStrategy(upstreamRow?.capabilities_json ?? null);
  const strategy: AccountStrategy =
    (opts.accountStrategy as AccountStrategy | undefined) ?? strategyFromCaps;
  const adapter = getAdapter(upstream.type);
  const isPool = upstream.type === "nai-compatible";
  const requestId = newId();

  // passthrough：以适配器构造 URL/headers，但 body 用调用方原始字节（不重建）。
  const buildRequest = (token: string): UpstreamRequest => {
    const built = adapter.buildRequest(rewritten, upstream, { token });
    return opts.rawBody !== undefined ? { ...built, body: opts.rawBody as Uint8Array | string } : built;
  };

  const path = upstream.type === "nai-compatible" ? "/v1/nai/generate-image" : "/v1/images/generations";

  if (!isPool) {
    // 单凭据上游：凭据来自 upstreams.auth_enc，或调用方显式注入。
    const secret = opts.credential ?? upstream.credential ?? (await getUpstreamSecret(opts.env, upstream.id)) ?? "";
    const request = buildRequest(secret);
    const { result, status } = await executeAttempt(doFetch, adapter, request, timeoutMs, maxBytes);
    await logAttempt(opts.env, requestId, gatewayKeyId, null, 1, status, result.ok ? undefined : result.error?.message);
    const duration = Date.now() - started;
    await logRequest(opts.env, requestId, gatewayKeyId, mode, null, path, status ?? 502, result.ok, duration, null, outputBytes(result), result.cost_gems ?? 0);
    return { ...result, upstream_id: upstream.id, account_id: null, request_id: requestId, attempts: 1, duration_ms: duration, request };
  }

  if (opts.credential) {
    // 调用方显式注入凭据：不做池选号，但按池语义记录。
    const request = buildRequest(opts.credential);
    const { result, status } = await executeAttempt(doFetch, adapter, request, timeoutMs, maxBytes);
    await logAttempt(opts.env, requestId, gatewayKeyId, null, 1, status, result.ok ? undefined : result.error?.message);
    const duration = Date.now() - started;
    await logRequest(opts.env, requestId, gatewayKeyId, mode, null, path, status ?? 502, result.ok, duration, null, outputBytes(result), result.cost_gems ?? 0);
    return { ...result, upstream_id: upstream.id, account_id: null, request_id: requestId, attempts: 1, duration_ms: duration, request };
  }

  // 选号游标按作用域隔离：网关保持历史行为（缺省 gateway 前缀），创作台用 workspace 前缀。
  // 调用方显式传 cursorKey 时优先级最高。
  const selectionScope = opts.selectionScope ?? "gateway";
  const cursorKey =
    opts.cursorKey ??
    (selectionScope === "workspace" ? `rr_cursor:workspace:${upstream.id}` : `rr_cursor:gateway:${upstream.id}`);
  const selection = await selectAccounts(opts.env, upstream.id, strategy, {
    cursorKey,
    accountId: opts.accountId
  });
  if (!selection.candidates.length) {
    return {
      ok: false,
      error: {
        message: selection.degraded === "cooldown" ? "all_accounts_cooling" : "no_account",
        code: selection.degraded === "cooldown" ? "ALL_ACCOUNTS_COOLING" : "NO_ACCOUNT"
      },
      upstream_id: upstream.id,
      request_id: requestId,
      account_id: null,
      attempts: 0,
      duration_ms: Date.now() - started
    };
  }

  const attemptsDetail: PipelineAttempt[] = [];
  let attemptNo = 0;
  let lastMessage = "";
  const accountLimit = await getAccountLimit(opts.env, upstream.id);

  for (const candidate of selection.candidates) {
    let token = candidate.token;
    let retried401 = false;

    for (let round = 0; ; round += 1) {
      attemptNo += 1;
      const call: UpstreamCall = {
        request: buildRequest(token),
        adapter
      };

      const executed = await executeAttempt(doFetch, call.adapter, call.request, timeoutMs, maxBytes);
      const result = executed.result;
      const status = executed.status;

      const success = result.ok;
      attemptsDetail.push({
        account_id: candidate.account.id,
        attempt_no: attemptNo,
        status_code: status,
        error: success ? undefined : result.error?.message
      });
      await logAttempt(opts.env, requestId, gatewayKeyId, candidate.account.id, attemptNo, status, success ? undefined : result.error?.message);

      if (success) {
        await markAccountSuccess(opts.env, candidate.account.id).catch(() => {});
        await addAccountImages(opts.env, candidate.account.id, result.images?.length ?? 0, accountLimit).catch(() => {});
        const duration = Date.now() - started;
        await logRequest(opts.env, requestId, gatewayKeyId, mode, candidate.account.id, path, status ?? 200, true, duration, null, outputBytes(result), result.cost_gems ?? 0);
        return {
          ...result,
          upstream_id: upstream.id,
          account_id: candidate.account.id,
          request_id: requestId,
          attempts: attemptNo,
          attempts_detail: attemptsDetail,
          duration_ms: duration,
          request: call.request
        };
      }

      const errorStatus = result.error?.status ?? status ?? null;
      const retryable = result.error?.retryable ?? (errorStatus != null && isCooldownTrigger(errorStatus));

      // 401：仅用托管密码重登（refreshJwt），成功后用原 api_token 对该账号重试一次。
      // 重登前不计失败，确认放弃（重登失败或重登后仍失败）才计一次。
      if (errorStatus === 401 && !retried401) {
        retried401 = true;
        const fresh = await refreshJwt(opts.env, candidate.account, doFetch).catch(() => null);
        if (fresh) continue;
      }

      const failureStatus =
        errorStatus ??
        (result.error?.code === "UPSTREAM_TIMEOUT"
          ? 504
          : result.error?.code === "UPSTREAM_CONNECT"
            ? 502
            : null);
      if (failureStatus != null) {
        await markAccountFailure(opts.env, candidate.account.id, failureStatus, upstream.id).catch(() => {});
      }

      if (retryable) {
        lastMessage = result.error?.message ?? "upstream_error";
        break;
      }

      // 非转移错误（参数错误等 4xx）：不换号，立即返回。
      const duration = Date.now() - started;
      await logRequest(opts.env, requestId, gatewayKeyId, mode, candidate.account.id, path, errorStatus ?? 400, false, duration, null, null, 0);
      return {
        ...result,
        upstream_id: upstream.id,
        account_id: candidate.account.id,
        request_id: requestId,
        attempts: attemptNo,
        attempts_detail: attemptsDetail,
        duration_ms: duration,
        request: call.request
      };
    }
  }

  const duration = Date.now() - started;
  await logRequest(opts.env, requestId, gatewayKeyId, mode, null, path, 502, false, duration, null, null, 0);
  return {
    ok: false,
    status: 502,
    error: {
      message: truncateLog(lastMessage || "all_accounts_failed"),
      code: "ALL_ACCOUNTS_FAILED",
      status: 502,
      retryable: false
    },
    upstream_id: upstream.id,
    account_id: null,
    request_id: requestId,
    attempts: attemptNo,
    attempts_detail: attemptsDetail,
    duration_ms: duration
  };
}
