import type { ChatService } from '../chat/ChatService';
import type { OwnerDeviceStore } from './owner-store';
import type { IdentityProvider } from '../identity/identity';
import { signObject, verifyObject, type SignedObject } from '../core/objects';
import { webCryptoEnvironment, type CoreEnvironment } from '../core/ports';
import { membershipDigest, verifyMembership, type MembershipAnchor } from './membership';
import { isValidAccountId } from '../addressing/bech32m.js';
export type OwnerPolicyReply = { roster: SignedObject; ownerProof: SignedObject };
export async function signOwnerPolicy(roster: SignedObject, nonce: string, recipient: string, signer: IdentityProvider, environment: CoreEnvironment) {
  const ownerProof = await signObject({ kind: 'document', audience: [recipient], expiresAt: environment.now() + 30000,
    body: { type: 'automesh-live-owner-policy-v1', nonce, digest: await membershipDigest(roster, environment) } }, signer, environment);
  if (ownerProof.record.author !== roster.record.author) throw new Error('device_owner_mismatch');
  return { roster, ownerProof };
}
export async function verifyOwnerPolicy(value: unknown, owner: string, recipient: string, nonce: string, anchor: MembershipAnchor, environment: CoreEnvironment) {
  const reply = value as OwnerPolicyReply;
  if (!reply || Object.keys(reply).sort().join(',') !== 'ownerProof,roster' || !/^[a-f0-9]{64}$/.test(nonce)) throw new Error('device_owner_checkpoint_invalid');
  const proof = await verifyObject(reply.ownerProof, environment), r = proof.record, b = r.body as Record<string, unknown>;
  if (r.author !== owner || r.kind !== 'document' || r.audience.length !== 1 || r.audience[0] !== recipient || !r.expiresAt || r.expiresAt-r.createdAt > 30000 || r.createdAt > environment.now() ||
    !b || Object.keys(b).sort().join(',') !== 'digest,nonce,type' || b.type !== 'automesh-live-owner-policy-v1' || b.nonce !== nonce || b.digest !== await membershipDigest(reply.roster, environment)) throw new Error('device_owner_checkpoint_invalid');
  return verifyMembership(reply.roster, anchor, environment);
}
// These control frames travel ONLY in authenticated MAE sessions. A fresh
// owner-signed nonce response, not an old certificate/cache, authorizes traffic.
export function createLiveOwnerPolicy(options: { owner: string; device: string; signer: IdentityProvider; chat: ChatService; store?: OwnerDeviceStore; guard(): void; allowed(owner: string): boolean }) {
  let closed = false; const waiting = new Map<string, { owner: string; resolve(value: OwnerPolicyReply): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let windowStart = Date.now(), served = 0;
  async function currentRoster() {
    if (!options.store) throw new Error('device_owner_required');
    const saved = await options.store.snapshot(); options.guard();
    // A freshness proof must not advance a node-bound roster behind the node's
    // back. The nonce proof supplies freshness; use the current exact snapshot.
    return saved && saved.record.expiresAt! > Date.now()+30000 ? saved : options.store.publish();
  }
  const unsubscribe = options.chat.onDeviceControl(async (peer, kind, value) => {
    if (closed || kind !== 'policy-request' && kind !== 'policy-reply') return;
    options.guard();
    if (kind === 'policy-reply') {
      const reply = value as OwnerPolicyReply, nonce = (reply?.ownerProof?.record?.body as Record<string,unknown>)?.nonce;
      if (typeof nonce !== 'string') return; const pending = waiting.get(nonce);
      if (!pending || pending.owner !== peer) return;
      waiting.delete(nonce); clearTimeout(pending.timer); pending.resolve(reply); return;
    }
    const request = value as { owner: string; nonce: string };
    if (!options.store || !request || Object.keys(request).sort().join(',') !== 'nonce,owner' || request.owner !== options.owner || !/^[a-f0-9]{64}$/.test(request.nonce)) return;
    if (Date.now()-windowStart > 60000) { windowStart = Date.now(); served = 0; }
    if (++served > 180) return;
    const roster = await currentRoster(); options.guard();
    const reply = await signOwnerPolicy(roster, request.nonce, peer, options.signer, webCryptoEnvironment());
    if (closed) return; options.guard(); await options.chat.sendDeviceControl('policy-reply', reply, peer);
  });
  return {
    async policy(owner: string, nonce: string): Promise<OwnerPolicyReply> {
      options.guard(); if (closed || !isValidAccountId(owner) || !/^[a-f0-9]{64}$/.test(nonce) || !options.allowed(owner) || waiting.size >= 32) throw new Error('device_owner_unavailable');
      if (owner === options.owner && options.store) { const reply = await signOwnerPolicy(await currentRoster(), nonce, options.device, options.signer, webCryptoEnvironment()); options.guard(); if (closed) throw new Error('device_owner_unavailable'); return reply; }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(nonce); reject(new Error('device_owner_unavailable')); }, 12000);
        waiting.set(nonce, { owner, resolve, reject, timer });
        void (async () => { await options.chat.connectAndWait(owner); options.guard(); if (!closed && waiting.has(nonce)) await options.chat.sendDeviceControl('policy-request', { owner, nonce }, owner); })().catch(() => { const p = waiting.get(nonce); if (p) { waiting.delete(nonce); clearTimeout(p.timer); p.reject(new Error('device_owner_unavailable')); } });
      });
    },
    close() { closed = true; unsubscribe(); for (const p of waiting.values()) { clearTimeout(p.timer); p.reject(new Error('device_owner_unavailable')); } waiting.clear(); }
  };
}
