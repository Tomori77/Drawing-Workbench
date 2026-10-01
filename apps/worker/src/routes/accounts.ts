import { Hono } from "hono";
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccountsPublic,
  presentAccount,
  toAccountPublic,
  updateAccount
} from "../db/accounts";
import { getUpstream } from "../db/upstreams";
import { loginUpstreamAccount, UpstreamHttpError } from "../pool/login";
import { provisionToken } from "../pool/provision";
import { refreshAccountGems, refreshAllGems } from "../pool/balance";
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
    await provisionToken(c.env, row);
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
  // TODO: 手动签到（调上游签到接口）由自动签到步骤实现；此处仅占位。
  return c.json({ ok: false, todo: "manual_checkin_not_implemented", account: toAccountPublic(row) }, 501);
});
