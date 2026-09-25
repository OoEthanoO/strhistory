<#
    rollback.ps1 - point the site at an earlier release, immediately.

        powershell -File ...\rollback.ps1              # list releases
        powershell -File ...\rollback.ps1 -To 1a2b3c4  # go live with that release

    The poller does not undo a rollback: it only deploys when main gets a new
    commit. The proper fix is usually `git revert` on main, which deploys itself.
#>
[CmdletBinding()]
param(
    [string]$Root = 'C:\Users\ethan\strhistory',
    [string]$To
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-Paths $Root

$releases = Get-ChildItem $paths.Releases -Directory | Sort-Object LastWriteTime -Descending
$live = Get-CurrentRelease $paths
if (-not $To) {
    foreach ($r in $releases) {
        $mark = if ($live -and ($r.FullName -eq $live)) { '  <- live' } else { '' }
        Write-Host ('{0}  {1:yyyy-MM-dd HH:mm}{2}' -f $r.Name.Substring(0, 7), $r.LastWriteTime, $mark)
    }
    return
}
$match = @($releases | Where-Object { $_.Name.StartsWith($To) })
if ($match.Count -ne 1) { throw "'$To' matches $($match.Count) releases." }
Set-CurrentRelease $paths $match[0].FullName
Save-State $paths @{ deployed = $match[0].Name; deployedAt = (Get-Date).ToString('o'); rolledBack = $true }
Write-Log $paths 'rollback' "live: current -> releases\$($match[0].Name.Substring(0, 7))"
