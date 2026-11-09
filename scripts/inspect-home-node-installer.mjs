import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = resolve('nodes/.release/home-node'); const directory = join(root, 'inspection'); await mkdir(directory, { recursive: true });
const exe = await readFile(join(root, 'Automesh-Node-Setup.exe'));
const cabOffset = exe.indexOf(Buffer.from('MSCF')); assert.ok(cabOffset >= 0, 'embedded CAB required');
const cabSize = exe.readUInt32LE(cabOffset + 8); const fileCount = exe.readUInt16LE(cabOffset + 28);
assert.ok(cabSize > 0 && cabOffset + cabSize <= exe.length); assert.equal(fileCount, 3);
let offset = cabOffset + exe.readUInt32LE(cabOffset + 16); const members = [];
for (let i = 0; i < fileCount; i++) {
  const end = exe.indexOf(0, offset + 16); assert.ok(end > offset && end < cabOffset + cabSize);
  members.push(exe.toString('ascii', offset + 16, end)); offset = end + 1;
}
assert.deepEqual(members.sort(), ['install.ps1', 'install.vbs', 'payload.zip']);
const cabFile = join(directory, 'installer.cab'); await writeFile(cabFile, exe.subarray(cabOffset, cabOffset + cabSize));
const expanded = spawnSync(join(process.env.WINDIR, 'System32/expand.exe'), ['-F:*', cabFile, directory], { windowsHide: true });
assert.equal(expanded.status, 0, 'CAB extraction, not installer execution');
const q = value => `'${value.replaceAll("'", "''")}'`;
const expected = ['node.exe', 'node.cjs', 'launch.vbs', 'launcher.ps1', 'node-ui.ps1', 'setup.ps1', 'secret-store.ps1', 'firewall.ps1', 'uninstall.vbs', 'uninstall.ps1', 'LICENSE-Node.txt', 'LICENSE-ws.txt', 'LICENSE-qrcode.txt', 'LICENSE-pngjs.txt', 'LICENSE-dijkstrajs.txt', 'LICENSE-Automesh.txt', 'THIRD-PARTY-NOTICES.txt', 'node-build.json'];
const command = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $taskZip = [IO.Compression.ZipFile]::OpenRead(${q(join(directory, 'payload.zip'))}); try { $taskNames = @($taskZip.Entries | ForEach-Object { $_.FullName }); if (@(Compare-Object $taskNames @(${expected.map(q).join(',')})).Count) { throw 'Unexpected payload' }; $taskExe = $taskZip.GetEntry('node.exe'); [IO.Compression.ZipFileExtensions]::ExtractToFile($taskExe, ${q(join(directory, 'verified-node.exe'))}, $true); foreach ($taskEntry in $taskZip.Entries) { if ($taskEntry.FullName.EndsWith('.ps1')) { $taskReader = New-Object IO.StreamReader($taskEntry.Open(), [Text.Encoding]::UTF8); try { $taskTokens = $null; $taskErrors = $null; [Management.Automation.Language.Parser]::ParseInput($taskReader.ReadToEnd(), [ref]$taskTokens, [ref]$taskErrors) | Out-Null; if ($taskErrors) { throw 'Invalid packaged script' } } finally { $taskReader.Dispose() } } } } finally { $taskZip.Dispose() }`;
const checked = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, encoding: 'utf8' });
assert.equal(checked.status, 0, checked.stderr);
const validated = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(directory, 'install.ps1'), '-ValidatePayloadOnly', join(directory, 'payload.zip')], { windowsHide: true, encoding: 'utf8' });
assert.equal(validated.status, 0, 'Packaged validator must check completeness, limits and every program checksum: ' + validated.stderr);
const runtime = JSON.parse(await readFile('nodes/adapters/windows/runtime.json', 'utf8'));
assert.equal(createHash('sha256').update(await readFile(join(directory, 'verified-node.exe'))).digest('hex'), runtime.windowsX64Sha256);
const manifest = JSON.parse(await readFile('nodes/downloads/node-release.json', 'utf8'));
assert.equal(createHash('sha256').update(exe).digest('hex'), manifest.sha256);
process.stdout.write('Installer inspection passed: CAB/payload allowlist, exact official runtime, PowerShell syntax, matching release SHA-256; installer not executed.\n');
