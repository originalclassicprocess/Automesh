import type { ChatService } from '../chat/ChatService';
import type { SignedObject } from '../core/objects';
import { webCryptoEnvironment } from '../core/ports';
import { verifyMembership } from './membership';
import { requirePolicyProgress } from './delivery-plan';

export async function acceptDeviceAdvertisement(peer: string, value: unknown, previous?: SignedObject): Promise<SignedObject> {
  const candidate = value as SignedObject;
  if (candidate?.record?.author !== peer) throw new Error('device_roster_sender');
  const environment = webCryptoEnvironment();
  const anchor = previous ? (await verifyMembership(previous, { owner: peer, sequence: 0, digest: null, revoked: [] },
    { ...environment, now: () => previous.record.createdAt })).anchor : { owner: peer, sequence: 0, digest: null, revoked: [] };
  const verified = await verifyMembership(candidate, anchor, environment);
  requirePolicyProgress(previous, verified.roster);
  return verified.roster;
}

// Discovery is optional. Never hold the authenticated peer receive queue while
// starting a device runtime that may itself need a reply on the same channel.
export function installDeviceDiscovery(options: { chat: ChatService; current(): boolean; allowed(peer: string): boolean;
  previous(peer: string): SignedObject | undefined; accepted(roster: SignedObject): Promise<void> }) {
  let active = true, pending = 0;
  const unsubscribe = options.chat.onDeviceControl((peer, kind, value) => {
    if (!active || kind !== 'roster' || pending >= 4 || !options.current() || !options.allowed(peer)) return;
    pending++;
    void acceptDeviceAdvertisement(peer, value, options.previous(peer)).then(async roster => {
      if (active && options.current() && options.allowed(peer)) await options.accepted(roster);
    }).catch(() => {}).finally(() => pending--);
  });
  return () => { active = false; unsubscribe(); };
}
