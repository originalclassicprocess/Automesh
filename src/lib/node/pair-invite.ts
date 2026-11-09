import { homeNodeUrl } from './client';
import { parseSignalingNode } from '$lib/transport/network-settings';
export type PairInvite = { protocol: 'automesh-node-pair-v1'; url: string; nodeId: string; code: string; expiresAt: number };
export function parsePairInvite(text: string, now = Date.now()): PairInvite {
  if (typeof text !== 'string' || text.length > 1024) throw new Error('invalid_pair_invite');
  let raw: PairInvite;
  try { raw = JSON.parse(text); } catch { throw new Error('invalid_pair_invite'); }
  if (!raw || raw.protocol !== 'automesh-node-pair-v1' || typeof raw.url !== 'string' ||
      !/^[a-f0-9]{32}$/.test(raw.nodeId) || !/^[a-f0-9]{32}$/.test(raw.code) ||
      !Number.isSafeInteger(raw.expiresAt) || raw.expiresAt <= now || raw.expiresAt > now + 10 * 60_000 ||
      Object.keys(raw).sort().join(',') !== 'code,expiresAt,nodeId,protocol,url') throw new Error('invalid_pair_invite');
  return { ...raw, url: homeNodeUrl(raw.url) };
}
// Both QR codes shown by the node work in its setup screen. A signaling QR
// contains no authorization: a new profile still needs a one-time pair code.
export function parseNodeSetup(text: string): { url: string; code: string; nodeId: string } {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('invalid_node_url');
  const value = text.trim();
  if (value.startsWith('{') && JSON.parse(value)?.protocol === 'automesh-node-pair-v1') {
    const invite = parsePairInvite(value); return { url: invite.url, code: invite.code, nodeId: invite.nodeId };
  }
  if (value.startsWith('wss:') || value.startsWith('{')) {
    const signaling = new URL(parseSignalingNode(value, 'https://app.invalid/').url);
    if (signaling.pathname !== '/signal') throw new Error('invalid_node_url');
    signaling.protocol = 'https:'; signaling.pathname = '/';
    return { url: homeNodeUrl(signaling.href), code: '', nodeId: '' };
  }
  return { url: homeNodeUrl(value), code: '', nodeId: '' };
}
