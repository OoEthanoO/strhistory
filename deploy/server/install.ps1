<#
    install.ps1 - one-time (and idempotent) setup of the history site on the
    home server. Run in an elevated PowerShell on the server:

        powershell -ExecutionPolicy Bypass -File install.ps1

    It can be run from a checkout anywhere; with no checkout yet, download this
    file and run it - it clones the repo itself.

    What it does:
      1. finds Caddy (from the running caddy.exe), Node and Git and records
         them in <Root>\server.json
      2. clones the repo into <Root>\repo (or leaves an existing clone alone)
      3. copies tick.ps1 to <Root>\bin (the per-minute deploy poller)
      4. adds an import of <Root>\Caddyfile to the main Caddyfile
      5. registers the scheduled task "strhistory-deploy" (SYSTEM, every minute)
      6. runs the first deploy and reloads Caddy

    Re-run it after changing tick.ps1 or common.ps1's settings.
#>
[CmdletBinding()]
param(
    [string]$Root = 'C:\Users\ethan\strhistory',
    # Override if Caddy is not running while you install.
    [string]$MainCaddyfile,
    [string]$CaddyExe
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run this from an elevated (Administrator) PowerShell.' }

function Step($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }

# ---- 1. locate tools -------------------------------------------------------
Step 'Locating Caddy, Node and Git'
$caddyProc = Get-CimInstance Win32_Process -Filter "Name='caddy.exe'" | Select-Object -First 1
if (-not $MainCaddyfile) {
    if ($caddyProc -and $caddyProc.CommandLine -match '--config\s+"?([^"]+?)"?(\s|$)') { $MainCaddyfile = $Matches[1] }
    else { throw 'Caddy is not running; pass -MainCaddyfile <path to the Caddyfile Caddy runs with>.' }
}
if (-not $CaddyExe) {
    if ($caddyProc -and $caddyProc.ExecutablePath) { $CaddyExe = $caddyProc.ExecutablePath }
    else { $CaddyExe = (Get-Command caddy -ErrorAction Stop).Source }
}
# Prefer the stable WinGet link over a versioned package path.
$wingetLink = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\caddy.exe'
if (($CaddyExe -match 'WinGet\\Packages') -and (Test-Path $wingetLink)) { $CaddyExe = $wingetLink }
$node = (Get-Command node -ErrorAction Stop).Source
$git = (Get-Command git -ErrorAction Stop).Source
if ($git -match '\\mingw64\\bin\\git.exe$') { $git = $git -replace '\\mingw64\\bin\\git.exe$', '\cmd\git.exe' }
Info "caddy:         $CaddyExe"
Info "main Caddyfile: $MainCaddyfile"
Info "node:          $node ($(& $node --version))"
Info "git:           $git"

# ---- 2. layout and clone ---------------------------------------------------
Step "Preparing $Root"
foreach ($d in 'releases', 'logs', 'bin') { New-Item -ItemType Directory -Force -Path (Join-Path $Root $d) | Out-Null }
$repo = Join-Path $Root 'repo'
if (-not (Test-Path (Join-Path $repo '.git'))) {
    Info 'cloning repository'
    & $git clone --quiet https://github.com/OoEthanoO/strhistory.git $repo
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
} else {
    Info 'repository already cloned'
}
$here = if (Test-Path (Join-Path $PSScriptRoot 'common.ps1')) { $PSScriptRoot } else { Join-Path $repo 'deploy\server' }
. (Join-Path $here 'common.ps1')
$paths = Get-Paths $Root

$config = [pscustomobject]@{
    caddy         = $CaddyExe
    mainCaddyfile = $MainCaddyfile
    node          = $node
    git           = $git
    branch        = $script:Branch
    domain        = $script:Domain
}
[IO.File]::WriteAllText($paths.Server, ($config | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Info "wrote $($paths.Server)"

# ---- 3. poller ---------------------------------------------------------------
Step 'Installing the deploy poller'
Copy-Item (Join-Path $here 'tick.ps1') (Join-Path $paths.Bin 'tick.ps1') -Force
Info "copied tick.ps1 to $($paths.Bin)"

# ---- 4. Caddy import ---------------------------------------------------------
Step 'Connecting Caddy'
if (-not (Test-Path $paths.SiteCaddy)) { Copy-Item (Join-Path $repo 'deploy\Caddyfile') $paths.SiteCaddy }
if (Confirm-CaddyImport $config $paths) { Info "added import block to $MainCaddyfile (backup saved next to it)" }
else { Info 'import block already present' }

# ---- 5. scheduled task -------------------------------------------------------
Step "Registering scheduled task '$($script:TaskName)'"
$tick = Join-Path $paths.Bin 'tick.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$tick`" -Root `"$Root`"" `
    -WorkingDirectory $Root
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$boot = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger @($every, $boot) -Principal $principal `
    -Settings $settings -Description 'Deploys the history site (github.com/OoEthanoO/strhistory) when main changes.' -Force | Out-Null
$registered = Get-ScheduledTask -TaskName $script:TaskName
Info "state: $($registered.State); repeats every $($registered.Triggers[0].Repetition.Interval)"

# ---- 6. first deploy ---------------------------------------------------------
Step 'Deploying the current main branch'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tick -Root $Root -Force
$state = Read-State $paths
Info "status: $($state.status); live commit: $($state.deployed)"
if ($state.status -ne 'ok') { Write-Host "    see $($paths.Log)" -ForegroundColor Yellow }

$err = Update-Caddy $config
if ($err) { Write-Host "    $err" -ForegroundColor Yellow } else { Info 'Caddy reloaded' }

Write-Host ''
Write-Host "Installed. Every push to main is live about a minute later: https://$($script:Domain)" -ForegroundColor Green
Write-Host "Status:   powershell -ExecutionPolicy Bypass -File `"$repo\deploy\server\status.ps1`""
