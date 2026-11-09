$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\nodes\adapters\windows\secret-store.ps1')
$taskSource = Join-Path $PSScriptRoot '..\nodes\adapters\windows\launcher.ps1'
$taskTokens = $null; $taskErrors = $null
$taskAst = [Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($taskSource, [Text.Encoding]::UTF8), [ref]$taskTokens, [ref]$taskErrors)
if ($taskErrors.Count) { throw 'Launcher syntax error' }
$taskFunction = $taskAst.Find({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Task-WriteConfig' }, $true)
if (!$taskFunction) { throw 'Configuration writer not found' }
. ([ScriptBlock]::Create($taskFunction.Extent.Text))
$taskReaderFunction = $taskAst.Find({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Task-ReadConfig' }, $true)
. ([ScriptBlock]::Create($taskReaderFunction.Extent.Text))
$taskTestDirectory = Join-Path ([IO.Path]::GetTempPath()) ('automesh-launcher-test-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($taskTestDirectory)
$script:taskConfigFile = Join-Path $taskTestDirectory 'config.json'
try {
    # A predictable pre-existing .new file must never be opened/overwritten.
    [IO.File]::WriteAllText($script:taskConfigFile + '.new', 'untouched fixture sentinel')
    foreach ($taskRevision in 1,2,3) {
        # Regression: launcher reapplies ACL on each start under a normal user.
        # The old Set-Acl/owner path failed on the second call (SeSecurityPrivilege).
        Set-TaskPrivateDirectory $taskTestDirectory
        $taskAcl = [IO.Directory]::GetAccessControl($taskTestDirectory)
        if (!$taskAcl.AreAccessRulesProtected -or @($taskAcl.Access).Count -ne 2) { throw 'Private directory ACL changed' }
        Task-WriteConfig @{ version = 1; revision = $taskRevision; nickname = 'test'; adminToken = ('a' * 64); pfxPassword = 'isolated-test-password' }
        $taskSaved = [IO.File]::ReadAllText($script:taskConfigFile) | ConvertFrom-Json
        if ($taskSaved.revision -ne $taskRevision -or $script:taskConfig.revision -ne $taskRevision) { throw 'Configuration update failed' }
        if ($taskSaved.version -ne 2 -or $taskSaved.adminToken -or $taskSaved.pfxPassword) { throw 'Plaintext secret leaked' }
        $taskOpened = Task-ReadConfig
        if ($taskOpened.adminToken -ne ('a' * 64) -or $taskOpened.pfxPassword -ne 'isolated-test-password') { throw 'DPAPI reload failed' }
        if ([IO.File]::ReadAllText($script:taskConfigFile + '.new') -ne 'untouched fixture sentinel') { throw 'Predictable temporary target was modified' }
        if (@(Get-ChildItem -LiteralPath $taskTestDirectory -Filter 'config-*.new').Count) { throw 'Uncommitted random configuration remains' }
    }
    $taskLegacy = @{ version = 1; revision = 4; adminToken = ('b' * 64); pfxPassword = 'migration-test-password' }
    [IO.File]::WriteAllText($script:taskConfigFile, ($taskLegacy | ConvertTo-Json))
    $taskOpened = Task-ReadConfig
    $taskMigrated = [IO.File]::ReadAllText($script:taskConfigFile)
    if ($taskOpened.adminToken -ne ('b' * 64) -or $taskMigrated.Contains('migration-test-password') -or ($taskMigrated | ConvertFrom-Json).version -ne 2) { throw 'Migration failed' }
    Write-Output 'Launcher DPAPI protection, reload, migration and repeated atomic saves passed.'
} finally {
    # Delete only these two known temporary test files, never user configuration.
    [IO.File]::Delete($script:taskConfigFile)
    [IO.File]::Delete($script:taskConfigFile + '.new')
    [IO.Directory]::Delete($taskTestDirectory)
}
