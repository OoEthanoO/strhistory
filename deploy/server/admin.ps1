<# Install the separate teacher editor. Private config and repository-scoped
   write deploy key must be provisioned first (AGENTS.md). PowerShell 5.1.
#>
[CmdletBinding()]
param([string]$Root = 'C:\Users\ethan\strhistory')
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $Root 'private\admin.json'
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Provision private\admin.json before enabling the teacher editor.' }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$source = Join-Path $PSScriptRoot '..\admin'
$destination = Join-Path $Root 'bin\admin'
$taskName = 'strhistory-admin'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$files = Get-ChildItem -LiteralPath $source -Filter '*.mjs' | Where-Object { $_.Name -notmatch '\.test\.mjs$|configure\.mjs$' }
$changed = $false
foreach ($file in $files) {
    $target = Join-Path $destination $file.Name
    if (-not (Test-Path -LiteralPath $target)) { $changed = $true }
    elseif ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $target).Hash) { $changed = $true }
}
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($changed -and $task -and $task.State -eq 'Running') {
    # Drain new requests and let any in-progress publish finish before restart.
    $idle = $false
    for ($i = 0; $i -lt 120; $i++) {
        try {
            $state = Invoke-RestMethod -Uri 'http://127.0.0.1:4311/drain' -Method Post -TimeoutSec 3
            if (-not $state.busy) { $idle = $true; break }
        } catch { $idle = $true; break }
        Start-Sleep -Seconds 5
    }
    if (-not $idle) { throw 'Teacher editor is still publishing; retry deployment later.' }
    Stop-ScheduledTask -TaskName $taskName
    for ($i = 0; $i -lt 20; $i++) {
        if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { break }
        Start-Sleep -Milliseconds 250
    }
}
if ($changed) { foreach ($file in $files) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $destination $file.Name) -Force } }
if (-not (Test-Path -LiteralPath (Join-Path $config.repo '.teacher-authoring'))) { throw 'Set up the dedicated authoring checkout before installing the editor.' }
if (-not $task) {
    $server = Join-Path $destination 'server.mjs'
    $action = New-ScheduledTaskAction -Execute $config.node -Argument "`"$server`" `"$configPath`"" -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Private teacher editing API on loopback port 4311.' | Out-Null
}
if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { Start-ScheduledTask -TaskName $taskName }
for ($i = 0; $i -lt 30; $i++) {
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4311/health' -TimeoutSec 2; if ($health.ok) { Write-Host 'Teacher editor ready on loopback:4311'; exit 0 } } catch { }
    Start-Sleep -Milliseconds 500
}
throw 'Teacher editor failed its health check.'
