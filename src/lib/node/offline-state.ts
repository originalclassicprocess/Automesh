import type { Bundle, NodeAddress, PrivatePrekey } from './offline-crypto';
import {validateKeyLifetime} from './courier-prekeys.js';
import { homeNodeUrl } from './client';
import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { MESSAGE_ID } from '$lib/chat/message-details';
export const MAX_OFFLINE_PENDING = 100;
export const MAX_PENDING_CHARS = 16 * 1024 * 1024;
export type PendingMail = { id: string; messageId: string; peer: string; node: NodeAddress; ciphertext: string; expiresAt: number };
export type PendingAck = { id: string; sender: string; digest: string; receipt: string; expiresAt: number; confirmed?: boolean };
export type OfflineState = { version: 1|2; enabled: boolean; node: NodeAddress | null; keys: PrivatePrekey[];
  bundles: Record<string, Bundle>; used: Record<string, number>; pending: PendingMail[]; acks: PendingAck[] };
export const emptyOfflineState = (): OfflineState => ({ version: 1, enabled: false, node: null, keys: [], bundles: {}, used: {}, pending: [], acks: [] });
// Private keys are only serialized INSIDE the encrypted account record. Never localStorage.
// Fail closed on damaged state; do not silently discard keys for pending ciphertext.
export function restoreOfflineState(value: unknown): OfflineState {
  if (value === undefined) return emptyOfflineState();
  const state = value as OfflineState;
  if (!state || ![1,2].includes(state.version) || typeof state.enabled !== 'boolean' ||
      !Array.isArray(state.keys) || state.keys.length > 1024 || !Array.isArray(state.pending) || state.pending.length > MAX_OFFLINE_PENDING ||
      !Array.isArray(state.acks) || state.acks.length > 2000 || !state.bundles || !state.used ||
      Object.keys(state.bundles).length > 50 || Object.keys(state.bundles).some(id => !isValidAccountId(id)) || Object.keys(state.used).length > 4096 ||
      state.keys.some(key => !/^[a-f0-9]{32}$/.test(key.id) || !/^04[a-f0-9]{128}$/.test(key.publicKey) ||
        typeof key.privateKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.privateKey) || !Number.isSafeInteger(key.expiresAt) ||
        !isValidAccountId(key.peer) || !/^[a-f0-9]{32}$/.test(key.nodeId)) ||
      state.pending.some(item => typeof item.ciphertext !== 'string' || item.ciphertext.length > 175000 || !/^[A-Za-z0-9_-]+$/.test(item.ciphertext) ||
        !/^[a-f0-9]{32}$/.test(item.id) || !isValidAccountId(item.peer) || !MESSAGE_ID.test(item.messageId) ||
        item.messageId.replaceAll('-', '').toLowerCase() !== item.id || !Number.isSafeInteger(item.expiresAt)) ||
      state.pending.reduce((sum, item) => sum + item.ciphertext.length, 0) > MAX_PENDING_CHARS ||
      state.acks.some(item => typeof item.receipt !== 'string' || item.receipt.length > 2048 || !/^[a-f0-9]{32}$/.test(item.id) ||
        !isValidAccountId(item.sender) || !/^[a-f0-9]{64}$/.test(item.digest) || !Number.isSafeInteger(item.expiresAt)) ||
      Object.entries(state.used).some(([id, expiry]) => !/^[a-f0-9]{32}$/.test(id) || !Number.isSafeInteger(expiry))) throw new Error('invalid_offline_state');
  if (state.node && (homeNodeUrl(state.node.url) !== state.node.url || !/^[a-f0-9]{32}$/.test(state.node.nodeId))) throw new Error('invalid_offline_state');
  for (const mail of state.pending) if (homeNodeUrl(mail.node.url) !== mail.node.url || !/^[a-f0-9]{32}$/.test(mail.node.nodeId)) throw new Error('invalid_offline_state');
  for(const key of state.keys)if(key.publishUntil!==undefined)validateKeyLifetime(key.publishUntil,key.expiresAt);
  return structuredClone({...state,version:state.keys.some(k=>k.publishUntil!==undefined)?2:state.version});
}
