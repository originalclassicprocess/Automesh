# Pure setup decisions; no node, trust-store, firewall or user config mutations.
$ErrorActionPreference = 'Stop'
. ([ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\nodes\adapters\windows\setup.ps1'), [Text.Encoding]::UTF8)))
$taskReady = @{ certificate = $true; trusted = $true; privateNetwork = $true; firewall = 'ready'; localHttps = $true; lanHttps = $true }
function Task-ExpectState($Plan, [string]$Id, [string]$State) {
    $taskStep = @($Plan | Where-Object id -eq $Id)
    if ($taskStep.Count -ne 1 -or $taskStep[0].state -ne $State) { throw ('Unexpected setup state: ' + $Id + ' / expected ' + $State) }
}
$taskPc = @(Task-SetupPlan $taskReady 'pc' $true $true $false)
if ($taskPc.Count -ne 4) { throw 'PC setup must include preparation, startup, trust and app connection' }
$script:taskSetupPcPaired=$true
$taskPc = @(Task-SetupPlan $taskReady 'pc' $true $true $false)
if (@($taskPc | Where-Object state -ne 'done').Count) { throw 'Ready PC should need no repeated permissions' }
$taskBoth = @(Task-SetupPlan $taskReady 'both' $true $true $false)
if ($taskBoth.Count -ne 9) { throw 'Both modes must share PC prerequisites, then phone setup' }
Task-ExpectState $taskBoth 'phone-certificate' 'action'
Task-ExpectState $taskBoth 'phone-pair' 'action'
$taskMissing=$taskReady.Clone(); $taskMissing.trusted=$false
Task-ExpectState (Task-SetupPlan $taskMissing 'pc' $true $true $false) 'trust' 'action'
$taskMissing.privateNetwork=$false
Task-ExpectState (Task-SetupPlan $taskMissing 'both' $true $true $false) 'network' 'action'
Task-ExpectState (Task-SetupPlan $taskMissing 'both' $true $true $false) 'firewall' 'blocked'
$taskMissing=$taskReady.Clone(); $taskMissing.lanHttps=$false
Task-ExpectState (Task-SetupPlan $taskMissing 'both' $true $true $false) 'lan' 'error'
Task-ExpectState (Task-SetupPlan $null 'pc' $true $false $true) 'prepare' 'checking'
Task-ExpectState (Task-SetupPlan $taskReady 'pc' $true $false $false $false $true) 'prepare' 'done'
Task-ExpectState (Task-SetupPlan $taskReady 'pc' $true $false $false $false $true) 'runtime' 'error'
Task-ExpectState (Task-SetupPlan $taskReady 'both' $true $true $true) 'prepare' 'done'
# A running maintenance worker must not replace an already validated QR step.
$script:taskSetupAppOrigin='https://current-app.invalid'
$script:taskConfig=@{allowedOrigins=@('https://previous-app.invalid')}
Task-ExpectState (Task-SetupPlan $taskReady 'pc' $true $true $false) 'app-origin' 'action'
$script:taskConfig.allowedOrigins+=@($script:taskSetupAppOrigin)
if (@((Task-SetupPlan $taskReady 'pc' $true $true $false) | Where-Object id -eq 'app-origin').Count) { throw 'Approved application must not require repeated authorization' }
$script:taskSetupAppOrigin=$null; $script:taskConfig=$null
Task-ExpectState (Task-SetupPlan @{checkError=$true} 'pc' $true $false $false) 'prepare' 'error'
$script:taskSetupPhoneCertificate=$true; $script:taskSetupPhonePaired=$true
if (@((Task-SetupPlan $taskReady 'both' $true $true $false) | Where-Object state -ne 'done').Count) { throw 'Completed phone flow should be green' }
$taskConfig = @{ pfxFile = 'fixture.pfx'; caThumbprint = ('A' * 40); port = 3003; controlPort = 3004; lanAddresses = @('192.168.2.5'); allowedOrigins = @('https://fixture.invalid') }
$taskStamp = Task-ConfigStamp $taskConfig
$taskConfig.lanAddresses = @('192.168.2.6')
if ($taskStamp -eq (Task-ConfigStamp $taskConfig)) { throw 'DHCP must invalidate observations' }
$taskConfig.lanAddresses = @('192.168.2.5'); $taskConfig.adminToken = 'not-part-of-observations'
if ($taskStamp -ne (Task-ConfigStamp $taskConfig)) { throw 'Readiness must not export/hash administrative secrets' }
if ((Task-InspectCa @{ caThumbprint = 'invalid'; caFile = 'missing.cer' }).valid) { throw 'Invalid CA must be rejected' }
$script:taskProcess=$null; $script:taskStopping=$false; $script:taskAdoptedRunning=$false; $script:taskNetworkCheckedAt=$null
Task-RecordRuntime ([pscustomobject]@{members=@([pscustomobject]@{address='fixture'})})
if (!$script:taskAdoptedRunning -or !$script:taskDesiredRunning -or !$script:taskNetworkCheckedAt -or $script:taskSetupMemberCount -ne 1) { throw 'Existing healthy node must be adopted without a restart or an uninitialized maintenance clock' }
$script:taskStopping=$true; $script:taskDesiredRunning=$false; $script:taskAdoptedRunning=$false
Task-RecordRuntime ([pscustomobject]@{members=@()})
if ($script:taskDesiredRunning -or $script:taskAdoptedRunning) { throw 'A late status response must not override explicit Stop' }
Write-Output 'Setup modes, prerequisites, permission boundaries, stopped/error decisions and stale-observation invalidation passed.'
