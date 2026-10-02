import { Hono } from "hono";
import { auth, sessionMiddleware } from "./routes/auth";
import { upstreams, models } from "./routes/upstreams";
import { keys } from "./routes/keys";
import { accounts } from "./routes/accounts";
import { checkin } from "./routes/checkin";
import { rewriteRules } from "./routes/rewriteRules";
import { generate } from "./routes/generate";
import { generateOptions } from "./routes/generateOptions";
import { gallery } from "./routes/gallery";
import { sharePasswords } from "./routes/sharePasswords";
import { logs } from "./routes/logs";
import { profile } from "./routes/profile";
import { gatewayV1, gatewayGenerateRoute } from "./routes/gateway";
import { staticGate } from "./routes/staticGate";
import { runScheduled } from "./checkin/run";
import type { AppEnv, Env } from "./types";

const app = new Hono<AppEnv>();

app.use("*", sessionMiddleware);

app.route("/api/auth", auth);
app.route("/api/upstreams", upstreams);
app.route("/api/models", models);
app.route("/api/keys", keys);
app.route("/api/accounts", accounts);
app.route("/api/checkin", checkin);
app.route("/api/rewrite-rules", rewriteRules);
app.route("/api/generate/options", generateOptions);
app.route("/api/generate", generate);
app.route("/api/gallery", gallery);
app.route("/api/share-passwords", sharePasswords);
app.route("/api/logs", logs);
app.route("/api/profile", profile);

app.route("/v1", gatewayV1);
app.route("/generate", gatewayGenerateRoute);

app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.APP_ENV ?? "production" })
);

app.get("*", staticGate);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export async function scheduled(
  _event: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  try {
    ctx.waitUntil(
      runScheduled(env).catch((err) => {
        console.error("[scheduled] runScheduled failed", err);
      })
    );
  } catch (err) {
    console.error("[scheduled] scheduling failed", err);
  }
}

export default {
  fetch: app.fetch,
  scheduled
} satisfies ExportedHandler<Env>;
