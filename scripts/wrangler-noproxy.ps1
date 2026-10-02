# 在无代理环境下运行 wrangler，避免代理波动导致部署/迁移卡住。
# 用法： .\scripts\wrangler-noproxy.ps1 deploy            （在 apps/worker 运行 wrangler deploy）
#        .\scripts\wrangler-noproxy.ps1 d1 execute drawing-workbench --remote --command "SELECT 1;"
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)

$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""
$env:http_proxy = ""
$env:https_proxy = ""
$env:all_proxy = ""
$env:NO_PROXY = "localhost,127.0.0.1,::1,cloudflare.com,api.cloudflare.com,workers.dev,.workers.dev,github.com,githubusercontent.com"
$env:no_proxy = $env:NO_PROXY

$workerDir = Join-Path $PSScriptRoot "..\apps\worker"
Push-Location $workerDir
try {
  & pnpm exec wrangler @Args
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
