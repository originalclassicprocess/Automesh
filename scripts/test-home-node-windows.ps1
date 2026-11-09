. ([ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\nodes\adapters\windows\setup.ps1'), [Text.Encoding]::UTF8)))
# Isolated packaging/TLS smoke test. No root trust, firewall or startup changes.
$ErrorActionPreference = 'Stop'
$taskProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskReleaseRoot = Join-Path $taskProjectRoot 'nodes\.release\home-node'
$taskSmokeRoot = Join-Path ([IO.Path]::GetTempPath()) 'automesh-node-smoke'
New-Item -ItemType Directory -Path $taskSmokeRoot -Force | Out-Null
$taskTestDirectory = Join-Path $taskSmokeRoot ('test-' + [Guid]::NewGuid().ToString('N'))
$taskNodeProcess = $null
try {
    New-Item -ItemType Directory -Path $taskTestDirectory | Out-Null
    $taskSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\nodes\adapters\windows\launcher.ps1'), [Text.Encoding]::UTF8)
    $taskTokens = $null; $taskErrors = $null
    $taskAst = [Management.Automation.Language.Parser]::ParseInput($taskSource, [ref]$taskTokens, [ref]$taskErrors)
    if ($taskErrors) { throw 'Invalid launcher syntax' }
    . (Join-Path $PSScriptRoot '..\nodes\adapters\windows\secret-store.ps1')
    foreach ($taskFunction in $taskAst.FindAll({ param($part) $part -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) { Invoke-Expression $taskFunction.Extent.Text }
    $script:taskBase = $taskTestDirectory
    $taskPrivateIndices = @(Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Private' | ForEach-Object InterfaceIndex)
    $taskInterface = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { !$_.SkipAsSource -and $_.InterfaceIndex -in $taskPrivateIndices -and ($_.IPAddress -match '^192\.168\.' -or $_.IPAddress -match '^10\.' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.') } | Select-Object -First 1
    # Hosted GitHub VMs have an assigned RFC1918 adapter marked Public. The
    # isolated self-test opens no firewall rule and never changes its category.
    # Real-user runs still require a Private LAN; production validation is unchanged.
    if (!$taskInterface -and $env:GITHUB_ACTIONS -eq 'true') {
        $taskInterface = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { !$_.SkipAsSource -and ($_.IPAddress -match '^192\.168\.' -or $_.IPAddress -match '^10\.' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.') } | Select-Object -First 1
        if ($taskInterface) { Write-Output 'CI fixture uses its assigned RFC1918 adapter; no network category/firewall changes.' }
    }
    if (!$taskInterface) { throw 'A private LAN interface is required for this smoke test' }
    $script:taskConfig = @{}
    $taskCertificate = Task-Certificates @($taskInterface.IPAddress)
    $taskFixtureCaThumbprint = $taskCertificate.CaThumbprint
    $taskPorts = @()
    $taskDefaultOrigin = (& (Join-Path $taskReleaseRoot 'payload\node.exe') (Join-Path $taskReleaseRoot 'payload\node.cjs') '--deployment-defaults' | ConvertFrom-Json).appOrigin
    for ($taskIndex = 0; $taskIndex -lt 2; $taskIndex++) {
        $taskListener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
        $taskListener.Start(); $taskPorts += $taskListener.LocalEndpoint.Port; $taskListener.Stop()
    }
    if ($taskPorts[0] -eq $taskPorts[1]) { throw 'Retry smoke test: duplicate free port' }
    $taskConfig = @{ version = 1; networkMode = 'manual'; lanAddress = $taskInterface.IPAddress; lanAddresses = @($taskInterface.IPAddress); port = $taskPorts[0]; controlPort = $taskPorts[1];
        dataDirectory = (Join-Path $taskTestDirectory 'data'); pfxFile = $taskCertificate.File; pfxPassword = $taskCertificate.Password; caFile = $taskCertificate.CaFile;
        caThumbprint = $taskFixtureCaThumbprint; certificateExpires = $taskCertificate.Expires;
        adminToken = (Task-RandomHex 32); maxBytes = 67108864; allowedOrigins = @('http://localhost:5173', $taskDefaultOrigin) }
    $taskConfigFile = Join-Path $taskTestDirectory 'config.json'
    [IO.File]::WriteAllText($taskConfigFile, ($taskConfig | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    $taskPayload = Join-Path $taskReleaseRoot 'payload'
    $script:taskProgramRoot = $taskPayload
    $script:taskConfigFile = $taskConfigFile
    $script:taskConfig = $taskConfig
    $taskStatus = [pscustomobject]@{ Text = '' }
    # Exercise the actual child worker before a backend exists. The old
    # assistant waited for runtime health before even checking preparation.
    $taskWorkerInfo=New-Object Diagnostics.ProcessStartInfo
    $taskWorkerInfo.FileName=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $taskWorkerInfo.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $taskPayload 'launcher.ps1')+'" -CheckReadiness -WorkerConfig "'+$taskConfigFile+'"'
    $taskWorkerInfo.UseShellExecute=$false; $taskWorkerInfo.CreateNoWindow=$true; $taskWorkerInfo.RedirectStandardOutput=$true; $taskWorkerInfo.RedirectStandardError=$true
    # Actual field failure: correct list, truncated preferred address. Run the
    # real packaged preparation worker, not only extracted/mocked functions.
    $script:taskConfig.networkMode='automatic'; $script:taskConfig.lanAddress='1'
    Task-WriteConfig $script:taskConfig
    $taskRepairIdentity=$script:taskConfig.adminToken; $taskRepairCa=$script:taskConfig.caThumbprint
    $taskWorkerInfo.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $taskPayload 'launcher.ps1')+'" -PrepareNetwork -WorkerConfig "'+$taskConfigFile+'"'
    $taskWorkerProcess=[Diagnostics.Process]::Start($taskWorkerInfo)
    try {
        if (!$taskWorkerProcess.WaitForExit(45000)) { $taskWorkerProcess.Kill(); throw 'Primary-address recovery timed out' }
        if ($taskWorkerProcess.ExitCode -ne 0) { throw 'Packaged primary-address recovery failed' }
    } finally { $taskWorkerProcess.Dispose() }
    $script:taskConfig=Task-ReadConfig
    if ($script:taskConfig.lanAddress -eq '1' -or $script:taskConfig.lanAddresses -notcontains $script:taskConfig.lanAddress -or $script:taskConfig.adminToken -ne $taskRepairIdentity -or $script:taskConfig.caThumbprint -ne $taskRepairCa) { throw 'Packaged recovery lost primary address or identity' }
    $taskWorkerInfo.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $taskPayload 'launcher.ps1')+'" -CheckReadiness -WorkerConfig "'+$taskConfigFile+'"'
    $taskWorkerProcess=[Diagnostics.Process]::Start($taskWorkerInfo)
    try {
        if (!$taskWorkerProcess.WaitForExit(45000)) { $taskWorkerProcess.Kill(); throw 'Unstarted-node observation timed out' }
        if ($taskWorkerProcess.ExitCode -ne 0) { throw 'Actual readiness worker failed before startup' }
        $taskPreflight=$taskWorkerProcess.StandardOutput.ReadToEnd() | ConvertFrom-Json
        if (!$taskPreflight.certificate -or $taskPreflight.localHttps -or $taskPreflight.trusted) { throw 'Preflight confused preparation, running or trust' }
    } finally { $taskWorkerProcess.Dispose() }
    # First pass migrates legacy config; second reloads DPAPI config/key and keeps identities.
    foreach ($taskPass in 1,2) {
    Task-StartBackend
    $taskNodeProcess = $script:taskProcess
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 40; $taskAttempt++) {
        if (!$taskNodeProcess -or $taskNodeProcess.HasExited) { throw 'Bundled node exited before listening via launcher' }
        $taskProbe = New-Object Net.Sockets.TcpClient
        try {
            $taskConnecting = $taskProbe.ConnectAsync('127.0.0.1', $taskPorts[0])
            if ($taskConnecting.Wait(250) -and $taskProbe.Connected) { $taskReady = $true; break }
        } catch {} finally { $taskProbe.Dispose() }
        Start-Sleep -Milliseconds 250
    }
    if (!$taskReady) { throw 'Bundled node did not become ready' }
    $taskResult = & (Join-Path $taskPayload 'node.exe') (Join-Path $PSScriptRoot 'test-home-node-tls.mjs') $taskConfigFile
    if ($LASTEXITCODE -ne 0) { throw 'Bundled TLS node smoke failed' }
    Write-Output $taskResult
    if (!$taskNodeProcess.WaitForExit(5000)) { throw 'Bundled node did not stop after smoke pass' }
    }
    # Exercise the actual offscreen Save-and-start handler. Stub ONLY autostart:
    # no real registry, firewall, installed config or trusted-root modifications.
    Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
    $taskUiSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\nodes\adapters\windows\node-ui.ps1'), [Text.Encoding]::UTF8).Replace("`r`n", "`n")
    $taskBoundary = "try {`n    if (Test-Path -LiteralPath `$script:taskConfigFile)"
    $taskOffset = $taskUiSource.IndexOf($taskBoundary, [StringComparison]::Ordinal)
    if ($taskOffset -lt 0) { throw 'UI boundary changed' }
    Invoke-Expression $taskUiSource.Substring(0, $taskOffset).Replace('$taskTray.Visible = $true', '$taskTray.Visible = $false')
    function Task-Autostart([bool]$Enabled) { }
    # Execute maintenance against this fixture config only. Never launch the
    # installed launcher worker, which uses the real LocalAppData directory.
    function Task-BeginNetworkUpdate {
        Task-SyncNetwork
        $script:taskNetworkPrepared = $true; $script:taskNetworkCheckedAt = Get-Date
    }
    for ($taskIndex = 0; $taskIndex -lt $script:taskAddresses.Count; $taskIndex++) { if ($script:taskAddresses[$taskIndex].IPAddress -eq $taskInterface.IPAddress) { $taskNetwork.SelectedIndex = $taskIndex } }
    $taskPublicPort.Value = $taskPorts[0]; $taskControlPort.Value = $taskPorts[1]; $taskCourier.Checked = $false
    $taskNetworkAuto.Checked = $false
    $taskPreviousPfx = $script:taskConfig.pfxFile
    $taskPreviousCa = $script:taskConfig.caFile
    $taskPreviousPfxHash = (Get-FileHash -LiteralPath $taskPreviousPfx).Hash
    $taskPreviousCaHash = (Get-FileHash -LiteralPath $taskPreviousCa).Hash
    # Simulate an old DHCP binding in memory. Save must rotate only TLS, not
    # mailbox/node identity, and leave the previously working certificate intact.
    $script:taskConfig.lanAddress = '192.0.2.1'
    $script:taskConfig.lanAddresses = @('192.0.2.1')
    Task-SaveAndStart
    Task-ServiceTick; Task-ServiceTick
    $taskNodeProcess = $script:taskProcess
    if (!$taskNodeProcess -or $taskNodeProcess.HasExited) { throw 'GUI Save-and-start failed' }
    $taskOpened = Task-ReadConfig
    if ($taskOpened.adminToken -ne $script:taskConfig.adminToken -or $taskOpened.controlPort -ne $script:taskConfig.controlPort) { throw 'GUI config and admin differ' }
    if ($taskOpened.caThumbprint -ne $taskFixtureCaThumbprint) { throw 'GUI update replaced trusted CA' }
    Write-Output ('GUI smoke binding: ' + $script:taskConfig.lanAddress + ':' + $script:taskConfig.port + ' control ' + $script:taskConfig.controlPort)
    for ($taskAttempt = 0; $taskAttempt -lt 40; $taskAttempt++) {
        try { Task-Control '/status' | Out-Null; break } catch { $taskControlFailure = $_.Exception.Message; Start-Sleep -Milliseconds 250 }
    }
    if ($taskAttempt -eq 40) { throw ('GUI-started node did not become ready: ' + (Task-StartError) + ' ' + $taskControlFailure) }
    $taskReadiness = Task-ReadinessFacts
    if (!$taskReadiness.certificate -or !$taskReadiness.localHttps -or !$taskReadiness.lanHttps -or $taskReadiness.trusted -or $taskReadiness.stamp -ne (Task-ConfigStamp $script:taskConfig)) { throw 'Isolated readiness observations incorrect' }
    if ((Task-ReadConfig).setupMode -ne 'pc') { throw 'GUI did not persist its usage mode' }
    if ($script:taskConfig.pfxFile -eq $taskPreviousPfx -or (Get-FileHash -LiteralPath $taskPreviousPfx).Hash -ne $taskPreviousPfxHash -or (Get-FileHash -LiteralPath $taskPreviousCa).Hash -ne $taskPreviousCaHash) { throw 'IP change overwrote old TLS material' }
    Task-CheckLan
    for ($taskAttempt = 0; $taskAttempt -lt 40; $taskAttempt++) {
        if ($script:taskCheckProcess.HasExited) { break }
        Start-Sleep -Milliseconds 250
    }
    Task-ReadLanCheck
    if ([regex]::Matches($taskLanCheck.Text, 'OK').Count -ne 3) { throw ('GUI LAN diagnostic failed: ' + $taskLanCheck.Text) }
    $taskResult = & (Join-Path $taskPayload 'node.exe') (Join-Path $PSScriptRoot 'test-home-node-tls.mjs') $taskConfigFile
    if ($LASTEXITCODE -ne 0) { throw 'GUI-started node TLS/LAN smoke failed' }
    Write-Output $taskResult
    if (!$taskNodeProcess.WaitForExit(5000)) { throw 'GUI-started node did not stop' }
    # Explicit stale-IP regression: must not spawn a backend on a vanished IP.
    $script:taskConfig.lanAddress = '192.0.2.1'
    $taskManualDenied = $false
    try { Task-SyncNetwork } catch { $taskManualDenied = $true }
    if (!$taskManualDenied -or !$script:taskProcess.HasExited) { throw 'Invalid manual binding must not start a backend' }
    # Missing signer recovery is explicit and must not touch the stored queue.
    $taskBeforeRecovery=Task-ReadConfig
    $taskBeforeRecovery.caThumbprint=('f' * 40)
    Task-WriteConfig $taskBeforeRecovery
    $taskSavedHash=(Get-FileHash -LiteralPath $taskConfigFile).Hash
    $taskQueueHashes=@{}
    foreach ($taskFile in Get-ChildItem -LiteralPath $taskBeforeRecovery.dataDirectory -File -Recurse) { $taskQueueHashes[$taskFile.FullName]=(Get-FileHash -LiteralPath $taskFile.FullName).Hash }
    $taskPrepareArgs='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $taskPayload 'launcher.ps1')+'" -PrepareNetwork -WorkerConfig "'+$taskConfigFile+'"'
    foreach ($taskReset in @($false,$true)) {
        $taskWorkerInfo.Arguments=$taskPrepareArgs+$(if ($taskReset) { ' -ResetCertificate' } else { '' })
        $taskWorkerProcess=[Diagnostics.Process]::Start($taskWorkerInfo)
        try {
            if (!$taskWorkerProcess.WaitForExit(45000)) { $taskWorkerProcess.Kill(); throw 'Preparation recovery timed out' }
            $taskWorkerResult=$taskWorkerProcess.StandardOutput.ReadToEnd() | ConvertFrom-Json
            if (!$taskReset) {
                if ($taskWorkerProcess.ExitCode -eq 0 -or $taskWorkerResult.error -ne 'local_ca_unavailable' -or (Get-FileHash -LiteralPath $taskConfigFile).Hash -ne $taskSavedHash) { throw 'Missing signer must report a safe reason without changing settings' }
            } elseif ($taskWorkerProcess.ExitCode -ne 0) { throw 'Explicit fixture certificate recovery failed' }
        } finally { $taskWorkerProcess.Dispose() }
    }
    $taskRecovered=Task-ReadConfig; $taskReplacementCaThumbprint=$taskRecovered.caThumbprint
    if ($taskRecovered.caThumbprint -eq ('f' * 40) -or $taskRecovered.adminToken -ne $taskBeforeRecovery.adminToken -or $taskRecovered.dataDirectory -ne $taskBeforeRecovery.dataDirectory -or (Test-Path -LiteralPath ('Cert:\CurrentUser\Root\'+$taskRecovered.caThumbprint))) { throw 'Certificate recovery changed queue identity or installed trust' }
    foreach ($taskFilePath in $taskQueueHashes.Keys) { if ((Get-FileHash -LiteralPath $taskFilePath).Hash -ne $taskQueueHashes[$taskFilePath]) { throw 'Certificate recovery modified stored queue data' } }
    Write-Output 'Packaged pre-start readiness and explicit missing-CA recovery passed; stored queue unchanged and no trust installed.'
} finally {
    if ($taskTimer) { $taskTimer.Dispose() }
    if ($taskTray) { $taskTray.Dispose() }
    if ($taskForm) { $taskForm.Dispose() }
    if ($script:taskStatusRequest) { $script:taskStatusRequest.Abort() }
    if ($script:taskShutdownRequest) { $script:taskShutdownRequest.Abort() }
    if ($taskFixtureCaThumbprint) { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $taskFixtureCaThumbprint) -DeleteKey }
    if ($taskReplacementCaThumbprint) { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $taskReplacementCaThumbprint) -DeleteKey }
    if ($taskNodeProcess -and !$taskNodeProcess.HasExited) {
        if (!$taskNodeProcess.WaitForExit(3000)) { $taskNodeProcess.Kill(); $taskNodeProcess.WaitForExit() }
    }
    # Exact generated test directory only. Never recurse into a workspace/root.
    $taskResolved = [IO.Path]::GetFullPath($taskTestDirectory)
    if ($taskResolved.StartsWith(([IO.Path]::GetFullPath($taskSmokeRoot) + '\'), [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($taskResolved) -match '^test-[a-f0-9]{32}$') {
        if (Test-Path -LiteralPath $taskResolved) { Remove-Item -LiteralPath $taskResolved -Recurse -Force }
    }
}
