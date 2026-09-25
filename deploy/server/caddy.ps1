<#
    caddy.ps1 - make sure Caddy serves the site: the main Caddyfile imports
    <Root>\Caddyfile, that file matches deploy\Caddyfile, and Caddy has
    reloaded. Safe to run repeatedly. tick.ps1 calls it if the import block
    disappears (for example after finprint's setup.ps1 regenerates the main
    Caddyfile).
#>
[CmdletBinding()]
param([string]$Root = 'C:\Users\ethan\strhistory')

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')

$paths = Get-Paths $Root
$config = Read-ServerConfig $paths

if (-not (Test-Path $paths.SiteCaddy)) {
    Copy-Item (Join-Path $paths.Repo 'deploy\Caddyfile') $paths.SiteCaddy
}
$added = Confirm-CaddyImport $config $paths
if ($added) { Write-Log $paths 'caddy' "added import block to $($config.mainCaddyfile)" }

$err = Update-Caddy $config
if ($err) { Write-Log $paths 'caddy' $err; exit 1 }
Write-Log $paths 'caddy' 'config valid and reloaded'
