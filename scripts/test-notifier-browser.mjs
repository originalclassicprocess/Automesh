import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { createSignalingServer } from '../server/signaling.js';
import { senderIdentity } from '../plugins/automesh-notifier/dist/identity.mjs';
import { startBrowserClient } from '../plugins/automesh-notifier/server/browser.mjs';

// Two ephemeral accounts and the real signed signaling/WebRTC/E2EE stack.
// No production recipient, main account data or server deployment involved.
const http = createServer((_request, response) => { response.writeHead(404); response.end(); });
http.listen(0, '127.0.0.1'); await once(http, 'listening');
const appUrl = `http://127.0.0.1:${http.address().port}/`;
const server = createSignalingServer({ httpServer: http, path: '/signal', allowedOrigins: [new URL(appUrl).origin], iceMode: 'lan' });
const aliceSeed = randomBytes(32), bobSeed = randomBytes(32);
const aliceIdentity = await senderIdentity(new Uint8Array(aliceSeed));
const bobIdentity = await senderIdentity(new Uint8Array(bobSeed));
const base = { appUrl, browser: process.env.AUTOMESH_TEST_BROWSER || 'auto' };
let alice, bob;
try {
  bob = await startBrowserClient({ ...base, sender: bobIdentity.address, recipient: aliceIdentity.address }, bobSeed);
  alice = await startBrowserClient({ ...base, sender: aliceIdentity.address, recipient: bobIdentity.address }, aliceSeed);
  const messageId = randomUUID();
  const text = 'Тест завершения задачи: шифрование и подтверждение';
  const result = await alice.send({ text, messageId });
  assert.deepEqual(result, { messageId, status: 'delivered' });
  const received = await bob.page.evaluate(() => globalThis.automeshClient.takeIncoming());
  assert.equal(received.length, 1); assert.equal(received[0].text, text);
  assert.equal(received[0].verified, true); assert.equal(received[0].id, messageId);
  assert.equal(received[0].from, aliceIdentity.address);
  // Real destination isolation: trying a different recipient is not exposed
  // through the runtime's send API; sender identity mismatch also closes it.
  console.log('Browser integration passed: signed registration, real WebRTC, E2EE, recipient receipt and verified text.');
} finally {
  aliceSeed.fill(0); bobSeed.fill(0);
  aliceIdentity.provider.dispose(); bobIdentity.provider.dispose();
  await alice?.close(); await bob?.close();
  for (const socket of server.clients) socket.terminate();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => http.close(resolve));
}
