import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { createServer, request } from 'node:https';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'));
const firstRoot = new X509Certificate(await readFile(fixture.first.CaFile));
const secondRoot = new X509Certificate(await readFile(fixture.second.CaFile));
assert.equal(firstRoot.fingerprint256, secondRoot.fingerprint256);
for (const [value, names] of [[fixture.first, ['192.168.2.5', '10.0.0.3']], [fixture.second, ['192.168.2.8']]]) {
  const server = createServer({ pfx: await readFile(value.File), passphrase: value.Password }, (req, res) => res.end('ok'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const get = () => new Promise((resolve, reject) => {
    const req = request(`https://localhost:${server.address().port}`, { host: '127.0.0.1', ca: firstRoot.toString(), family: 4 }, res => {
      const leaf = new X509Certificate(res.socket.getPeerCertificate().raw);
      for (const name of names) assert.equal(leaf.checkIP(name), name);
      assert.equal(leaf.checkHost('localhost'), 'localhost');
      assert.equal(leaf.checkHost('example.com'), undefined);
      assert.equal(leaf.checkIP('8.8.8.8'), undefined);
      res.resume(); res.on('end', resolve);
    }); req.on('error', reject); req.end();
  });
  try { await get(); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const outside = createServer({ pfx: await readFile(fixture.outside.File), passphrase: fixture.outside.Password }, (req, res) => res.end('must-not-accept'));
outside.listen(0, '127.0.0.1'); await once(outside, 'listening');
try {
  await assert.rejects(new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: outside.address().port, servername: 'example.com', ca: firstRoot.toString() }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject); req.end();
  }), error => /permitted subtree|name constraint/i.test(error.message), 'Node TLS must reject an out-of-scope certificate even with a matching hostname');
} finally { outside.closeAllConnections(); await new Promise(resolve => outside.close(resolve)); }
console.log('Persistent root, multi-address TLS renewal and rejection of out-of-scope names validated without installing trust.');
