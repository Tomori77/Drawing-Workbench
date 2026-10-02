import { Hono } from "hono";
import {
  createAccount,
  deleteAccount,
  getAccount,
  getAccountSecret,
  listAccounts,
  listAccountsPublic,
  presentAccount,
  updateAccount,
  type AccountRow
} from "../db/accounts";
import { getUpstream } from "../db/upstreams";
import { loginUpstreamAccount, UpstreamHttpError } from "../pool/login";
import { provisionToken } from "../pool/provision";
import { refreshAccountGems, refreshAllGems } from "../pool/balance";
import { performCheckin } from "../checkin/run";
import { readJson } from "../lib/json";
import { truncateLog } from "../lib/log";
import { requireOwner } from "./guard";
import type { AppEnv } from "../types";

export const accounts = new Hono<AppEnv>();

accounts.use("*", requireOwner);

const MAX_BATCH = 30;

interface CreateBody {
  upstream_id?: string;
  username?: string;
  password?: string;
  api_token?: string;
  label?: string;
}

accounts.get("/", async (c) => {
  const upstreamId = c.req.query("upstream_id") || undefined;
  const items = await listAccountsPublic(c.env, upstreamId);
  const total_gems = items.reduce((sum, item) => sum + (item.gems_last ?? 0), 0);
  return c.json({ items, total_gems });
});

accounts.post("/", async (c) => {
  const body = await readJson<CreateBody>(c);
  if (!body.upstream_id || !body.username || !body.password) {
    return c.json({ error: "missing_fields" }, 400);
  }
  const upstream = await getUpstream(c.env, body.upstream_id);
  if (!upstream) return c.json({ error: "upstream_not_found" }, 404);

  const { jwt } = await loginUpstreamAccount(upstream.base_url, body.username, body.password);
  const row = await createAccount(c.env, {
    upstream_id: body.upstream_id,
    username: body.username,
    label: body.label ?? null,
    jwt,
    password: body.password,
    apiToken: body.api_token ?? null
  });

  let accountRow = row;
  let provisionError: string | undefined;
  if (!body.api_token) {
    try {
      // 新账号本来就没有 key，此处语义等同新建；provisionToken 默认复用已有 token。
      await provisionToken(c.env, row, upstream);
      accountRow = (await getAccount(c.env, row.id)) ?? row;
    } catch (err) {
      provisionError =
        err instanceof UpstreamHttpError || err instanceof Error
          ? truncateLog(err.message)
          : "provision_failed";
    }
  }

  const presented = await presentAccount(c.env, accountRow);
  return c.json(provisionError ? { ...presented, provision_error: provisionError } : presented, 201);
});

accounts.post("/batch", async (c) => {
  const body = await readJson<{ upstream_id?: string; items?: Array<{ username?: string; password?: string }> }>(c);
  if (!body.upstream_id || !Array.isArray(body.items)) {
    return c.json({ error: "missing_fields" }, 400);
  }
  const upstream = await getUpstream(c.env, body.upstream_id);
  if (!upstream) return c.json({ error: "upstream_not_found" }, 404);

  const batch = body.items.slice(0, MAX_BATCH);
  const results: Array<{ username: string; ok: boolean; id?: string; error?: string }> = [];
  for (const item of batch) {
    const username = item.username ?? "";
    if (!username || !item.password) {
      results.push({ username, ok: false, error: "missing_fields" });
      continue;
    }
    try {
      const { jwt } = await loginUpstreamAccount(upstream.base_url, username, item.password);
      const row = await createAccount(c.env, {
        upstream_id: body.upstream_id,
        username,
        jwt,
        password: item.password
      });
      results.push({ username, ok: true, id: row.id });
    } catch (err) {
      results.push({ username, ok: false, error: err instanceof Error ? err.message : "unknown" });
    }
  }
  return c.json({ created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, items: results });
});

const MAX_PROVISION_BATCH = 50;

