<#
    deploy.ps1 - build one commit and make it live. Called by tick.ps1 after it
    has checked out the commit in <Root>\repo; can also be run by hand:

        powershell -File C:\Users\ethan\strhistory\repo\deploy\server\deploy.ps1 -Sha (git rev-parse HEAD)

    Steps: install dependencies (only when package-lock.json changed) ->
    content check -> build -> copy dist\ to releases\<sha> -> sync the Caddy
    site block -> switch the `current` junction -> verify -> prune old releases.

    The live site only changes at the junction switch, so a failure at any
    earlier step leaves the previous release serving.
#>
[CmdletBinding()]
param(
    [string]$Root = 'C:\Users\ethan\strhistory',
    [Parameter(Mandatory = $true)][string]$Sha
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'common.ps1')

$paths = Get-Paths $Root
$config = Read-ServerConfig $paths
$short = $Sha.Substring(0, 7)
$started = Get-Date

function Step([string]$Message) { Write-Log $paths "deploy $short" $Message }
function Fail([string]$Message) {
    Step "FAILED: $Message"
    Save-State $paths @{ status = 'failed'; error = $Message; finishedAt = (Get-Date).ToString('o') }
    exit 1
}
function Run([string]$Label, [scriptblock]$Command) {
    Step $Label
    $output = & $Command 2>&1
    $code = $LASTEXITCODE
    # Keep the log readable: indent output and drop blank lines.
    $output | ForEach-Object { "$_" } | Where-Object { $_.Trim() } | ForEach-Object { Add-Content $paths.Log "    $_" -Encoding UTF8 }
    if ($code -ne 0) { Fail "$Label (exit code $code)" }
}

# Environment for Node tooling running as SYSTEM.
$nodeDir = Split-Path $config.node
$env:Path = "$nodeDir;$(Split-Path $config.git);$env:Path"
$env:npm_config_cache = Join-Path $Root '.npm-cache'
$env:npm_config_update_notifier = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_audit = 'false'
$env:ASTRO_TELEMETRY_DISABLED = '1'
$env:CI = 'true'
$env:NO_COLOR = '1'
$env:FORCE_COLOR = '0'
$env:GIT_SHA = $Sha
$npm = Join-Path $nodeDir 'npm.cmd'

Push-Location $paths.Repo
try {
    # 1. Dependencies - `npm ci` is slow on Windows, so skip it when the lockfile is unchanged.
    $lockHash = (Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash
    $stamp = 'node_modules\.deploy-lockfile-hash'
    if ((Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $lockHash)) {
        Step 'dependencies unchanged'
    } else {
        Run 'npm ci' { & $npm ci --no-audit --no-fund }
        Set-Content $stamp $lockHash
    }

    # 2. Content check and build.
    Run 'content check' { & $npm run --silent check:content }
    Run 'build' { & $npm run --silent build }

    $dist = Join-Path $paths.Repo 'dist'
    $built = Get-Content (Join-Path $dist 'version.json') -Raw | ConvertFrom-Json
    if ($built.commit -ne $Sha) { Fail "dist\version.json reports $($built.commit), expected $Sha" }

    # 3. Copy the build into its own release folder.
    New-Item -ItemType Directory -Force -Path $paths.Releases | Out-Null
    $release = Join-Path $paths.Releases $Sha
    robocopy $dist $release /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "robocopy failed ($LASTEXITCODE)" }
    Step "release copied to releases\$short"

    # 4. Caddy site block: apply repo changes only if Caddy accepts them.
    $candidate = Join-Path $paths.Repo 'deploy\Caddyfile'
    $caddyError = $null
    $changed = (-not (Test-Path $paths.SiteCaddy)) -or ((Get-FileHash $candidate).Hash -ne (Get-FileHash $paths.SiteCaddy).Hash)
    $imported = Confirm-CaddyImport $config $paths
    if ($changed -or $imported) {
        $backup = "$($paths.SiteCaddy).previous"
        if (Test-Path $paths.SiteCaddy) { Copy-Item $paths.SiteCaddy $backup -Force }
        Copy-Item $candidate $paths.SiteCaddy -Force
        $caddyError = Update-Caddy $config
        if ($caddyError) {
            Step "Caddy rejected deploy\Caddyfile - keeping the previous site config. $caddyError"
            if (Test-Path $backup) {
                Copy-Item $backup $paths.SiteCaddy -Force
                Update-Caddy $config | Out-Null
            }
        } else {
            Step 'Caddy config updated and reloaded'
        }
    }

    # 5. Go live.
    $previous = Get-CurrentRelease $paths
    Set-CurrentRelease $paths $release
    Step "live: current -> releases\$short"

    # 6. Verify what is actually being served.
    $served = Get-Content (Join-Path $paths.Current 'version.json') -Raw | ConvertFrom-Json
    if ($served.commit -ne $Sha) {
        if ($previous) { Set-CurrentRelease $paths $previous }
        Fail "current\version.json reports $($served.commit) - rolled back"
    }
    $https = 'not checked'
    try {
        # Ask Caddy directly (bypassing DNS) whether the new build is served.
        $json = & curl.exe -s --max-time 10 --resolve "$($script:Domain):443:127.0.0.1" "https://$($script:Domain)/version.json" 2>$null
        if ($LASTEXITCODE -eq 0 -and $json) {
            $https = if ((($json | Out-String) | ConvertFrom-Json).commit -eq $Sha) { 'ok' } else { 'stale' }
        } else {
            $https = 'unreachable (certificate not issued yet? check DNS)'
        }
    } catch { $https = "error: $($_.Exception.Message)" }
    Step "https check: $https"

    # 7. Keep the newest releases (and whatever is live).
    Get-ChildItem $paths.Releases -Directory |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $script:KeepReleases |
        Where-Object { $_.FullName -ne $release } |
        ForEach-Object { Remove-Item $_.FullName -Recurse -Force; Step "pruned releases\$($_.Name.Substring(0, 7))" }

    $seconds = [int]((Get-Date) - $started).TotalSeconds
    Save-State $paths @{
        status     = 'ok'
        deployed   = $Sha
        deployedAt = (Get-Date).ToString('o')
        finishedAt = (Get-Date).ToString('o')
        error      = $caddyError
        https      = $https
        seconds    = $seconds
    }
    Step "done in ${seconds}s"
}
finally {
    Pop-Location
}
