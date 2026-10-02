import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
  type Role
} from "../lib/session";
import { verifySharePassword } from "../db/sharePasswords";
import type { AppEnv } from "../types";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

// 本地 http 开发时 Secure cookie 不会被回传，按 APP_ENV 降级。
function cookieOptions(env: AppEnv["Bindings"]) {
  return {
    httpOnly: true,
    secure: env.APP_ENV !== "development",
    sameSite: "Lax",
    path: "/"
  } as const;
}

function timingSafeEqual(a: string, b: string): boolean {
  const la = new TextEncoder().encode(a);
  const lb = new TextEncoder().encode(b);
  if (la.length !== lb.length) return false;
  let diff = 0;
  for (let i = 0; i < la.length; i++) diff |= la[i]! ^ lb[i]!;
  return diff === 0;
}

export const auth = new Hono<AppEnv>();

auth.post("/login", async (c) => {
  const body = await c.req
    .json<{ password?: string }>()
    .catch(() => ({} as { password?: string }));
  const password = body.password ?? "";

  const owner = c.env.OWNER_PASSWORD ?? "";

  let role: Role | null = null;
  let sid: string | undefined;
  if (owner && timingSafeEqual(password, owner)) {
    role = "owner";
    sid = "owner";
  } else {
    const share = await verifySharePassword(c.env, password);
    if (share) {
      role = share.role === "owner" ? "owner" : "friend";
      sid = share.id;
    }
  }

  if (!role || !sid) return c.json({ error: "invalid_password" }, 401);

  const now = Math.floor(Date.now() / 1000);
  const token = await signSession(
    { role, sid, iat: now, exp: now + SESSION_TTL_SECONDS },
    c.env.SESSION_SECRET
  );

  setCookie(c, SESSION_COOKIE, token, {
    ...cookieOptions(c.env),
    maxAge: SESSION_TTL_SECONDS
  });
  return c.json({ role, sid });
});

auth.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, cookieOptions(c.env));
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  const role = c.get("role");
  if (!role) return c.json({ error: "unauthorized" }, 401);
  return c.json({ role, sid: c.get("sid") });
});

export async function sessionMiddleware(
  c: import("hono").Context<AppEnv>,
  next: () => Promise<void>
): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const payload = await verifySession(token, c.env.SESSION_SECRET);
    if (payload) {
      c.set("role", payload.role);
      c.set("sid", payload.sid ?? (payload.role === "owner" ? "owner" : undefined));
    }
  }
  await next();
}
