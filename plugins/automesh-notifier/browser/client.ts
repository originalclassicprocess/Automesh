import { ChatService, type ChatMessage } from '../../../src/lib/chat/ChatService';
import { WebRTCTransport } from '../../../src/lib/transport/WebRTCTransport';
import { senderIdentity, isValidAccountId } from './identity';

// Private browser context. No UI, account vault, incoming-text tool or arbitrary
// eval tool is exposed to the model. This code reuses the current chat protocol.
export async function openClient(seedBytes: number[], signalingUrl: string, recipient: string) {
  if (!isValidAccountId(recipient)) throw new Error('invalid_recipient');
  const seed = new Uint8Array(seedBytes);
  seedBytes.fill(0);
  const identity = await senderIdentity(seed).finally(() => seed.fill(0));
  const transport = new WebRTCTransport(signalingUrl, { admitPeer: peer => peer === recipient });
  const chat = new ChatService(transport);
  const receipts = new Map<string, () => void>();
  // Used only by the local integration test, never returned by the MCP server.
  const incoming: ChatMessage[] = [];
  chat.onMessage(msg => { if (msg.from === recipient) { incoming.push(msg); if (incoming.length > 16) incoming.shift(); } });
  chat.onReceipt((peer, id) => { if (peer === recipient) receipts.get(id)?.(); });
  try { await chat.init(identity); }
  catch (error) { await chat.disconnect(); identity.provider.dispose(); throw error; }
  return {
    address: identity.address,
    async send(text: string, id: string, timeoutMs = 25000) {
      let timer: ReturnType<typeof setTimeout>;
      const received = new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('delivery_unconfirmed')), timeoutMs);
        receipts.set(id, resolve);
      });
      // Attach a rejection handler before connection/handshake awaits.
      void received.catch(() => {});
      try {
        await chat.connect(recipient);
        await chat.send(text, recipient, id);
        await received;
        return { messageId: id, status: 'delivered' };
      } finally { clearTimeout(timer!); receipts.delete(id); }
    },
    getStatus: () => ({ address: identity.address, transport: transport.getStatus() }),
    takeIncoming: () => incoming.splice(0),
    async close() { try { await chat.disconnect(); } finally { identity.provider.dispose(); } },
  };
}
