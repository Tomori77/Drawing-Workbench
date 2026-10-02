import { Hono } from "hono";
import {
  createApiKey,
  deleteApiKey,
  getApiKey,
  getApiKeyPlaintext,
  listApiKeyRows,
  toApiKeyPublic,
  updateApiKey,
  type ApiKeyInput,
  type ApiKeyPublic,
  type ApiKeyRow
} from "../db/apiKeys";
import { readJson } from "../lib/json";
import { requireOrigin, requireOwner } from "./guard";
import type { AppEnv } from "../types";

export const keys = new Hono<AppEnv>();

keys.use("*", requireOwner);

// 明文仅出现在 owner 接口，且绝不写入日志。
async function withPlaintext(env: AppEnv["Bindings"], row: ApiKeyRow): Promise<ApiKeyPublic> {
  return { ...toApiKeyPublic(row), key: await getApiKeyPlaintext(env, row) };
}

keys.get("/", async (c) => {
  const rows = await listApiKeyRows(c.env);
  const items = await Promise.all(rows.map((row) => withPlaintext(c.env, row)));
  return c.json({ items });
});

keys.get("/:id", async (c) => {
  const row = await getApiKey(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(await withPlaintext(c.env, row));
});

keys.post("/", requireOrigin, async (c) => {
  const input = await readJson<ApiKeyInput>(c);
  const created = await createApiKey(c.env, input);
  return c.json({ ...created.record, key: created.key }, 201);
});

keys.patch("/:id", requireOrigin, async (c) => {
  const patch = await readJson<ApiKeyInput>(c);
  const row = await updateApiKey(c.env, c.req.param("id"), patch);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(toApiKeyPublic(row));
});

keys.delete("/:id", requireOrigin, async (c) => {
  await deleteApiKey(c.env, c.req.param("id"));
  return c.json({ ok: true });
});