accounts.post("/provision_all", async (c) => {
  const body = await readJson<{ ids?: string[]; upstream_id?: string }>(c);
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string" && id) : null;
  const upstreamId = typeof body.upstream_id === "string" && body.upstream_id ? body.upstream_id : undefined;

  let targets: AccountRow[];
  if (ids && ids.length) {
    const rows = await Promise.all(ids.map((id) => getAccount(c.env, id)));
    targets = rows.filter((row): row is AccountRow => row !== null);
  } else {
    const rows = await listAccounts(c.env, upstreamId);
    targets = rows.filter((row) => row.enabled !== 0);
  }
  targets = targets.slice(0, MAX_PROVISION_BATCH);

  const items: Array<{
    id: string;
    username: string;
    ok: boolean;
    has_api_token: boolean;
    skipped?: boolean;
    error?: string;
  }> = [];
  let success = 0;
  let skipped = 0;

  for (const row of targets) {
    const secret = await getAccountSecret(c.env, row.id);
    // 批量只补缺失 key：已有生图 key 的账号直接复用跳过，不请求上游。
    if (secret?.apiToken) {
      items.push({ id: row.id, username: row.username, ok: true, has_api_token: true, skipped: true });
      skipped += 1;
      continue;
    }
    try {
      await provisionToken(c.env, row);
      items.push({ id: row.id, username: row.username, ok: true, has_api_token: true, skipped: false });
      success += 1;
    } catch (err) {
      const message = err instanceof Error ? truncateLog(err.message) : "provision_failed";
      items.push({
        id: row.id,
        username: row.username,
        ok: false,
        has_api_token: false,
        error: message
      });
    }
  }

  return c.json({ total: targets.length, success, skipped, failed: targets.length - success - skipped, items });
});

accounts.post("/batch_delete", async (c) => {
  const body = await readJson<{ ids?: string[] }>(c);
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (!ids.length) return c.json({ error: "invalid_ids", message: "请选择要删除的账号" }, 400);

  const items: Array<{ id: string; ok: boolean; error?: string }> = [];
  let deleted = 0;
  for (const id of ids) {
    try {
      await deleteAccount(c.env, id);
      items.push({ id, ok: true });
      deleted += 1;
    } catch (err) {
      items.push({ id, ok: false, error: err instanceof Error ? truncateLog(err.message) : "delete_failed" });
    }
  }
  return c.json({ deleted, items });
});

accounts.post("/refresh_gems", async (c) => {
  return c.json(await refreshAllGems(c.env));
});

accounts.get("/:id", async (c) => {
  const row = await getAccount(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(await presentAccount(c.env, row));
});

accounts.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJson<{
    label?: string | null;
    enabled?: boolean;
    api_token?: string | null;
    password?: string;
  }>(c);

  const existing = await getAccount(c.env, id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const patch: Parameters<typeof updateAccount>[2] = {};
  if (body.label !== undefined) patch.label = body.label;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.api_token !== undefined) patch.apiToken = body.api_token;

  if (body.password) {
    const upstream = await getUpstream(c.env, existing.upstream_id);
    if (!upstream) return c.json({ error: "upstream_not_found" }, 404);
    const { jwt } = await loginUpstreamAccount(upstream.base_url, existing.username, body.password);
    patch.password = body.password;
    patch.jwt = jwt;
  }

  const row = await updateAccount(c.env, id, patch);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(await presentAccount(c.env, row));
});

accounts.delete("/:id", async (c) => {
  await deleteAccount(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

accounts.get("/:id/balance", async (c) => {
  const row = await getAccount(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const gems = await refreshAccountGems(c.env, row);
  return c.json({ id: row.id, gems_last: gems });
});

accounts.post("/:id/provision_token", async (c) => {
  const id = c.req.param("id");
  const row = await getAccount(c.env, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  try {
    // 单账号「获取生图 Token」是显式操作：force=true，始终向上游新建。
    await provisionToken(c.env, row, null, fetch, undefined, { force: true });
    return c.json({ ok: true, id: row.id, has_api_token: true });
  } catch (err) {
    const status = err instanceof UpstreamHttpError ? err.status : 502;
    const code = err instanceof UpstreamHttpError ? err.code : "PROVISION_FAILED";
    const message = err instanceof Error ? truncateLog(err.message) : "provision_failed";
    return c.json({ error: code, message }, status as 400);
  }
});

accounts.post("/:id/test", async (c) => {
  const row = await getAccount(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const result = await performCheckin(c.env, row, null, { manual: true });
  return c.json(result, result.ok ? 200 : 502);
});
