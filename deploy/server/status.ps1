<#
    status.ps1 - what is live, what happened last, and whether the poller is healthy.

        powershell -File C:\Users\ethan\strhistory\repo\deploy\server\status.ps1 [-Lines 40]
#>
[CmdletBinding()]
param(
    [string]$Root = 'C:\Users\ethan\strhistory',
    [int]$Lines = 25
)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-Paths $Root

$state = Read-State $paths
$current = Get-CurrentRelease $paths
$task = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
$info = if ($task) { Get-ScheduledTaskInfo -TaskName $script:TaskName } else { $null }

Write-Host "Site:          https://$($script:Domain)"
Write-Host "Live release:  $(if ($current) { Split-Path $current -Leaf } else { '(none)' })"
Write-Host "Last attempt:  $($state.lastAttempted)  status=$($state.status)  attempts=$($state.attempts)"
if ($state.error) { Write-Host "Last error:    $($state.error)" -ForegroundColor Yellow }
if ($state.https) { Write-Host "HTTPS check:   $($state.https)" }
Write-Host "Deployed at:   $($state.deployedAt)"
if ($task) {
    Write-Host "Poller task:   $($task.State); last run $($info.LastRunTime) (result $($info.LastTaskResult)); next $($info.NextRunTime)"
} else {
    Write-Host 'Poller task:   NOT REGISTERED - run deploy\server\install.ps1' -ForegroundColor Red
}
Write-Host "Releases:      $((Get-ChildItem $paths.Releases -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name.Substring(0, 7) }) -join ', ')"
Write-Host ''
Write-Host "--- last $Lines log lines ($($paths.Log))"
if (Test-Path $paths.Log) { Get-Content $paths.Log -Tail $Lines }
