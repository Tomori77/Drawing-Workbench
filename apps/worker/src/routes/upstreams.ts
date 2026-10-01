import { Hono } from "hono";
import {
  createUpstream,
  deleteUpstream,
  getUpstream,
  listModels,
  listUpstreams,
  toUpstreamPublic,
  updateUpstream,
  type UpstreamInput
} from "../db/upstreams";
import { readJson } from "../lib/json";
import { requireOwner } from "./guard";
import type { AppEnv } from "../types";

export const upstreams = new Hono<AppEnv>();

upstreams.use("*", requireOwner);

upstreams.get("/", async (c) => c.json({ items: await listUpstreams(c.env) }));

upstreams.post("/", async (c) => {
  const input = await readJson<UpstreamInput>(c);
  const row = await createUpstream(c.env, input);
  return c.json(toUpstreamPublic(row), 201);
});

upstreams.get("/:id", async (c) => {
  const row = await getUpstream(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(toUpstreamPublic(row));
});

upstreams.patch("/:id", async (c) => {
  const patch = await readJson<UpstreamInput>(c);
  const row = await updateUpstream(c.env, c.req.param("id"), patch);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(toUpstreamPublic(row));
});

upstreams.delete("/:id", async (c) => {
  await deleteUpstream(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

export const models = new Hono<AppEnv>();

models.use("*", requireOwner);

models.get("/", async (c) => c.json({ items: await listModels(c.env) }));
