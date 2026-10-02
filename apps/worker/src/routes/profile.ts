import { Hono, type Context } from "hono";
import { getProfile, updateProfile, type ProfilePatch } from "../db/profile";
import { readJson } from "../lib/json";
import { requireOwner, requireOrigin } from "./guard";
import type { AppEnv } from "../types";

export const profile = new Hono<AppEnv>();

profile.use("*", requireOwner);

const AVATAR_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const NICKNAME_MAX = 40;

interface SiteCounts {
  accounts: number;
  upstreams: number;
  api_keys: number;
  generations: number;
  logs: number;
}

async function count(env: AppEnv["Bindings"], table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
  return row?.c ?? 0;
}

async function siteCounts(env: AppEnv["Bindings"]): Promise<SiteCounts> {
  const [accounts, upstreams, apiKeys, generations, logs] = await Promise.all([
    count(env, "accounts"),
    count(env, "upstreams"),
    count(env, "api_keys"),
    count(env, "generations"),
    count(env, "request_logs")
  ]);
  return { accounts, upstreams, api_keys: apiKeys, generations, logs };
}

async function profileResponse(c: Context<AppEnv>) {
  const stored = await getProfile(c.env);
  const counts = await siteCounts(c.env);
  return {
    ...stored,
    identity: { role: c.get("role") ?? "owner" },
    site: {
      version: c.env.APP_VERSION ?? "unknown",
      environment: c.env.APP_ENV ?? "production",
      domain: c.req.header("host") ?? null,
      counts
    }
  };
}

profile.get("/", async (c) => c.json(await profileResponse(c)));

profile.patch("/", requireOrigin, async (c) => {
  const body = await readJson<ProfilePatch>(c);
  const patch: ProfilePatch = {};

  if (body.nickname !== undefined) {
    if (typeof body.nickname !== "string") {
      return c.json({ error: "invalid_nickname", message: "昵称格式不正确" }, 400);
    }
    const nickname = body.nickname.trim();
    if (nickname.length > NICKNAME_MAX) {
      return c.json({ error: "invalid_nickname", message: "昵称过长" }, 400);
    }
    patch.nickname = nickname;
  }

  if (body.avatar_color !== undefined) {
    if (typeof body.avatar_color !== "string" || !AVATAR_COLOR_RE.test(body.avatar_color)) {
      return c.json({ error: "invalid_avatar_color", message: "头像颜色须为 #RRGGBB" }, 400);
    }
    patch.avatar_color = body.avatar_color.toLowerCase();
  }

  if (body.preferences !== undefined) {
    if (
      typeof body.preferences !== "object" ||
      body.preferences === null ||
      Array.isArray(body.preferences)
    ) {
      return c.json({ error: "invalid_preferences", message: "偏好格式不正确" }, 400);
    }
    patch.preferences = body.preferences as Record<string, unknown>;
  }

  await updateProfile(c.env, patch);
  return c.json(await profileResponse(c));
});
