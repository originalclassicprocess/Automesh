import { LOCAL_INBOX_UNTIL_REVOKED, decideInboxConnection, profileRegistrySnapshot,
  requestInboxConnection, visibleInboxSources, type InboxPermission } from '../core/profiles';

// Trusted local controller only, after root-password unlock and an explicit UI
// confirmation. Not consent from a remote identity, not an endpoint or URL command.
export function configureOwnedInbox(value: unknown, input: {
  id: string; subId: string; permission: InboxPermission; enabled: boolean; now: number; expectedScope: string[];
}) {
  let registry = profileRegistrySnapshot(value);
  const main = registry.profiles.find(p => p.role === 'main')!;
  const sub = registry.profiles.find(p => p.id === input.subId);
  const now = Math.max(input.now, registry.lastNow);
  if (!Number.isSafeInteger(now) || now < 0 || typeof input.enabled !== 'boolean' || !sub || sub.archived || sub.role === 'main')
    throw new Error('owned_inbox_not_allowed');
  if (!['contribute', 'read-all'].includes(input.permission)) throw new Error('owned_inbox_not_allowed');
  const scope = input.permission === 'contribute' ? [sub.id] : visibleInboxSources(registry,main.id,now);
  if (input.enabled && JSON.stringify(scope) !== JSON.stringify(input.expectedScope)) throw new Error('profile_consent_changed');
  // Replace only this setting's superseded records: no accumulated 128-toggle
  // ceiling, no change to other readers' frozen scopes, no archive deletion.
  registry.connections = registry.connections.filter(c => c.subId !== sub.id || c.permission !== input.permission);
  registry.lastNow = now;
  if (!input.enabled) return profileRegistrySnapshot(registry);
  registry = requestInboxConnection(registry, { id: input.id, subId: sub.id, permission: input.permission,
    actor: sub.id, now, validUntil: input.permission === 'contribute' ? LOCAL_INBOX_UNTIL_REVOKED : now + 7 * 86400000 });
  return decideInboxConnection(registry,input.id,main.id,'approve',now);
}
