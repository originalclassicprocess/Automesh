import { spawnSync } from 'node:child_process';
import { createPrivateKey, randomBytes, X509Certificate } from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createTcpServer, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildVite, createServer as createViteServer, preview as previewVite } from 'vite';
import { createSignalingRegistry, createSignalingServer } from '../server/signaling.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const certDir = join(projectRoot, '.local-certs');
const caKeyPath = join(certDir, 'ca-key.pem');
const caCertPath = join(certDir, 'ca.pem');
const caInstallPath = join(certDir, 'ca.crt');
const leafKeyPath = join(certDir, 'lan-key.pem');
const leafCertPath = join(certDir, 'lan.pem');
const csrPath = join(certDir, 'lan.csr');
const extPath = join(certDir, 'lan.ext');

function privateIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function lanAddresses() {
  return [...new Set(Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? []).filter((entry) => entry.family === 'IPv4' && !entry.internal && privateIPv4(entry.address))
      .map((entry) => entry.address),
  ))];
}

function chooseHost() {
  const available = lanAddresses();
  const requested = process.argv.slice(2).find((argument) => !argument.startsWith('--')) || process.env.MESH_LAN_HOST;
  if (requested) {
    if (!available.includes(requested)) {
      throw new Error(`LAN host ${requested} is not a private IPv4 address on this computer. Available: ${available.join(', ') || 'none'}`);
    }
    return requested;
  }
  if (available.length === 1) return available[0];
  throw new Error(`Choose a LAN address: npm run lan -- <IP>. Available: ${available.join(', ') || 'none'}`);
}

function choosePort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LAN ports must be between 1024 and 65535');
  return port;
}

async function checkPort(host, port) {
  const probe = createTcpServer();
  await new Promise((resolveProbe, rejectProbe) => {
    probe.once('error', (error) => rejectProbe(new Error(`Port ${host}:${port} is unavailable (${error.code}). Stop the previous server on this port before starting this command.`)));
    probe.listen(port, host, () => probe.close(resolveProbe));
  });
}

function openSslBinary() {
  const candidates = [
    process.env.OPENSSL_BIN,
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
  ].filter(Boolean);
  for (const binary of candidates) {
    const result = spawnSync(binary, ['version'], { encoding: 'utf8', windowsHide: true });
    if (result.status === 0) return binary;
  }
  throw new Error('OpenSSL not found. Install OpenSSL or set OPENSSL_BIN to its executable path.');
}

