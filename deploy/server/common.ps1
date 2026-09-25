<#
    common.ps1 - shared settings and helpers for the server scripts.
    Dot-source it:  . (Join-Path $PSScriptRoot 'common.ps1')

    Written for Windows PowerShell 5.1 (the server's powershell.exe), so no
    `??`, `?.` or `&&`.
#>

$script:Domain = 'history.ethanyanxu.com'
$script:RepoUrl = 'https://github.com/OoEthanoO/strhistory.git'
$script:Branch = 'main'
$script:TaskName = 'strhistory-deploy'
$script:KeepReleases = 5
$script:ImportBegin = '# BEGIN strhistory (managed)'
$script:ImportEnd = '# END strhistory (managed)'

function Get-Paths([string]$Root) {
    [pscustomobject]@{
        Root      = $Root
        Repo      = Join-Path $Root 'repo'
        Releases  = Join-Path $Root 'releases'
        Current   = Join-Path $Root 'current'
        Logs      = Join-Path $Root 'logs'
        Log       = Join-Path $Root 'logs\deploy.log'
        State     = Join-Path $Root 'state.json'
        Server    = Join-Path $Root 'server.json'
        SiteCaddy = Join-Path $Root 'Caddyfile'
        Bin       = Join-Path $Root 'bin'
    }
}

# server.json is written by install.ps1: where Caddy, Node and Git live and
# which main Caddyfile imports our site block.
function Read-ServerConfig($Paths) {
    if (-not (Test-Path $Paths.Server)) { throw "Missing $($Paths.Server) - run deploy\server\install.ps1 first." }
    Get-Content $Paths.Server -Raw | ConvertFrom-Json
}

function Read-State($Paths) {
    if (Test-Path $Paths.State) {
        try { return Get-Content $Paths.State -Raw | ConvertFrom-Json } catch { }
    }
    [pscustomobject]@{}
}

function Save-State($Paths, [hashtable]$Changes) {
    $state = @{}
    $old = Read-State $Paths
    foreach ($p in $old.PSObject.Properties) { $state[$p.Name] = $p.Value }
    foreach ($k in $Changes.Keys) { $state[$k] = $Changes[$k] }
    $json = [pscustomobject]$state | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($Paths.State, $json, (New-Object Text.UTF8Encoding $false))
}

function Write-Log($Paths, [string]$Tag, [string]$Message) {
    $line = '{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}' -f (Get-Date), $Tag, $Message
    Add-Content -Path $Paths.Log -Value $line -Encoding UTF8
    Write-Host $line
}

function Invoke-Git($Config, $Paths) {
    # The deploy runs as SYSTEM but the checkout belongs to the user account;
    # mark just this checkout as safe instead of changing global git config.
    $safe = ($Paths.Repo -replace '\\', '/')
    & $Config.git -c "safe.directory=$safe" -C $Paths.Repo @args
}

# Make sure the main Caddyfile imports our site block. Returns $true if it
# had to be added (the caller should then reload Caddy).
function Confirm-CaddyImport($Config, $Paths) {
    $main = $Config.mainCaddyfile
    $text = Get-Content $main -Raw
    if ($text -match [regex]::Escape($script:ImportBegin)) { return $false }
    $backup = '{0}.strhistory-backup-{1:yyyyMMddHHmmss}' -f $main, (Get-Date)
    Copy-Item $main $backup
    $importPath = ($Paths.SiteCaddy -replace '\\', '/')
    $block = "`r`n$($script:ImportBegin)`r`nimport $importPath`r`n$($script:ImportEnd)`r`n"
    [IO.File]::WriteAllText($main, $text.TrimEnd() + "`r`n" + $block, (New-Object Text.UTF8Encoding $false))
    return $true
}

# Validate the full Caddy config and reload it. Returns an error string, or $null on success.
function Update-Caddy($Config) {
    $out = & $Config.caddy validate --config $Config.mainCaddyfile --adapter caddyfile 2>&1
    if ($LASTEXITCODE -ne 0) { return "caddy validate failed: $(($out | Select-Object -Last 5) -join ' | ')" }
    $out = & $Config.caddy reload --config $Config.mainCaddyfile --adapter caddyfile 2>&1
    if ($LASTEXITCODE -ne 0) { return "caddy reload failed: $(($out | Select-Object -Last 5) -join ' | ')" }
    return $null
}

# Point the `current` junction at a release. Junctions are removed with
# `rmdir`, which deletes only the link - Remove-Item on a junction in
# PowerShell 5.1 can delete the target's contents.
function Set-CurrentRelease($Paths, [string]$Release) {
    $tmp = "$($Paths.Current).new"
    if (Test-Path $tmp) { cmd /c rmdir "$tmp" | Out-Null }
    cmd /c mklink /J "$tmp" "$Release" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "mklink failed for $Release" }
    if (Test-Path $Paths.Current) { cmd /c rmdir "$($Paths.Current)" | Out-Null }
    [IO.Directory]::Move($tmp, $Paths.Current)
}

function Get-CurrentRelease($Paths) {
    if (-not (Test-Path $Paths.Current)) { return $null }
    $item = Get-Item $Paths.Current -Force
    if ($item.Target) { return [string]($item.Target | Select-Object -First 1) }
    return $null
}
