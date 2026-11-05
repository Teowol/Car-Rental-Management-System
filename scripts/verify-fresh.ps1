param([int]$ClientPort = 5183, [int]$ServerPort = 3013, [int]$DbPort = 3317)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskProjectName = 'smartrent-check-' + [Guid]::NewGuid().ToString('N').Substring(0,12)
$taskEnvFile = Join-Path ([IO.Path]::GetTempPath()) ($taskProjectName + '.env')
$taskComposeFile = Join-Path $taskRoot 'compose.yaml'
$taskOutput = Join-Path $taskRoot ('client/test-results/' + $taskProjectName)
$taskValues = @{
  CLIENT_PORT = "$ClientPort"; SERVER_PORT = "$ServerPort"; DB_PORT = "$DbPort"
  DB_NAME = 'smartrent'; DB_USER = 'smartrent'
  DB_PASSWORD = [Guid]::NewGuid().ToString('N'); DB_ROOT_PASSWORD = [Guid]::NewGuid().ToString('N')
  DEMO_PASSWORD = [Guid]::NewGuid().ToString('N')
  DEMO_CUSTOMER_EMAIL = 'demo.customer@example.test'; DEMO_ADMIN_EMAIL = 'demo.admin@example.test'
  DEMO_BASE_URL = "http://localhost:$ClientPort"; DEMO_OUTPUT_DIR = $taskOutput
}
$taskPrevious = @{}
$taskStarted = $false
$taskSucceeded = $false
$taskCleanupFailed = $false
function Invoke-FreshCompose([string[]]$ComposeArguments) {
  & docker compose --project-name $taskProjectName --env-file $taskEnvFile -f $taskComposeFile @ComposeArguments
  if ($LASTEXITCODE -ne 0) { throw "Fresh Compose step failed: $($ComposeArguments[0])" }
}
try {
  foreach ($key in $taskValues.Keys) {
    $taskPrevious[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $taskValues[$key], 'Process')
  }
  $taskEnvText = ($taskValues.Keys | Where-Object { $_ -notlike 'DEMO_*' } | ForEach-Object { "$_=$($taskValues[$_])" }) -join "`n"
  [IO.File]::WriteAllText($taskEnvFile, $taskEnvText, [Text.UTF8Encoding]::new($false))
  Invoke-FreshCompose @('config', '--quiet')
  $taskStarted = $true
  Invoke-FreshCompose @('up', '--build', '-d', '--wait')
  Invoke-FreshCompose @('exec', '-T', 'server', 'npm', 'run', 'db:seed')
  Invoke-FreshCompose @('exec', '-T', '-e', 'DEMO_PASSWORD', '-e', 'DEMO_CUSTOMER_EMAIL', '-e', 'DEMO_ADMIN_EMAIL', 'server', 'npm', 'run', 'db:seed-demo')
  & node (Join-Path $taskRoot 'client/scripts/demo-acceptance.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Fresh browser demo failed' }
  # Recreate only this generated stack, retaining its volume to prove persistence.
  Invoke-FreshCompose @('down')
  Invoke-FreshCompose @('up', '-d', '--wait')
  Invoke-FreshCompose @('exec', '-T', '-e', 'DEMO_PASSWORD', '-e', 'DEMO_CUSTOMER_EMAIL', '-e', 'DEMO_ADMIN_EMAIL', 'server', 'npm', 'run', 'db:seed-demo')
  & node (Join-Path $taskRoot 'client/scripts/demo-acceptance.mjs') --persistence
  if ($LASTEXITCODE -ne 0) { throw 'Fresh restart persistence check failed' }
  $taskSucceeded = $true
  Write-Output "Fresh installation and persistence verified. Screenshots: $taskOutput"
} finally {
  # The name is generated here; this must never target the user's smartrent project.
  if ($taskStarted -and $taskProjectName -match '^smartrent-check-[a-f0-9]{12}$') {
    & docker compose --project-name $taskProjectName --env-file $taskEnvFile -f $taskComposeFile down --volumes --remove-orphans
    if ($LASTEXITCODE -ne 0) { $taskCleanupFailed = $true; Write-Warning "Could not clean isolated project $taskProjectName" }
  }
  if (Test-Path -LiteralPath $taskEnvFile) { Remove-Item -LiteralPath $taskEnvFile }
  foreach ($key in $taskPrevious.Keys) { [Environment]::SetEnvironmentVariable($key, $taskPrevious[$key], 'Process') }
  if ($taskCleanupFailed -and $taskSucceeded) { throw "Checks passed but isolated project cleanup failed: $taskProjectName" }
}
