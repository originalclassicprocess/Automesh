import { spawn } from 'node:child_process';

// Windows DPAPI CurrentUser; secrets travel via stdin, never command arguments.
// Both the seed and local notification queue are encrypted at rest.
const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$bytes = [Convert]::FromBase64String($request.value)
try {
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($request.action -eq 'protect') {
    $result = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
  } else {
    $result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
  }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} finally { [Array]::Clear($bytes, 0, $bytes.Length) }
`;
async function transform(action, value) {
  if (process.platform !== 'win32') throw new Error('windows_dpapi_required');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('secret_store_timeout')); }, 10000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume(); // Never leak platform errors that might include input.
    child.on('error', () => { clearTimeout(timer); reject(new Error('secret_store_unavailable')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(output.trim())) return reject(new Error('secret_store_failed'));
      resolve(Buffer.from(output.trim(), 'base64'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ action, value: Buffer.from(value).toString('base64') }));
  });
}
export const protect = value => transform('protect', value);
export const unprotect = value => transform('unprotect', value);