function runOpenSsl(binary, args) {
  const result = spawnSync(binary, args, { cwd: certDir, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`OpenSSL failed: ${result.stderr?.trim() || result.error?.message || 'unknown error'}`);
}

function ensureCertificates(host) {
  mkdirSync(certDir, { recursive: true, mode: 0o700 });
  if (existsSync(caKeyPath) !== existsSync(caCertPath)) {
    throw new Error('Incomplete local CA in .local-certs; inspect it before retrying.');
  }
  let binary;
  if (!existsSync(caCertPath)) {
    binary = openSslBinary();
    runOpenSsl(binary, [
      'req', '-x509', '-newkey', 'rsa:3072', '-sha256', '-days', '365', '-nodes',
      '-keyout', caKeyPath, '-out', caCertPath, '-subj', '/CN=MeshAutonomy LAN Test CA',
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    ]);
    console.log(`Created a local test CA: ${caCertPath}`);
  }
  let reusable = false;
  if (existsSync(leafKeyPath) && existsSync(leafCertPath)) {
    try {
      const leaf = new X509Certificate(readFileSync(leafCertPath));
      const ca = new X509Certificate(readFileSync(caCertPath));
      reusable = Boolean(leaf.checkIP(host)) &&
        Date.parse(leaf.validTo) > Date.now() + 24 * 60 * 60 * 1000 &&
        leaf.checkPrivateKey(createPrivateKey(readFileSync(leafKeyPath))) &&
        leaf.verify(ca.publicKey);
    } catch { /* Regenerate incomplete or invalid generated leaf files. */ }
  }
  if (!reusable) {
    binary ??= openSslBinary();
    writeFileSync(extPath, [
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      `subjectAltName=IP:${host},IP:127.0.0.1,DNS:localhost`,
      '',
    ].join('\n'));
    runOpenSsl(binary, [
      'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', leafKeyPath,
      '-out', csrPath, '-subj', '/CN=MeshAutonomy LAN Test',
    ]);
    runOpenSsl(binary, [
      'x509', '-req', '-in', csrPath, '-CA', caCertPath, '-CAkey', caKeyPath,
      '-set_serial', `0x${randomBytes(16).toString('hex')}`,
      '-out', leafCertPath, '-days', '30', '-sha256', '-extfile', extPath,
    ]);
    runOpenSsl(binary, ['verify', '-CAfile', caCertPath, leafCertPath]);
  }
  copyFileSync(caCertPath, caInstallPath);
  try { chmodSync(caKeyPath, 0o600); chmodSync(leafKeyPath, 0o600); } catch { /* Windows ACLs differ. */ }
  return {
    key: readFileSync(leafKeyPath),
    cert: readFileSync(leafCertPath),
  };
}

async function main() {
  const flags = process.argv.slice(2).filter((argument) => argument.startsWith('--'));
  if (flags.some((flag) => !['--pwa', '--app-only', '--signal-only'].includes(flag))) {
    throw new Error(`Unknown LAN option: ${flags.join(', ')}`);
  }
  const appOnly = flags.includes('--app-only');
  const signalOnly = flags.includes('--signal-only');
  const pwaMode = flags.includes('--pwa');
  if ((appOnly && signalOnly) || (appOnly && !pwaMode) || (signalOnly && pwaMode)) {
    throw new Error('Use either --pwa --app-only or --signal-only');
  }
  const host = chooseHost();
  const appPort = choosePort(process.env.MESH_LAN_APP_PORT, 5174);
  const signalPort = choosePort(process.env.MESH_LAN_SIGNAL_PORT, 3002);
  const localSignalPort = choosePort(process.env.MESH_LAN_LOCAL_SIGNAL_PORT, 3001);
  const localAppPort = choosePort(process.env.MESH_LOCAL_APP_PORT, 5173);
  if (new Set([appPort, signalPort, localSignalPort, localAppPort]).size !== 4) {
    throw new Error('App and signaling ports must differ');
  }
  // Refuse an occupied port before replacing a running preview's build files.
  if (!signalOnly) await checkPort(host, appPort);
  if (pwaMode) await checkPort('127.0.0.1', localAppPort);
  if (!appOnly) {
    await checkPort(host, signalPort);
    await checkPort('127.0.0.1', localSignalPort);
  }
  const tls = ensureCertificates(host);
  const appUrl = `https://${host}:${appPort}`;
  const signalUrl = `wss://${host}:${signalPort}/signal`;

  const localAppUrl = `http://localhost:${localAppPort}`;
  process.env.MESH_RUNTIME_SIGNAL_URL = signalUrl;
  process.env.MESH_RUNTIME_LOCAL_SIGNAL_URL = `ws://127.0.0.1:${localSignalPort}`;
  process.env.MESH_RUNTIME_LAN_SIGNAL_URL = signalUrl;
  const extraOrigins = (process.env.MESH_APP_ORIGINS || '').split(',').filter(Boolean).map((value) => {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.origin !== value.trim()) throw new Error('MESH_APP_ORIGINS requires exact HTTPS origins');
    return url.origin;
  });
  const allowedOrigins = [appUrl, localAppUrl, `http://127.0.0.1:${localAppPort}`, ...extraOrigins];
  const proxy = { '/signal': { target: `ws://127.0.0.1:${localSignalPort}`, ws: true } };

  if (pwaMode) await buildVite({ root: projectRoot });
  const vite = signalOnly ? null : pwaMode
    ? await previewVite({ root: projectRoot, preview: { host, port: appPort, strictPort: true, https: tls, proxy } })
    : await createViteServer({
      root: projectRoot,
      server: {
        host, port: appPort, strictPort: true, https: tls, proxy,
        fs: {
          deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local-certs/**'],
        },
      },
    });
  let localVite;
  const tlsServer = appOnly ? null : createHttpsServer(tls, (_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const registry = appOnly ? null : createSignalingRegistry();
  const signaling = appOnly ? null : createSignalingServer({
    httpServer: tlsServer,
    path: '/signal',
    allowedOrigins,
    allowDiagnosticPeers: false,
    registry,
    iceMode: 'lan',
  });
  // ws forwards listen errors from its underlying HTTPS server. Without a
  // listener, a second `npm run lan` exits with an unhandled error instead of
  // reporting which port is already occupied.
  signaling?.on('error', (error) => {
    console.error(`[lan] signaling server error: ${error.message}`);
  });

  let localSignaling;
  const closeSignaling = async (server) => {
    if (!server) return;
    for (const client of server.clients) client.terminate();
    await new Promise((resolveClose) => server.close(() => resolveClose()));
  };

  try {
    if (tlsServer) await new Promise((resolveListen, rejectListen) => {
      const onError = (error) => {
        tlsServer.off('listening', onListening);
        rejectListen(error);
      };
      const onListening = () => {
        tlsServer.off('error', onError);
        resolveListen();
      };
      tlsServer.once('error', onError);
      tlsServer.once('listening', onListening);
      tlsServer.listen(signalPort, host);
    });
    if (vite && !pwaMode) await vite.listen();
    if (pwaMode) localVite = await previewVite({
      root: projectRoot,
      preview: { host: '127.0.0.1', port: localAppPort, strictPort: true, https: false, proxy },
    });
    // Both entry points use one in-memory peer registry. The local endpoint
    // remains loopback-only, and neither endpoint stores chat messages.
    if (tlsServer) localSignaling = createSignalingServer({
      port: localSignalPort,
      host: '127.0.0.1',
      allowedOrigins,
      allowDiagnosticPeers: false,
      registry,
      iceMode: 'lan',
    });
    localSignaling?.on('error', (error) => {
      console.error(`[lan] local signaling error: ${error.message}`);
    });
    if (localSignaling) await new Promise((resolveListen, rejectListen) => {
      localSignaling.once('listening', resolveListen);
      localSignaling.once('error', rejectListen);
    });
  } catch (error) {
    await closeSignaling(localSignaling);
    await closeSignaling(signaling);
    await vite?.close();
    await localVite?.close();
    if (tlsServer?.listening) await new Promise((resolveClose) => tlsServer.close(resolveClose));
    throw error;
  }

  if (vite) console.log(`LAN app${pwaMode ? ' (PWA production build)' : ''}: ${appUrl}/`);
  if (localVite) console.log(`Same app on this PC: ${localAppUrl}/`);
  if (signaling) {
    console.log(`LAN signaling: ${signalUrl}`);
    console.log(`Loopback signaling (same peer registry): ws://127.0.0.1:${localSignalPort} (http://localhost:5173/ via npm run dev or local:pwa)`);
  }
  console.log(`Install/trust this public CA certificate on test devices: ${caInstallPath}`);
  console.log(`CA SHA-256 fingerprint: ${new X509Certificate(readFileSync(caCertPath)).fingerprint256}`);
  console.log('Never copy ca-key.pem or lan-key.pem to another device.');
  console.log('LAN mode uses local ICE candidates only; no Google STUN.');

  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    await closeSignaling(localSignaling);
    await closeSignaling(signaling);
    await vite?.close();
    await localVite?.close();
    if (tlsServer?.listening) await new Promise((resolveClose) => tlsServer.close(resolveClose));
  }
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

main().catch((error) => {
  console.error(`[lan] ${error.message}`);
  process.exitCode = 1;
});
