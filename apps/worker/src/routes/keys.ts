import { Hono } from "hono";
import {
  createApiKey,
  deleteApiKey,
  listApiKeys,
  type ApiKeyInput
} from "../db/apiKeys";
import { readJson } from "../lib/json";
import { requireOwner } from "./guard";
import type { AppEnv } from "../types";

export const keys = new Hono<AppEnv>();

keys.use("*", requireOwner);

keys.get("/", async (c) => c.json({ items: await listApiKeys(c.env) }));

keys.post("/", async (c) => {
  const input = await readJson<ApiKeyInput>(c);
  const created = await createApiKey(c.env, input);
  return c.json({ ...created.record, key: created.key }, 201);
});

keys.delete("/:id", async (c) => {
  await deleteApiKey(c.env, c.req.param("id"));
  return c.json({ ok: true });
});
