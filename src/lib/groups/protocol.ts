import { isValidAccountId } from '$lib/addressing/bech32m.js';

export const MAX_GROUP_MEMBERS = 10;
export const GROUP_HISTORY = 128;
export const GROUP_TEXT_BYTES = 2048;
export const GROUP_PACKET_BYTES = 40 * 1024;
export const GROUP_PREFIX = '\u0000automesh-group-v1:';
export const MAX_GROUPS = 12;
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const groupTitle = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 60 && !/[\u0000-\u001f\u007f]/.test(value);
export const groupMembers = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length >= 2 && value.length <= MAX_GROUP_MEMBERS &&
  new Set(value).size === value.length && value.every(isValidAccountId);
export const encodedMls = (value: unknown, limit = 28000): value is string =>
  typeof value === 'string' && value.length >= 4 && value.length <= limit && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;

export type GroupFrame =
  | { type: 'invite'; group: string; title: string; members: string[] }
  | { type: 'join' | 'welcome'; group: string; packet: string }
  | { type: 'message'; group: string; packet: string }
  | { type: 'ack'; group: string; hash: string }
  | { type: 'sync'; group: string; known: string[] };

// The adapter supplies authenticated Mesh IDs. It owns discovery, framing,
// reconnection and any fragmentation required by its transport.
export interface GroupTransport {
  ready(peer: string): boolean;
  send(peer: string, frame: GroupFrame): Promise<void>;
}

export function parseGroupFrame(value: unknown): GroupFrame | null {
  if (!value || typeof value !== 'object') return null;
  const frame = value as Record<string, unknown>;
  if (!uuid(frame.group)) return null;
  const group = frame.group;
  switch (frame.type) {
    case 'invite':
      return groupTitle(frame.title) && groupMembers(frame.members) ? { type:'invite', group, title:frame.title, members:frame.members } : null;
    case 'join':
    case 'welcome':
    case 'message':
      return encodedMls(frame.packet, frame.type === 'message' ? 6000 : 28000) ? { type:frame.type, group, packet:frame.packet } : null;
    case 'sync':
      return Array.isArray(frame.known) && frame.known.length <= GROUP_HISTORY && frame.known.every(digest)
        ? { type:'sync', group, known:frame.known } : null;
    case 'ack':
      return digest(frame.hash) ? { type:'ack', group, hash:frame.hash } : null;
    default: return null;
  }
}
