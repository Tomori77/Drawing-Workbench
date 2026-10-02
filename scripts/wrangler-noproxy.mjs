import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "worker");
const args = process.argv.slice(2);

// 上传 Cloudflare 统一走本地代理 7893（优先端口）；localhost 不走代理。
const PROXY = process.env.DWB_PROXY || "http://127.0.0.1:7893";
const env = { ...process.env };
env.HTTP_PROXY = PROXY;
env.HTTPS_PROXY = PROXY;
env.ALL_PROXY = PROXY;
env.http_proxy = PROXY;
env.https_proxy = PROXY;
env.all_proxy = PROXY;
const bypass = "localhost,127.0.0.1,::1";
env.NO_PROXY = bypass;
env.no_proxy = bypass;

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["exec", "wrangler", ...args], {
  stdio: "inherit",
  cwd: workerDir,
  env,
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);
