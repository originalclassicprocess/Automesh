import type { ChatService } from '../chat/ChatService';
// Uses ChatService's already authenticated MAE channels, not signaling JSON.
// No legacy envelope validator is changed and no account seed enters this bridge.
export function createDeviceChatBridge(chat: ChatService, reportError: (error: unknown) => void) {
  let closed = false;
  return Object.freeze({
    async sendEncrypted(device: string, packet: string) {
      if (closed) throw new Error('device_bridge_closed');
      await chat.sendDeviceControl('packet', packet, device);
      if (closed) throw new Error('device_bridge_closed');
    },
    listen(receive: (authenticatedPhysicalPeer: string, packet: string) => Promise<void>) {
      chat.onDeviceControl(async (peer, kind, value) => {
        if (closed || kind !== 'packet' || typeof value !== 'string') return;
        try { await receive(peer, value); }
        catch (error) { if (!closed) reportError(error); }
      });
    },
    close() { closed = true; }
  });
}
