import { parseAdminConnect, type AdminConnect } from './admin-connect';
// Same-origin tab coordination, not an authentication boundary. The receiving
// tab still shows an explicit consent dialog; this channel can never sign.
export function adminConnectBridge(channel: BroadcastChannel, active: () => boolean,
  receive: (request: AdminConnect) => void, receivedElsewhere: (ticket: string) => void) {
  channel.onmessage = event => {
    const value = event.data;
    if (value?.type === 'node-admin-request' && typeof value.url === 'string' && value.url.length <= 2048 && active()) {
      try { const request = parseAdminConnect(value.url); if (request) { receive(request); channel.postMessage({ type: 'node-admin-received', ticket: request.ticket }); } } catch { /* Invalid/expired requests cannot open a dialog. */ }
    } else if (value?.type === 'node-admin-received' && typeof value.ticket === 'string' && /^[a-f0-9]{32}$/.test(value.ticket)) receivedElsewhere(value.ticket);
  };
  return { send: (url: string) => channel.postMessage({ type: 'node-admin-request', url }), close: () => channel.close() };
}
