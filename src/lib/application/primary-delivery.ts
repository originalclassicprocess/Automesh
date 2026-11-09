import type { SignedObject } from '../core/objects';
import type { CoreEnvironment } from '../core/ports';
import { verifyMembership, type MembershipBody } from '../devices/membership';
import type { SessionChats } from '../chat/session-chats';

// Primary traffic authenticates the exact root address with MAE/courier v1.
// A directory pin is not an instruction to send using a delegated device key.
// This check uses only signed local hints to retain a known primary-disabled
// restriction. It NEVER authorizes a child or replaces fresh device checks.
export async function requirePrimaryRoute(self: string, peer: string, hints: SignedObject[], env: CoreEnvironment): Promise<void> {
  for (const owner of new Set([self,peer])) {
    const hint = hints.find(p => p.record.author === owner); if (!hint) continue;
    let body: MembershipBody;
    try {
      const issued = hint.record.createdAt;
      if (!Number.isSafeInteger(issued) || issued < 0) throw new Error('invalid');
      body = (await verifyMembership(hint,{owner,sequence:0,digest:null,revoked:[]},{...env,now:()=>issued})).body;
    } catch { throw new Error('primary_policy_invalid'); }
    if (!body.primary) throw new Error('primary_disabled');
  }
}
// Activation hint, NOT authorization. A node pin alone must not start publishing
// a device directory for a normal seed account. Existing delegated work stays.
export function hasDelegatedWork(own: SignedObject | null, peers: SignedObject[], chats: SessionChats): boolean {
  const delegated = (p: SignedObject) => {
    const body = p.record.body as unknown as MembershipBody;
    return Array.isArray(body.devices) && body.devices.length > 0;
  };
  return !!own && delegated(own) || peers.some(delegated) || chats.order.some(peer => chats.byPeer[peer].messages.some(m =>
    m.deviceMessage && !m.restoredFromBackup && m.direction === 'outgoing' && ['queued','sending','sent','stored'].includes(m.delivery ?? '')));
}
// Only not-yet-stored primary-authored text. Call after requirePrimaryRoute;
// keep underlying delegated journals/receipts intact. Never replay archives.
export function recoverPrimaryQueued(chats: SessionChats, self: string, peers: Set<string>): SessionChats {
  let next = chats;
  for (const peer of peers) {
    const c = next.byPeer[peer]; if (!c) continue;
    let changed = false;
    const messages = c.messages.map(m => {
      if (!m.deviceMessage || m.from !== self || m.restoredFromBackup || m.file || m.localCall || m.direction !== 'outgoing' || m.delivery !== 'queued') return m;
      changed = true; return {...m,deviceMessage:false};
    });
    if (changed) next = {...next,byPeer:{...next.byPeer,[peer]:{...c,messages}}};
  }
  return next;
}
