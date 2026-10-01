import { Hono } from "hono";
import { auth, sessionMiddleware } from "./routes/auth";
import { upstreams, models } from "./routes/upstreams";
import { keys } from "./routes/keys";
import { accounts } from "./routes/accounts";
import { generate } from "./routes/generate";
import { gallery } from "./routes/gallery";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", sessionMiddleware);

app.route("/api/auth", auth);
app.route("/api/upstreams", upstreams);
app.route("/api/models", models);
app.route("/api/keys", keys);
app.route("/api/accounts", accounts);
app.route("/api/generate", generate);
app.route("/api/gallery", gallery);

app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.APP_ENV ?? "production" })
);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
