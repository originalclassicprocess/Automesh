import { expect, it, vi } from 'vitest';
import { adminConnectBridge } from './admin-bridge';
it('relays only a live request to an unlocked tab, without signing or network access', () => {
  const channel = { onmessage: null as any, postMessage: vi.fn(), close: vi.fn() };
  const receive = vi.fn(), elsewhere = vi.fn(); let active = false;
  const bridge = adminConnectBridge(channel as unknown as BroadcastChannel, () => active, receive, elsewhere);
  const link = `https://automesh.space/?nodeAdmin=https://node.example&nodeId=${'a'.repeat(32)}&ticket=${'b'.repeat(32)}&expiresAt=${Date.now() + 120000}`;
  channel.onmessage({ data: { type: 'node-admin-request', url: link } }); expect(receive).not.toHaveBeenCalled();
  active = true; channel.onmessage({ data: { type: 'node-admin-request', url: 'seed' } }); expect(receive).not.toHaveBeenCalled();
  channel.onmessage({ data: { type: 'node-admin-request', url: link } }); expect(receive).toHaveBeenCalledTimes(1);
  expect(channel.postMessage).toHaveBeenCalledWith({ type: 'node-admin-received', ticket: 'b'.repeat(32) });
  bridge.close(); expect(channel.close).toHaveBeenCalledOnce();
});
