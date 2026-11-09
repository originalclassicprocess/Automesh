import {validateQueueSource,type QueueSource,type CourierBundle,type CourierJob,type CourierKey} from './courier-crypto';
import type { NodeAddress } from './offline-crypto';
import { homeNodeUrl } from './client';
import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { courierId, COURIER_MAX_PACKET, COURIER_TTL } from './courier-protocol.js';
import { validateManifest, type AttachmentManifest } from './attachment-crypto';
import type { CourierHop } from './courier-crypto';
import { validateAttachment } from './attachment-protocol.js';
import {MAX_PRIVATE_COURIER_KEYS,validateKeyLifetime,validateKeySource} from './courier-prekeys.js';
export type IncomingAttachment = { job: CourierJob; hop: CourierHop; manifest: AttachmentManifest; nextIndex: number; source?:QueueSource };
export type CourierState = { version: 1|2|3; enabled: boolean; node: (NodeAddress & { address: string }) | null;
  keys: CourierKey[]; bundles: Record<string, CourierBundle>; used: Record<string, number>;
  pending: CourierJob[]; acks: { id: string; sender: string; digest: string; receipt: string; expiresAt: number }[];
  outgoingFiles: Record<string, AttachmentManifest>; incomingFiles: IncomingAttachment[] };
export const emptyCourierState = (): CourierState => ({ version: 1, enabled: false, node: null, keys: [], bundles: {}, used: {}, pending: [], acks: [], outgoingFiles: {}, incomingFiles: [] });
// Used by history/file cleanup as well as migration; never leave an orphaned
// file key pointing at a removed pending job in the next encrypted snapshot.
export function pruneCourierFiles(s: CourierState, remove?: (peer: string, id: string) => boolean): CourierState {
  const pending = s.pending.filter(j => !remove?.(j.body.to, j.body.id));
  return { ...s, pending, outgoingFiles: Object.fromEntries(Object.entries(s.outgoingFiles ?? {}).filter(([id]) => pending.some(j => j.body.id === id))),
    incomingFiles: (s.incomingFiles ?? []).filter(r => !remove?.(r.job.body.from, r.job.body.id)) };
}
// Only part of the encrypted account record, never plaintext browser settings.
export function restoreCourierState(value: unknown): CourierState {
  if (value === undefined) return emptyCourierState();
  if (!value || typeof value !== 'object') throw new Error('invalid_courier_state');
  const raw = structuredClone(value as CourierState);
  const s = { ...raw, outgoingFiles: raw.outgoingFiles ?? {}, incomingFiles: raw.incomingFiles ?? [] };
  if (!s || ![1,2,3].includes(s.version) || typeof s.enabled !== 'boolean' || !Array.isArray(s.keys) || s.keys.length > MAX_PRIVATE_COURIER_KEYS ||
      !Array.isArray(s.pending) || s.pending.length > 100 || !Array.isArray(s.acks) || s.acks.length > 2000 ||
      !s.bundles || !s.used || Object.keys(s.bundles).length > 50 || Object.keys(s.bundles).some(id => !isValidAccountId(id)) ||
      Object.keys(s.used).length > 4096 || Object.entries(s.used).some(([id, expiry]) => !/^[a-f0-9]{32}$/.test(id) || !Number.isSafeInteger(expiry)) ||
      s.keys.some(k => !/^[a-f0-9]{32}$/.test(k.id) || !/^04[a-f0-9]{128}$/.test(k.publicKey) ||
        !/^[A-Za-z0-9_-]{43}$/.test(k.privateKey) || !isValidAccountId(k.peer) || !Number.isSafeInteger(k.expiresAt)) ||
      s.pending.some(j => !j?.body || !courierId(j.body.id) || !isValidAccountId(j.body.from) || !isValidAccountId(j.body.to) ||
        !isValidAccountId(j.body.courier) || !Number.isSafeInteger(j.body.expiresAt) || typeof j.body.packet !== 'string' ||
        j.body.packet.length > COURIER_MAX_PACKET || !/^[A-Za-z0-9_-]+$/.test(j.body.packet) ||
        !/^04[a-f0-9]{128}$/.test(j.publicKey) || !/^[a-f0-9]{128}$/.test(j.signature)) ||
      s.acks.some(a => !courierId(a.id) || !isValidAccountId(a.sender) || !/^[a-f0-9]{64}$/.test(a.digest) ||
        typeof a.receipt !== 'string' || a.receipt.length > 2048 || !Number.isSafeInteger(a.expiresAt))) throw new Error('invalid_courier_state');
  if (s.node && (homeNodeUrl(s.node.url) !== s.node.url || !/^[a-f0-9]{32}$/.test(s.node.nodeId) || !isValidAccountId(s.node.address))) throw new Error('invalid_courier_state');
  for(const k of s.keys){
    if(k.retired!==undefined&&k.retired!==true)throw Error('invalid_courier_state');
    if(k.publishUntil!==undefined)validateKeyLifetime(k.publishUntil,k.expiresAt);
    if(k.directory!==undefined){validateKeySource(k.directory);if(!Number.isSafeInteger(k.issuedAt)||k.issuedAt!<0||k.publishUntil!==k.issuedAt!+COURIER_TTL)throw Error('invalid_courier_state');}
  }
  // Old readers must not accidentally publish directory keys as direct keys or
  // discard retained private keys on their former publication expiry.
  if(s.keys.some(k=>k.retired))s.version=3;
  else if(s.keys.some(k=>k.publishUntil!==undefined||k.directory!==undefined))s.version=Math.max(2,s.version) as 2|3;
  if (!s.outgoingFiles || Array.isArray(s.outgoingFiles) || Object.keys(s.outgoingFiles).length > 16 || !Array.isArray(s.incomingFiles) || s.incomingFiles.length > 16) throw new Error('invalid_courier_files');
  for (const [id, m] of Object.entries(s.outgoingFiles)) {
    const job = s.pending.find(j => j.body.id === id); if (!job?.body.attachment) throw new Error('invalid_courier_files');
    validateManifest(m, job.body.from, job.body.to, id);
    if (JSON.stringify(m.attachment) !== JSON.stringify(validateAttachment(job.body.attachment))) throw new Error('invalid_courier_files');
  }
  const incomingIds = new Set();
  for (const r of s.incomingFiles) {
    if(r.source){validateQueueSource(r.source,r.job?.body?.from,r.job?.body?.to,true);if(r.source.address!==r.job?.body?.courier)throw Error('invalid_courier_source');}
    if (!r.job?.body?.attachment || !courierId(r.job.body.id) || incomingIds.has(r.job.body.id) || !isValidAccountId(r.job.body.from) || !isValidAccountId(r.job.body.to) ||
        !Number.isSafeInteger(r.nextIndex) || r.nextIndex < 0 || r.nextIndex > r.job.body.attachment.chunks || r.job.body.packet.length > COURIER_MAX_PACKET || !r.hop?.body) throw new Error('invalid_courier_files');
    validateManifest(r.manifest, r.job.body.from, r.job.body.to, r.job.body.id); incomingIds.add(r.job.body.id);
    if (JSON.stringify(r.manifest.attachment) !== JSON.stringify(validateAttachment(r.job.body.attachment))) throw new Error('invalid_courier_files');
  }
  return structuredClone(s);
}
