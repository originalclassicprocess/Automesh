. ([ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\nodes\adapters\windows\setup.ps1'), [Text.Encoding]::UTF8)))
# Construct and render controls offscreen. Never install, start a node, or read user config.
$ErrorActionPreference = 'Stop'
if (!$script:taskProgramRoot) { $script:taskProgramRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\nodes\.release\home-node\payload')).Path }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$taskSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\nodes\adapters\windows\node-ui.ps1'), [Text.Encoding]::UTF8)
$taskBoundary = "try {`n    if (Test-Path -LiteralPath `$script:taskConfigFile)"
$taskNormalized = $taskSource.Replace("`r`n", "`n")
$taskOffset = $taskNormalized.IndexOf($taskBoundary, [StringComparison]::Ordinal)
if ($taskOffset -lt 0) { throw 'UI entry boundary changed: review offscreen test' }
$taskSetup = $taskNormalized.Substring(0, $taskOffset).Replace('$taskTray.Visible = $true', '$taskTray.Visible = $false')
$script:taskConfig = $null
$taskLauncherTokens = $null; $taskLauncherErrors = $null
$taskLauncherAst = [Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\nodes\adapters\windows\launcher.ps1'), [Text.Encoding]::UTF8), [ref]$taskLauncherTokens, [ref]$taskLauncherErrors)
foreach ($taskFunction in $taskLauncherAst.FindAll({ param($part) $part -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    if ($taskFunction.Name -in @('Task-AddressIsLocal', 'Task-CaFile')) { Invoke-Expression $taskFunction.Extent.Text }
}
try {
    Invoke-Expression $taskSetup
    if (!$script:taskSetupPcButton -or !$script:taskSetupBothButton) { throw 'Missing two welcome choices' }
    $script:taskSetupOverlay.Hide()
    if ($taskTabs.TabPages.Count -ne 4) { throw 'Four role tabs required' }
    if ($taskMessageLimit.Value -ne 1000 -or $taskPublicPort.Value -ne 3003 -or $taskControlPort.Value -ne 3004) { throw 'Unexpected defaults' }
    if (!$taskNetworkAuto.Checked -or !$taskCourier.Checked -or !$taskStartButton.Text -or !$taskStopButton.Text) { throw 'Missing simple automatic startup defaults' }
    if ((Task-CourierStatus 'connected') -eq 'connected') { throw 'Status must be understandable in Russian' }
    $taskMockMembers = [pscustomobject]@{ memberManagement = $true; members = @([pscustomobject]@{ address = 'fixture-first' }, [pscustomobject]@{ address = 'fixture-second' }) }
    Task-UpdateMembers $taskMockMembers
    if ($taskMemberList.Items.Count -ne 2 -or !$taskRemoveMember.Enabled) { throw 'Missing bound profile management' }
    $taskMemberList.SelectedIndex = 1
    Task-UpdateMembers $taskMockMembers
    if ($taskMemberList.SelectedIndex -ne 1) { throw 'Status polling reset selected profile' }
    Task-UpdateMembers ([pscustomobject]@{ memberManagement = $true; members = @([pscustomobject]@{ address = 'fixture-second' }) })
    if ($taskMemberList.SelectedIndex -ne 0) { throw 'Selection did not follow the same profile after list change' }
    $taskPreviousSummary = $taskOutSummary.Text
    Task-OfflineStatus
    if ($taskCode.Text -or $taskOutSummary.Text -eq $taskPreviousSummary) { throw 'Stale status/QR code after disconnection' }
    if ($taskMemberList.Items.Count -ne 0 -or $taskRemoveMember.Enabled) { throw 'Offline node must disable profile removal' }
    $script:taskConfig = @{ lanAddress = '192.0.2.1' }
    Task-CheckLan
    if (!$taskLanCheck.Text.Contains('192.0.2.1')) { throw 'Missing DHCP/stale IP diagnosis' }
    $script:taskConfig = $null
    # Successful firewall helper completion must schedule a fresh LAN check;
    # this tests the UI state transition without UAC or changing firewall rules.
    $script:taskMockCheckCount = 0
    function Task-CheckLan { $script:taskMockCheckCount++ }
    $script:taskFirewallProcess = [pscustomobject]@{ HasExited = $true; ExitCode = 0 }
    $script:taskFirewallProcess | Add-Member ScriptMethod WaitForExit { }
    $script:taskFirewallProcess | Add-Member ScriptMethod Dispose { }
    Task-ReadFirewallUpdate
    if ($script:taskMockCheckCount -ne 1 -or $script:taskFirewallProcess) { throw 'Firewall success did not refresh LAN diagnostic' }
    $script:taskFirewallProcess = [pscustomobject]@{ HasExited = $true; ExitCode = 1 }
    $script:taskFirewallProcess | Add-Member ScriptMethod WaitForExit { }
    $script:taskFirewallProcess | Add-Member ScriptMethod Dispose { }
    Task-ReadFirewallUpdate
    if ($script:taskMockCheckCount -ne 1 -or $script:taskFirewallProcess) { throw 'Failed firewall update must not look successful' }
    $taskOutput = Join-Path $PSScriptRoot '..\.release\home-node\ui-preview'
    New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
    # Set the internal visibility flag for DrawToBitmap only; never Show() a window.
    $taskForm.StartPosition = 'Manual'; $taskForm.Location = New-Object Drawing.Point(-30000, -30000)
    [Windows.Forms.Control].GetMethod('SetState', [Reflection.BindingFlags]'Instance,NonPublic').Invoke($taskForm, @([int]2, $true)) | Out-Null
    $taskForm.CreateControl()
    Task-ShowSetup
    $taskFlag = [Windows.Forms.Control].GetMethod('GetState', [Reflection.BindingFlags]'Instance,NonPublic')
    if ($script:taskSetupPhase -ne 'welcome' -or $taskFlag.Invoke($taskFooter,@([int]2)) -or $taskFlag.Invoke($script:taskSetupSkipPhone,@([int]2))) { throw 'Unready PC must show two choices and no skip/footer' }
    Task-FinishSetup
    if ($script:taskSetupPhase -ne 'welcome') { throw 'PC setup was skipped before readiness' }
    $taskOriginalSave=(Get-Item Function:\Task-SaveAndStart).ScriptBlock
    $script:taskColdStarts=0
    function Task-SaveAndStart { $script:taskColdStarts++ }
    Task-ChooseSetup 'pc'
    if ($script:taskColdStarts -ne 1 -or $script:taskSetupPhase -ne 'steps' -or $script:taskSetupMode -ne 'pc') { throw 'PC choice did not initiate setup' }
    Task-ChooseSetup 'both'
    if ($script:taskColdStarts -ne 2 -or $script:taskSetupMode -ne 'both') { throw 'PC plus phone choice did not initiate shared PC setup' }
    Set-Item Function:\Task-SaveAndStart $taskOriginalSave
    $script:taskSetupPhase='welcome'; $script:taskSetupViewKey=''; Task-RenderSetup
    $taskBitmap = New-Object Drawing.Bitmap($script:taskSetupOverlay.Width,$script:taskSetupOverlay.Height)
    try { $script:taskSetupOverlay.DrawToBitmap($taskBitmap,(New-Object Drawing.Rectangle(0,0,$taskBitmap.Width,$taskBitmap.Height))); $taskBitmap.Save((Join-Path $taskOutput 'setup-welcome.png'),[Drawing.Imaging.ImageFormat]::Png) } finally { $taskBitmap.Dispose() }
    Task-SetSetupVisible $false
    for ($taskPageIndex = 0; $taskPageIndex -lt 4; $taskPageIndex++) {
        $taskTabs.SelectedIndex = $taskPageIndex
        $taskTabs.SelectedTab.CreateControl(); $taskForm.PerformLayout()
        $taskBitmap = New-Object Drawing.Bitmap($taskForm.Width, $taskForm.Height)
        try {
            $taskForm.DrawToBitmap($taskBitmap, (New-Object Drawing.Rectangle(0, 0, $taskBitmap.Width, $taskBitmap.Height)))
            $taskBitmap.Save((Join-Path $taskOutput ('tab-' + $taskPageIndex + '.png')), [Drawing.Imaging.ImageFormat]::Png)
        } finally { $taskBitmap.Dispose() }
    }
    $taskTabs.SelectedIndex = 1
    # One action at a time, automatic success dismissal, and no false readiness.
    $script:taskConfig = @{ pfxFile = 'fixture.pfx'; caThumbprint = ('A' * 40); port = 3003; controlPort = 3004; allowedOrigins=@($taskDeployment.appOrigin) }
    $script:taskDesiredRunning = $true; $script:taskSetupLastRuntime = Get-Date; $script:taskNetworkWarning = ''; $script:taskNetworkProcess = $null
    $script:taskSetupFacts = @{ certificate = $true; trusted = $false; localHttps = $true; privateNetwork = $true; firewall = 'missing'; lanHttps = $true }
    $script:taskSetupMode = 'both'; $script:taskSetupPhase = 'steps'; $script:taskSetupPcPaired = $true; $script:taskSetupMemberCount = 1; $script:taskRestartPending = $false; $script:taskStopping = $false; $script:taskSetupPhoneCertificate = $true; $script:taskSetupPhonePaired = $true
    Task-RenderSetup
    if ($script:taskSetupActive.id -ne 'trust' -or !$script:taskSetupAction.Enabled) { throw 'Trust must be the single next action' }
    $script:taskSetupOverlay.CreateControl(); $script:taskSetupOverlay.PerformLayout()
    if ($script:taskSetupOverlay.Width -lt 600 -or $script:taskSetupOverlay.Height -lt 400) { throw 'Setup overlay must fill the window' }
    $taskBitmap = New-Object Drawing.Bitmap($script:taskSetupOverlay.Width, $script:taskSetupOverlay.Height)
    try { $script:taskSetupOverlay.DrawToBitmap($taskBitmap, (New-Object Drawing.Rectangle(0, 0, $taskBitmap.Width, $taskBitmap.Height))); $taskBitmap.Save((Join-Path $taskOutput 'setup-trust.png'), [Drawing.Imaging.ImageFormat]::Png) } finally { $taskBitmap.Dispose() }
    $script:taskSetupFacts.trusted = $true; Task-RenderSetup
    if ($script:taskSetupActive.id -ne 'firewall') { throw ('Completed trust must be skipped: ' + $script:taskSetupActive.id + ':' + $script:taskSetupActive.state) }
    $script:taskSetupFacts.firewall = 'ready'; Task-RenderSetup
    if ($script:taskSetupActive) { throw 'Ready setup must offer one final action' }
    $script:taskSetupPhonePaired=$false
    $script:taskSetupPicture.Image=New-Object Drawing.Bitmap(4,4)
    $taskQrImage=$script:taskSetupPicture.Image
    $script:taskSetupQrExpires=[DateTimeOffset]::UtcNow.AddMinutes(10).ToUnixTimeMilliseconds()
    $script:taskSetupQrStamp=Task-ConfigStamp $script:taskConfig
    $script:taskNetworkProcess=[pscustomobject]@{HasExited=$false}
    Task-RenderSetup
    if ($script:taskSetupActive.id -ne 'phone-pair' -or !$taskFlag.Invoke($script:taskSetupPicture,@([int]2))) { throw 'Maintenance must not hide the phone QR' }
    $script:taskSetupFacts.stamp=Task-ConfigStamp $script:taskConfig; $script:taskSetupCheckedAt=Get-Date
    Task-SetupTick
    if ($script:taskSetupPicture.Image -ne $taskQrImage -or !$script:taskSetupQrTime.Text.Contains('QR')) { throw 'Valid QR must remain identical with a countdown' }
    $script:taskConfig.lanAddresses=@('192.168.5.6')
    # Do not spawn an observation worker in this UI fixture.
    Task-SetupTick
    if ($script:taskSetupPicture.Image) { throw 'Changed LAN settings must invalidate an obsolete invitation' }
    $script:taskNetworkProcess=$null
    $script:taskSetupFacts=@{ certificate=$true;trusted=$true;localHttps=$true;privateNetwork=$true;firewall='ready';lanHttps=$true }
    $script:taskSetupPhonePaired=$true
    $script:taskSetupPhase='boot'; $script:taskSetupFacts.stamp=Task-ConfigStamp $script:taskConfig; $script:taskSetupCheckedAt=Get-Date
    Task-SetupTick
    if ($script:taskSetupPhase -ne 'phone-choice' -or $taskFlag.Invoke($script:taskSetupPcButton,@([int]2)) -or !$taskFlag.Invoke($script:taskSetupSkipPhone,@([int]2))) { throw 'Ready PC must offer only phone or skip' }
    $script:taskSetupPhase='boot'; $script:taskConfig.setupCompleted=1
    Task-SetupTick
    if ($script:taskSetupPhase -ne 'overview' -or $taskFlag.Invoke($script:taskSetupOverlay,@([int]2))) { throw 'Completed healthy setup must open overview silently' }
    $script:taskSetupPhase = 'steps'; $script:taskSetupViewKey = ''; Task-RenderSetup
    function Task-Stop { $script:taskOriginStopRequested=$true }
    $taskOriginalOrigins=$script:taskConfig.allowedOrigins
    $script:taskConfig.allowedOrigins=@('https://previous-app.invalid')
    $script:taskSetupFacts.stamp=Task-ConfigStamp $script:taskConfig
    Task-RenderSetup
    if ($script:taskSetupActive.id -ne 'app-origin' -or (Task-PcReady)) { throw 'Old origin must not pass application readiness' }
    Task-SetupAction
    if (!$script:taskOriginStopRequested -or $script:taskPendingConfig.allowedOrigins -notcontains $taskDeployment.appOrigin -or $script:taskPendingConfig.allowedOrigins -notcontains 'https://previous-app.invalid' -or $script:taskConfig.allowedOrigins -contains $taskDeployment.appOrigin) { throw 'Origin approval must stage a graceful restart, retain previous sites and avoid a live config mutation' }
    Remove-Item Function:\Task-Stop
    $script:taskConfig.allowedOrigins=$taskOriginalOrigins; $script:taskPendingConfig=$null; $script:taskRestartPending=$false
    $script:taskSetupFacts=@{certificate=$true;trusted=$true;localHttps=$true;privateNetwork=$true;firewall='ready';lanHttps=$true}
    Task-RenderSetup
    $taskBitmap = New-Object Drawing.Bitmap($script:taskSetupOverlay.Width, $script:taskSetupOverlay.Height)
    try { $script:taskSetupOverlay.DrawToBitmap($taskBitmap, (New-Object Drawing.Rectangle(0, 0, $taskBitmap.Width, $taskBitmap.Height))); $taskBitmap.Save((Join-Path $taskOutput 'setup-ready.png'), [Drawing.Imaging.ImageFormat]::Png) } finally { $taskBitmap.Dispose() }
    $script:taskSetupOverlay.Hide(); $script:taskConfig = $null
    $taskToggle = @($taskOutgoing.Controls | Where-Object { $_ -is [Windows.Forms.CheckBox] })[-1]
    $taskToggle.Checked = $true
    $taskVisibleFlag = [Windows.Forms.Control].GetMethod('GetState', [Reflection.BindingFlags]'Instance,NonPublic')
    if (!$taskVisibleFlag.Invoke($taskOutAdvanced, @([int]2))) { throw 'Professional settings toggle failed' }
    # Read-only firewall diagnosis: same-IP narrow rule vs stale/broadened rule.
    # Shadow the cmdlets in this test process only; never alter Windows rules.
    $script:taskConfig = @{ lanAddress = '192.168.4.2'; port = 3003 }
    $script:taskProgramRoot = 'C:\isolated-node-fixture'
    $script:taskMockRuleIp = '192.168.4.2'; $script:taskMockRuleRemote = @('LocalSubnet')
    function Get-NetIPAddress { [pscustomobject]@{ InterfaceIndex = 6; InterfaceAlias = 'fixture-wifi' } }
    function Get-NetConnectionProfile { [pscustomobject]@{ NetworkCategory = 'Private' } }
    function Get-NetFirewallRule { [pscustomobject]@{ Enabled = 'True'; Direction = 'Inbound'; Action = 'Allow'; Profile = 'Private' } }
    function Get-NetFirewallAddressFilter { [pscustomobject]@{ LocalAddress = @($script:taskMockRuleIp); RemoteAddress = $script:taskMockRuleRemote } }
    function Get-NetFirewallPortFilter { [pscustomobject]@{ Protocol = 'TCP'; LocalPort = @('3003') } }
    function Get-NetFirewallApplicationFilter { [pscustomobject]@{ Program = 'C:\isolated-node-fixture\node.exe' } }
    function Get-NetFirewallInterfaceFilter { [pscustomobject]@{ InterfaceAlias = @('fixture-wifi') } }
    $taskNarrowRuleStatus = Task-FirewallStatus
    $script:taskMockRuleIp = '192.168.4.3'
    if ((Task-FirewallStatus) -eq $taskNarrowRuleStatus) { throw 'Stale firewall IP was treated as matching' }
    $script:taskMockRuleIp = '192.168.4.2'; $script:taskMockRuleRemote = @('LocalSubnet', 'Any')
    if ((Task-FirewallStatus) -eq $taskNarrowRuleStatus) { throw 'Broadened firewall scope was treated as matching' }
    $script:taskConfig = $null
    Write-Output 'Four node tabs, safe defaults, professional toggle and offline-state reset passed; offscreen previews generated.'
} finally {
    if ($taskTimer) { $taskTimer.Dispose() }
    if ($taskTray) { $taskTray.Dispose() }
    if ($taskForm) { $taskForm.Dispose() }
}
