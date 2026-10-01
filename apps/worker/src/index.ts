import { Hono } from "hono";
import { auth, sessionMiddleware } from "./routes/auth";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", sessionMiddleware);

app.route("/api/auth", auth);

app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.APP_ENV ?? "production" })
);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
