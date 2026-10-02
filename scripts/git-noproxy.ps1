# 在无代理环境下运行 git，避免代理波动导致 push/fetch 卡住或失败。
# 用法： .\scripts\git-noproxy.ps1 push origin main
#        .\scripts\git-noproxy.ps1 fetch origin
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)

$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""
$env:http_proxy = ""
$env:https_proxy = ""
$env:all_proxy = ""
$env:NO_PROXY = "localhost,127.0.0.1,::1,github.com,githubusercontent.com,codeload.github.com"
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
