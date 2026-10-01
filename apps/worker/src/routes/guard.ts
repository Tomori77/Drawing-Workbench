import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("role")) return c.json({ error: "unauthorized" }, 401);
  await next();
});

export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("role") !== "owner") return c.json({ error: "forbidden" }, 403);
  await next();
});

// 写操作防 CSRF：Origin 缺失放行（兼容 CLI / curl），存在则必须同源。
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export const requireOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (!originAllowed(c.req.raw)) {
    return c.json({ error: "csrf_origin_rejected", message: "跨站请求被拒绝" }, 403);
  }
  await next();
});
