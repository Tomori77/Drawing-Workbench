# 通过本地代理 7893 运行 git（GitHub 直连被重置，必须走代理）。
# 用法： .\scripts\git-noproxy.ps1 push origin main
#        .\scripts\git-noproxy.ps1 fetch origin
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)

$proxy = if ($env:DWB_PROXY) { $env:DWB_PROXY } else { "http://127.0.0.1:7893" }
$env:HTTP_PROXY = $proxy
$env:HTTPS_PROXY = $proxy
$env:ALL_PROXY = $proxy
$env:http_proxy = $proxy
$env:https_proxy = $proxy
$env:all_proxy = $proxy
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:no_proxy = $env:NO_PROXY

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  & git @Args
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
