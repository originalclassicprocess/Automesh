import type { SignedObject } from '../core/objects';
import type { ChatEntry, SessionChats } from '../chat/session-chats';
import { encodeChatContent, decodeChatContent } from '../chat/message-details';
import { isValidAccountId } from '../addressing/bech32m.js';
import { activeMembers, type MembershipBody } from './membership';
import type { DeviceEvent } from './delivery';

export type DeviceCopyKind = 'own' | 'peer';
export type DeviceCopyJob = { peer: string; id: string; kind: DeviceCopyKind; incoming: boolean; text: string; timestamp: number };
const PREFIX = '\0automesh-own-incoming-v1:';
const encoder = new TextEncoder();

// Verified local statements are only a scheduling hint. The delivery runtime
// independently obtains fresh authorization before sending any copy.
export function deviceCopyKinds(self: string, peer: string, incoming: boolean, rosters: SignedObject[]): DeviceCopyKind[] {
  const hasDevices = (owner: string) => {
    const roster = rosters.find(value => value.record.author === owner);
    if (!roster) return false;
    try { return activeMembers(roster.record.body as unknown as MembershipBody, Date.now()).length > 0; }
    catch { return false; }
  };
  return [...(hasDevices(self) ? ['own' as const] : []), ...(!incoming && peer !== self && hasDevices(peer) ? ['peer' as const] : [])];
}

export function deviceCopyJobs(chats: SessionChats, self: string): DeviceCopyJob[] {
  const result: DeviceCopyJob[] = [];
  for (const peer of chats.order) for (const message of chats.byPeer[peer].messages) {
    if (result.length >= 32) return result;
    if (!message.deviceCopies?.length || message.restoredFromBackup || message.deviceMessage || message.file || message.localCall ||
      message.details?.ephemeral || message.details?.ephemeralOpened || message.details?.pin || peer === self ||
      chats.byPeer[peer].contact !== 'accepted') continue;
    const content = encodeChatContent(message.text, message.details);
    const text = message.direction === 'incoming' ? PREFIX + JSON.stringify({ peer, content, timestamp: message.timestamp }) : content;
    if (!text || encoder.encode(text).length > 4096) continue;
    for (const kind of message.deviceCopies) if (kind === 'own' || message.direction === 'outgoing')
      result.push({ peer, id: message.id, kind, incoming: message.direction === 'incoming', text, timestamp: message.timestamp });
  }
  return result;
}

// The physical owner can attest a copy of its ordinary incoming history to its
// own devices. A delegated sender cannot manufacture such an owner attestation.
export function readOwnIncoming(event: DeviceEvent, owner: string): { peer: string; content: string; timestamp: number } | null {
  if (!event.text.startsWith(PREFIX)) return null;
  if (event.from !== owner || event.to !== owner || event.authorDevice !== owner || encoder.encode(event.text).length > 4096)
    throw new Error('device_incoming_copy_denied');
  const value = JSON.parse(event.text.slice(PREFIX.length));
  if (!value || Object.keys(value).sort().join(',') !== 'content,peer,timestamp' || !isValidAccountId(value.peer) || value.peer === owner ||
    typeof value.content !== 'string' || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0) throw new Error('device_incoming_copy_denied');
  const decoded = decodeChatContent(value.content);
  if (!decoded || decoded.details?.ephemeral || decoded.details?.ephemeralOpened || decoded.details?.pin) throw new Error('device_incoming_copy_denied');
  return value;
}

export function withoutDeviceCopy(message: ChatEntry, kind: DeviceCopyKind): ChatEntry {
  const next = { ...message, deviceCopies: message.deviceCopies?.filter(value => value !== kind) };
  if (!next.deviceCopies?.length) delete next.deviceCopies;
  return next;
}
