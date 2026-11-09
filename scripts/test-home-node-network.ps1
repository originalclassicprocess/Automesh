# Isolated network/config fixtures only: no real node, firewall or trust changes.
param([switch]$Certificates)
$ErrorActionPreference = 'Stop'
. ([ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\nodes\adapters\windows\setup.ps1'), [Text.Encoding]::UTF8)))
. (Join-Path $PSScriptRoot '..\nodes\adapters\windows\secret-store.ps1')
$taskTokens = $null; $taskErrors = $null
$taskLauncher = [Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\nodes\adapters\windows\launcher.ps1')), [ref]$taskTokens, [ref]$taskErrors)
if ($taskErrors.Count) { throw 'Launcher syntax failed' }
foreach ($taskFunction in $taskLauncher.FindAll({ param($part) $part -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    . ([ScriptBlock]::Create($taskFunction.Extent.Text))
}
$script:taskBase = Join-Path $PSScriptRoot ('..\.release\home-node\network-fixture-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($script:taskBase)
$script:taskBase = [IO.Path]::GetFullPath($script:taskBase)
$script:taskConfigFile = Join-Path $script:taskBase 'config.json'
$taskCreatedCa = $null
try {
    if ($Certificates) {
        $script:taskConfig = @{}
        $taskFirst = Task-Certificates @('192.168.2.5', '10.0.0.3')
        $taskCreatedCa = $taskFirst.CaThumbprint
        $script:taskConfig = @{ caThumbprint = $taskCreatedCa; caFile = $taskFirst.CaFile }
        $taskSecond = Task-Certificates @('192.168.2.8')
        if ($taskSecond.CaThumbprint -ne $taskCreatedCa) { throw 'DHCP changed trusted root' }
        $taskCa = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $taskCreatedCa)
        if (!$taskCa.HasPrivateKey) { throw 'Renewal key missing' }
        $taskObservation = Task-InspectCa $script:taskConfig
        if (!$taskObservation.valid -or $taskObservation.trusted) { throw 'Fixture CA must be valid but not installed as a trust root' }
        $taskConstraints = $taskCa.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.30' }
        if (!$taskConstraints -or !$taskConstraints.Critical) { throw 'Missing constrained CA' }
        # Export public fixtures/PFX only inside the private test directory.
        # No root is installed in CurrentUser\Root or LocalMachine.
        $taskOutsideLeaf = $null
        try {
            $taskOutsideLeaf = New-SelfSignedCertificate -Type Custom -Subject 'CN=example.com' -Signer $taskCa -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @('2.5.29.19={critical}{text}ca=false', '2.5.29.37={text}1.3.6.1.5.5.7.3.1', '2.5.29.17={text}DNS=example.com') -NotAfter (Get-Date).AddDays(1)
            $taskOutsideFile = Join-Path $script:taskBase 'out-of-scope.pfx'
            Export-PfxCertificate -Cert $taskOutsideLeaf -FilePath $taskOutsideFile -Password (ConvertTo-SecureString 'fixture-only' -AsPlainText -Force) | Out-Null
        } finally { if ($taskOutsideLeaf) { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $taskOutsideLeaf.Thumbprint) -DeleteKey } }
        $taskManifest = @{ first = $taskFirst; second = $taskSecond; outside = @{ File = $taskOutsideFile; Password = 'fixture-only' } }
        [IO.File]::WriteAllText((Join-Path $script:taskBase 'tls-fixture.json'), ($taskManifest | ConvertTo-Json -Depth 4))
        & (Join-Path $PSScriptRoot '..\nodes\.release\home-node\payload\node.exe') (Join-Path $PSScriptRoot 'test-home-node-network-tls.mjs') (Join-Path $script:taskBase 'tls-fixture.json')
        if ($LASTEXITCODE -ne 0) { throw 'TLS fixture failed' }
    } else {
        function Task-InspectCa($Config) { @{valid=$true; trusted=$false} }
        function Get-NetConnectionProfile { @([pscustomobject]@{ InterfaceIndex = 1; NetworkCategory = 'Private' }, [pscustomobject]@{ InterfaceIndex = 2; NetworkCategory = 'Private' }, [pscustomobject]@{ InterfaceIndex = 3; NetworkCategory = 'Public' }) }
        function Get-NetAdapter { @([pscustomobject]@{ ifIndex = 1; Status = 'Up' }, [pscustomobject]@{ ifIndex = 2; Status = 'Up' }, [pscustomobject]@{ ifIndex = 3; Status = 'Up' }, [pscustomobject]@{ ifIndex = 4; Status = 'Down' }) }
        $script:taskMockIps = @('192.168.2.5', '10.0.0.3', '192.168.50.1', '192.168.60.1')
        function Get-NetIPAddress { for ($taskIndex = 0; $taskIndex -lt $script:taskMockIps.Count; $taskIndex++) { [pscustomobject]@{ IPAddress = $script:taskMockIps[$taskIndex]; InterfaceIndex = $taskIndex + 1; SkipAsSource = $false } } }
        $taskAddresses = @(Task-NetworkAddresses | ForEach-Object IPAddress)
        if (($taskAddresses -join ',') -ne '192.168.2.5,10.0.0.3') { throw 'Private multi-interface filtering failed' }
        $taskFakePfx = Join-Path $script:taskBase 'fixture.pfx'; [IO.File]::WriteAllText($taskFakePfx, 'fixture')
        $script:taskRenewals = 0
        function Task-Certificates([string[]]$Addresses) { $script:taskRenewals++; return @{ File = $taskFakePfx; Password = 'fixture-secret'; CaFile = (Join-Path $script:taskBase 'fixture.cer'); CaThumbprint = ('A' * 40); Expires = [DateTime]::UtcNow.AddMonths(6).ToString('o') } }
        $script:taskConfig = @{ version = 1; networkMode = 'automatic'; lanAddress = '192.168.2.2'; pfxFile = $taskFakePfx; pfxPassword = 'fixture-secret'; adminToken = ('a' * 64); maxFiles = 200; maxFilesPerProfile = 40 }
        Task-SyncNetwork
        if ($script:taskConfig.lanAddresses.Count -ne 2 -or $script:taskRenewals -ne 1) { throw 'First automatic repair failed' }
        Task-SyncNetwork
        if ($script:taskRenewals -ne 1) { throw 'Unchanged network caused renewal' }
        $script:taskMockIps[0] = '192.168.2.9'
        Task-SyncNetwork
        if ($script:taskConfig.lanAddress -ne '192.168.2.9' -or $script:taskConfig.caThumbprint -ne ('A' * 40)) { throw 'DHCP recovery failed' }
        if ($script:taskConfig.maxFiles -ne 200 -or $script:taskConfig.maxFilesPerProfile -ne 40 -or (Task-ReadConfig).adminToken -ne ('a' * 64)) { throw 'Recovery lost identity/limits' }
        # Regression: one adapter was unwrapped into a string; [0] saved "1".
        $script:taskMockIps = @('192.168.2.9')
        $script:taskConfig.lanAddress = '1'; $script:taskConfig.lanAddresses = @('192.168.2.9')
        $taskPreviousRenewals = $script:taskRenewals; $taskPreviousPfx = $script:taskConfig.pfxFile
        Task-SyncNetwork
        if ($script:taskConfig.lanAddress -ne '192.168.2.9' -or $script:taskConfig.lanAddresses.Count -ne 1 -or $script:taskRenewals -ne $taskPreviousRenewals -or $script:taskConfig.pfxFile -ne $taskPreviousPfx) { throw 'Single-adapter primary repair failed or needlessly renewed TLS' }
        $script:taskMockIps = @('10.2.3.4')
        Task-SyncNetwork
        if ($script:taskConfig.lanAddress -ne '10.2.3.4' -or $script:taskConfig.lanAddresses[0] -ne '10.2.3.4') { throw 'Single-adapter DHCP selection truncated the IP' }
        $script:taskMockIps = @()
        Task-SyncNetwork
        if ($script:taskConfig.lanAddress -ne '' -or $script:taskConfig.lanAddresses.Count -ne 0) { throw 'Offline loopback mode failed' }
        $script:taskProcess = [pscustomobject]@{ HasExited = $false }
        $script:taskProcess | Add-Member ScriptMethod Kill { throw 'Must not force-kill writer' }
        $script:taskProcess | Add-Member ScriptMethod WaitForExit { throw 'Must not block UI waiting for writer' }
        function Task-Control { [pscustomobject]@{ stopping = $true } }
        $taskStatus = [pscustomobject]@{ Text = '' }
        Task-Stop
        if ($script:taskDesiredRunning -or !$script:taskStopping) { throw 'Stop intent was lost' }
        $taskUiTokens = $null; $taskUiErrors = $null
        $taskUiAst = [Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\nodes\adapters\windows\node-ui.ps1')), [ref]$taskUiTokens, [ref]$taskUiErrors)
        if ($taskUiErrors.Count) { throw 'UI syntax failed' }
        foreach ($taskFunction in $taskUiAst.FindAll({ param($part) $part -is [Management.Automation.Language.FunctionDefinitionAst] -and $part.Name -in @('Task-Start', 'Task-ServiceTick', 'Task-ReadNetworkUpdate') }, $true)) { . ([ScriptBlock]::Create($taskFunction.Extent.Text)) }
        $taskStartButton = [pscustomobject]@{ Enabled = $true }; $taskStopButton = [pscustomobject]@{ Enabled = $false }
        $taskLocalEndpoint = [pscustomobject]@{ Text = '' }
        $script:taskNetworkCalls = 0; $script:taskBackendCalls = 0
        function Task-BeginNetworkUpdate { $script:taskNetworkCalls++; $script:taskNetworkCheckedAt = Get-Date }
        function Task-StartBackend { $script:taskBackendCalls++; $script:taskProcess = [pscustomobject]@{ HasExited = $false } }
        $script:taskProcess = $null
        Task-Start; Task-ServiceTick
        if ($script:taskNetworkCalls -ne 1 -or $script:taskBackendCalls) { throw 'Started backend before network preparation' }
        $script:taskNetworkPrepared = $true
        Task-ServiceTick
        if ($script:taskBackendCalls -ne 1) { throw 'Prepared startup did not start once' }
        Task-Stop
        $script:taskProcess.HasExited = $true
        Task-ServiceTick; Task-ServiceTick
        if ($script:taskBackendCalls -ne 1 -or $script:taskDesiredRunning) { throw 'Timer restarted an explicitly stopped node' }
        # A maintenance worker finishing after Stop must not revive the node.
        $script:taskNetworkProcess = [pscustomobject]@{ HasExited = $true; ExitCode = 0 }
        $script:taskNetworkProcess | Add-Member ScriptMethod WaitForExit { }
        $script:taskNetworkProcess | Add-Member ScriptMethod Dispose { }
        Task-ServiceTick
        if ($script:taskBackendCalls -ne 1 -or $script:taskDesiredRunning) { throw 'Late network update overrode Stop' }
        Write-Output 'Automatic Private networks, DHCP recovery, loopback fallback, stable CA reference, quota preservation and graceful stop passed.'
    }
} finally {
    if ($taskCreatedCa) { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $taskCreatedCa) -DeleteKey }
    # Only this freshly allocated fixture directory; delete known immediate
    # regular files, never recurse through computed directories or user data.
    foreach ($taskFile in [IO.Directory]::EnumerateFiles($script:taskBase)) { [IO.File]::Delete($taskFile) }
    [IO.Directory]::Delete($script:taskBase)
}
