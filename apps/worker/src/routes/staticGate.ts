import type { Context } from "hono";
import type { AppEnv } from "../types";

const ASSET_RE = /\.[a-zA-Z0-9]+$/;
const API_PREFIXES = ["/api/", "/v1/"];

function isApiPath(path: string): boolean {
  return path === "/generate" || API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isAssetPath(path: string): boolean {
  return path.startsWith("/assets/") || ASSET_RE.test(path);
}

export async function staticGate(c: Context<AppEnv>): Promise<Response> {
  const request = c.req.raw;
  const { pathname } = new URL(request.url);
  const assets = c.env.ASSETS;
  if (!assets) return c.json({ error: "not_found" }, 404);

  if (isApiPath(pathname)) return c.json({ error: "not_found" }, 404);
  if (isAssetPath(pathname)) return assets.fetch(request);

  const role = c.get("role");
  const accept = request.headers.get("Accept") ?? "";
  const wantsHtml = accept.includes("text/html") || accept === "" || accept === "*/*";

  if (!role && wantsHtml && pathname !== "/login") return c.redirect("/login", 302);

  const indexUrl = new URL("/index.html", request.url);
  return assets.fetch(new Request(indexUrl, { method: "GET", headers: request.headers }));
}
