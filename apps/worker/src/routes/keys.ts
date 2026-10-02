import { Hono } from "hono";
import {
  createApiKey,
  deleteApiKey,
  getApiKey,
  listApiKeys,
  toApiKeyPublic,
  updateApiKey,
  type ApiKeyInput
} from "../db/apiKeys";
import { readJson } from "../lib/json";
import { requireOrigin, requireOwner } from "./guard";
import type { AppEnv } from "../types";

export const keys = new Hono<AppEnv>();

keys.use("*", requireOwner);

keys.get("/", async (c) => c.json({ items: await listApiKeys(c.env) }));

keys.get("/:id", async (c) => {
  const row = await getApiKey(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(toApiKeyPublic(row));
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
