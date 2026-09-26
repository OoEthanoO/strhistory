<#
    tick.ps1 - the "redeploy on every commit" poller.

    Runs every minute as SYSTEM from the scheduled task "strhistory-deploy".
    If origin/main has a commit that has not been deployed yet, it resets the
    deploy checkout to that commit and runs the commit's own
    deploy\server\deploy.ps1.

    install.ps1 copies this file to <Root>\bin\tick.ps1. It is deliberately
    self-contained and not updated by deploys: if a commit breaks deploy.ps1,
    this poller still picks up the commit that fixes it. After changing this
    file, re-run install.ps1 on the server.

        powershell -ExecutionPolicy Bypass -File C:\Users\ethan\strhistory\bin\tick.ps1            # normal run
        powershell -ExecutionPolicy Bypass -File C:\Users\ethan\strhistory\bin\tick.ps1 -Force     # redeploy even if up to date
#>
[CmdletBinding()]
param(
    [string]$Root = 'C:\Users\ethan\strhistory',
    [switch]$Force
)

# Continue, not Stop: git and npm write progress to stderr, which Windows
# PowerShell 5.1 would turn into terminating errors. Failures are checked
# explicitly through $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$Repo = Join-Path $Root 'repo'
$Logs = Join-Path $Root 'logs'
$Log = Join-Path $Logs 'deploy.log'
$StateFile = Join-Path $Root 'state.json'
$LockFile = Join-Path $Root 'deploy.lock'
$MaxAttempts = 3

New-Item -ItemType Directory -Force -Path $Logs | Out-Null
if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 5MB) { Move-Item $Log "$Log.1" -Force }

function Log([string]$Message) {
    $line = '{0:yyyy-MM-dd HH:mm:ss} [tick] {1}' -f (Get-Date), $Message
    Add-Content -Path $Log -Value $line -Encoding UTF8
    Write-Host $line
}

# Run a repo script in a child PowerShell. The child writes its own progress
# to the log; its console output is only kept (appended as UTF-8) when it
# fails, to capture errors it could not log itself. (Redirecting with *>> would
# lock the log file and, in PowerShell 5.1, write UTF-16.)
function Invoke-RepoScript([string]$Script, [string[]]$Arguments) {
    $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Script @Arguments 2>&1 | Out-String
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Log "$(Split-Path $Script -Leaf) exited with code $code; its output follows"
        $output -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object { Add-Content -Path $Log -Value "    | $_" -Encoding UTF8 }
    }
    return $code
}

# One run at a time (the task is also set to ignore overlapping starts).
try { $lock = [IO.File]::Open($LockFile, 'OpenOrCreate', 'ReadWrite', 'None') } catch { exit 0 }

try {
    $serverJson = Join-Path $Root 'server.json'
    if (-not (Test-Path $serverJson)) { Log "missing $serverJson - run deploy\server\install.ps1"; exit 1 }
    $config = Get-Content $serverJson -Raw | ConvertFrom-Json
    $safe = ($Repo -replace '\\', '/')
    function Git { & $config.git -c "safe.directory=$safe" -C $Repo @args }

    # Self-heal: if the main Caddyfile was regenerated without our import
    # block, put it back (the helper lives in the repo; failures are logged).
    $main = Get-Content $config.mainCaddyfile -Raw -ErrorAction SilentlyContinue
    if ($main -and $main -notmatch [regex]::Escape('# BEGIN strhistory (managed)')) {
        Log 'main Caddyfile lost the strhistory import block - restoring it'
        Invoke-RepoScript (Join-Path $Repo 'deploy\server\caddy.ps1') @('-Root', $Root) | Out-Null
    }

    Git fetch --quiet origin $config.branch 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Log 'git fetch failed (offline?) - will retry next minute'; exit 1 }
    $target = (Git rev-parse "origin/$($config.branch)" | Out-String).Trim()

    $state = $null
    if (Test-Path $StateFile) { try { $state = Get-Content $StateFile -Raw | ConvertFrom-Json } catch { } }
    $attempts = 0
    if ($state -and $state.lastAttempted -eq $target) {
        $attempts = [int]$state.attempts
        if (-not $Force -and ($state.status -eq 'ok' -or $attempts -ge $MaxAttempts)) { exit 0 }
    }

    $short = $target.Substring(0, 7)
    if ($attempts -gt 0) { Log "retrying $short (attempt $($attempts + 1) of $MaxAttempts)" }
    else { Log "new commit $short on $($config.branch) - deploying" }

    # Record the attempt before running anything, so a crash cannot cause a
    # tight retry loop.
    $s = @{}
    if ($state) { foreach ($p in $state.PSObject.Properties) { $s[$p.Name] = $p.Value } }
    $s.lastAttempted = $target
    $s.attempts = $attempts + 1
    $s.status = 'deploying'
    $s.startedAt = (Get-Date).ToString('o')
    [IO.File]::WriteAllText($StateFile, ([pscustomobject]$s | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

    Git reset --hard --quiet $target 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Log 'git reset failed'; exit 1 }
    # Remove build leftovers but keep installed dependencies.
    Git clean -fdx --quiet -e node_modules 2>&1 | Out-Null

    $code = Invoke-RepoScript (Join-Path $Repo 'deploy\server\deploy.ps1') @('-Root', $Root, '-Sha', $target)
    if ($code -ne 0) { Log "deploy of $short failed - see above"; exit 1 }
}
catch {
    Log "tick error: $($_.Exception.Message)"
    exit 1
}
finally {
    $lock.Close()
}
