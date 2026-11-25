import { isValidAccountId } from '$lib/addressing/bech32m.js';

export const MAX_GROUP_MEMBERS = 10;
export const GROUP_HISTORY = 128;
export const GROUP_KEY_HISTORY = 4;
export const GROUP_CHANGE_HISTORY = 24;
export const GROUP_TEXT_BYTES = 2048;
export const GROUP_PACKET_BYTES = 40 * 1024;
export const GROUP_RECEIPT_BATCH = 24;
export const GROUP_PREFIX = '\u0000automesh-group-v1:';
export const MAX_GROUPS = 12;
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const account = (value: unknown): value is string => typeof value === 'string' && isValidAccountId(value);
export const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const groupTitle = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 60 && !/[\u0000-\u001f\u007f]/.test(value);
export const groupMembers = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length >= 1 && value.length <= MAX_GROUP_MEMBERS &&
  new Set(value).size === value.length && value.every(account);
export const encodedMls = (value: unknown, limit = 28000): value is string =>
  typeof value === 'string' && value.length >= 4 && value.length <= limit && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;

export type GroupProof = { publicKey: string; signature: string };
export type GroupReceipt = GroupProof & { hash: string; by: string; state: 'received' | 'read' };

export function validGroupProof(value: unknown): value is GroupProof {
  if (!value || typeof value !== 'object') return false;
  const { publicKey, signature } = value as GroupProof;
  return encodedMls(publicKey, 88) && publicKey.length === 88 && encodedMls(signature, 88) && signature.length === 88;
}

export function validGroupReceipt(value: unknown): value is GroupReceipt {
  if (!validGroupProof(value)) return false;
  const { by, hash, state } = value as GroupReceipt;
  return account(by) && digest(hash) && (state === 'received' || state === 'read');
}

type ChangeRef = { group: string; epoch: number; change: string };
export type GroupOffer = ChangeRef & { type: 'group-offer'; title: string; owner: string; target: string; members: string[]; proof: GroupProof };
export type GroupPlan = ChangeRef & { type: 'group-plan'; owner: string; target: string; nextOwner: string; members: string[]; key?: string; proof: GroupProof };
export type GroupCommit = ChangeRef & { type: 'group-commit'; packet: string; welcome?: string; proof: GroupProof };
export type GroupReady = ChangeRef & { type: 'group-ready'; by: string; proof: GroupProof };
export type GroupLeave = { type: 'group-leave'; group: string; epoch: number; by: string; proof: GroupProof };
export type MembershipFrame = GroupOffer | GroupPlan | GroupCommit | GroupReady | GroupLeave
  | (ChangeRef & { type: 'group-join'; packet: string });

export const groupEpoch = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;

export type GroupFrame =
  | MembershipFrame
  | { type: 'invite'; group: string; title: string; members: string[] }
  | { type: 'join' | 'welcome'; group: string; packet: string }
  | { type: 'welcome-proof'; group: string; packet: string; proof: GroupProof }
  | { type: 'message'; group: string; packet: string }
  | { type: 'ack'; group: string; hash: string }
  | { type: 'receipts'; group: string; receipts: GroupReceipt[] }
  | { type: 'sync'; group: string; known: string[]; seen?: number[]; hasWelcome?: boolean; epoch?: number };

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
  if (typeof frame.type === 'string' && frame.type.startsWith('group-')) return parseMembershipFrame(frame, group);
  switch (frame.type) {
    case 'invite':
      return groupTitle(frame.title) && groupMembers(frame.members) ? { type:'invite', group, title:frame.title, members:frame.members } : null;
    case 'join':
    case 'welcome':
    case 'message':
      return encodedMls(frame.packet, frame.type === 'message' ? 6000 : 28000) ? { type:frame.type, group, packet:frame.packet } : null;
    case 'welcome-proof':
      return encodedMls(frame.packet) && validGroupProof(frame.proof)
        ? { type:'welcome-proof', group, packet:frame.packet,
          proof:{ publicKey:frame.proof.publicKey, signature:frame.proof.signature } } : null;
    case 'receipts':
      return Array.isArray(frame.receipts) && frame.receipts.length > 0 && frame.receipts.length <= GROUP_RECEIPT_BATCH &&
        frame.receipts.every(validGroupReceipt) ? { type:'receipts', group,
          receipts:frame.receipts.map(({ hash, by, state, publicKey, signature }) => ({ hash, by, state, publicKey, signature })) } : null;
    case 'sync': {
      if (!Array.isArray(frame.known) || frame.known.length > GROUP_HISTORY || !frame.known.every(digest)) return null;
      const seen = frame.seen;
      if (seen === undefined) return { type:'sync', group, known:frame.known };
      if (!Array.isArray(seen) || seen.length !== frame.known.length ||
        !seen.every(mask => Number.isInteger(mask) && mask >= 0 && mask < 2 ** (MAX_GROUP_MEMBERS * 2)) ||
        typeof frame.hasWelcome !== 'boolean') return null;
      return { type:'sync', group, known:frame.known, seen, hasWelcome:frame.hasWelcome, epoch:groupEpoch(frame.epoch) ? frame.epoch : undefined };
    }
    case 'ack':
      return digest(frame.hash) ? { type:'ack', group, hash:frame.hash } : null;
    default: return null;
  }
}

function parseMembershipFrame(frame: Record<string, unknown>, group: string): MembershipFrame | null {
  if (frame.type === 'group-leave') return groupEpoch(frame.epoch) && account(frame.by) && validGroupProof(frame.proof)
    ? { type:frame.type, group, epoch:frame.epoch, by:frame.by, proof:frame.proof } : null;
  if (!groupEpoch(frame.epoch) || !uuid(frame.change)) return null;
  const ref = { group, epoch:frame.epoch, change:frame.change };
  if (frame.type === 'group-join') return encodedMls(frame.packet)
    ? { ...ref, type:frame.type, packet:frame.packet } : null;
  if (!validGroupProof(frame.proof)) return null;
  const proof = { publicKey:frame.proof.publicKey, signature:frame.proof.signature };
  switch (frame.type) {
    case 'group-offer':
      return groupTitle(frame.title) && account(frame.owner) && account(frame.target) &&
        groupMembers(frame.members) && frame.members.includes(frame.owner) && frame.members.includes(frame.target)
        ? { ...ref, type:frame.type, title:frame.title, owner:frame.owner, target:frame.target, members:frame.members, proof } : null;
    case 'group-plan':
      return account(frame.owner) && account(frame.target) && account(frame.nextOwner) &&
        groupMembers(frame.members) && frame.members.includes(frame.nextOwner) &&
        (frame.key === undefined || encodedMls(frame.key))
        ? { ...ref, type:frame.type, owner:frame.owner, target:frame.target, nextOwner:frame.nextOwner,
          members:frame.members, key:frame.key, proof } : null;
    case 'group-commit':
      return encodedMls(frame.packet) && (frame.welcome === undefined || encodedMls(frame.welcome)) &&
        frame.packet.length + (frame.welcome?.length ?? 0) <= GROUP_PACKET_BYTES - 1024
        ? { ...ref, type:frame.type, packet:frame.packet, welcome:frame.welcome, proof } : null;
    case 'group-ready':
      return account(frame.by) ? { ...ref, type:frame.type, by:frame.by, proof } : null;
    default: return null;
  }
}

export function isMembershipFrame(frame: GroupFrame): frame is MembershipFrame {
  return frame.type.startsWith('group-');
}
