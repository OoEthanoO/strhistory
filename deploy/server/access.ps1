<# Install/update the loopback access service after provisioning private\access.json.
   This script is idempotent and called by every deploy before changing Caddy.
   Run with Windows PowerShell 5.1 and -ExecutionPolicy Bypass.
#>
[CmdletBinding()]
param([string]$Root = 'C:\Users\ethan\strhistory')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$privateConfig = Join-Path $Root 'private\access.json'
if (-not (Test-Path -LiteralPath $privateConfig)) {
    throw 'Missing private\access.json. Provision the access code before deploying.'
}
$settings = Get-Content (Join-Path $Root 'server.json') -Raw | ConvertFrom-Json
$source = Join-Path $PSScriptRoot '..\access\server.mjs'
$destination = Join-Path $Root 'bin\access\server.mjs'
$taskName = 'strhistory-access'
New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
$changed = -not (Test-Path -LiteralPath $destination)
if (-not $changed) { $changed = (Get-FileHash $source).Hash -ne (Get-FileHash $destination).Hash }
# The public origin follows the deployment domain. Preserve the existing code
# hash and signing key; migrating a domain must not rotate credentials.
$accessConfig = Get-Content -LiteralPath $privateConfig -Raw | ConvertFrom-Json
$expectedOrigin = "https://$($script:Domain)"
$originChanged = $accessConfig.origin -ne $expectedOrigin
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (($changed -or $originChanged) -and $task) {
    Stop-ScheduledTask -TaskName $taskName
    # The task runs Node directly: stopping it closes only this service.
    for ($i = 0; $i -lt 20; $i++) {
        if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { break }
        Start-Sleep -Milliseconds 250
    }
}
if ($changed) { Copy-Item -LiteralPath $source -Destination $destination -Force }
if ($originChanged) {
    $accessConfig.origin = $expectedOrigin
    # Write in place so the restricted ACL on the existing file is retained.
    [IO.File]::WriteAllText($privateConfig, ($accessConfig | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    Write-Host "Access origin updated to $expectedOrigin"
}
if (-not $task) {
    $action = New-ScheduledTaskAction -Execute $settings.node -Argument "`"$destination`" `"$privateConfig`"" -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $options = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $options -Description 'Checks STR History access codes and signed sessions on loopback port 4310.' | Out-Null
}
if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { Start-ScheduledTask -TaskName $taskName }
for ($i = 0; $i -lt 20; $i++) {
    try {
        $health = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4310/health' -TimeoutSec 2
        if ($health.StatusCode -eq 200 -and $health.Content -eq 'ok') {
            Write-Host 'Access service ready on loopback:4310'
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}
throw 'Access service failed its health check; refusing to deploy.'
