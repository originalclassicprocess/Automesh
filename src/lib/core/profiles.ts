import { canonicalJson } from './canonical';
import { isValidAccountId } from '../addressing/bech32m.js';
import { UUID_PATTERN } from './objects';

export const PROFILE_ROLES = ['main', 'personal', 'incoming', 'outgoing', 'custom'] as const;
export type ProfileRole = typeof PROFILE_ROLES[number];
export type InboxPermission = 'contribute' | 'read-all';
export interface ProfileEntry {
  id: string; accountId: string; index: number | null; name: string;
  role: ProfileRole; archived: boolean; createdAt: number;
}
export interface InboxConnection {
  id: string; subId: string; permission: InboxPermission; scope: string[];
  requestedBy: string; approvedBy: string[]; createdAt: number;
  requestExpiresAt: number; validUntil: number;
  status: 'pending' | 'active' | 'revoked' | 'rejected';
}
export interface ProfileRegistry {
  schema: 1; derivation: 'automesh-profile-hkdf-p256-v1'; nextIndex: number; lastNow: number;
  profiles: ProfileEntry[]; connections: InboxConnection[];
}
const MAX_PROFILES = 256, MAX_CONNECTIONS = 128;
const WEEK = 7 * 86400000;
// Only an explicitly enabled local contribution may last until revoked.
// Cross-profile read-all grants still expire and keep a fixed source snapshot.
export const LOCAL_INBOX_UNTIL_REVOKED = Number.MAX_SAFE_INTEGER;
const time = (value: number) => Number.isSafeInteger(value) && value >= 0;
const exact = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const validName = (name: unknown): name is string => typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name);
const fail = (): never => { throw new Error('invalid_profile_registry'); };

// Snapshot first: reject accessors, unknown prototypes/fields and huge input.
// No seed, signer, network endpoint or executable hook belongs in this format.
export function profileRegistrySnapshot(value: unknown): ProfileRegistry {
  const registry = JSON.parse(canonicalJson(value)) as ProfileRegistry;
  if (!registry || !exact(registry, ['schema', 'derivation', 'nextIndex', 'lastNow', 'profiles', 'connections']) || !time(registry.lastNow) ||
      registry.schema !== 1 || registry.derivation !== 'automesh-profile-hkdf-p256-v1' ||
      !Number.isSafeInteger(registry.nextIndex) || registry.nextIndex < 1 || registry.nextIndex > 0x100000000 ||
      !Array.isArray(registry.profiles) || !registry.profiles.length || registry.profiles.length > MAX_PROFILES ||
      !Array.isArray(registry.connections) || registry.connections.length > MAX_CONNECTIONS) fail();
  const ids = new Set<string>(), addresses = new Set<string>(), indices = new Set<number>();
  for (const p of registry.profiles) {
    if (!p || !exact(p, ['id', 'accountId', 'index', 'name', 'role', 'archived', 'createdAt']) ||
        !UUID_PATTERN.test(p.id) || !isValidAccountId(p.accountId) || !validName(p.name) || !PROFILE_ROLES.includes(p.role) ||
        typeof p.archived !== 'boolean' || !time(p.createdAt) || ids.has(p.id) || addresses.has(p.accountId) ||
        (p.index !== null && (!Number.isSafeInteger(p.index) || p.index < 0 || p.index >= registry.nextIndex || indices.has(p.index)))) fail();
    ids.add(p.id); addresses.add(p.accountId); if (p.index !== null) indices.add(p.index);
  }
  const mains = registry.profiles.filter(p => p.role === 'main');
  if (mains.length !== 1 || mains[0].index !== 0 || mains[0].archived || registry.profiles.filter(p => p.index === null).length > 1) fail();
  const main = mains[0], connectionIds = new Set<string>();
  for (const c of registry.connections) {
    const sub = registry.profiles.find(p => p.id === c?.subId);
    if (!c || !exact(c, ['id', 'subId', 'permission', 'scope', 'requestedBy', 'approvedBy', 'createdAt', 'requestExpiresAt', 'validUntil', 'status']) ||
        !UUID_PATTERN.test(c.id) || connectionIds.has(c.id) || !sub || sub.id === main.id ||
        !['contribute', 'read-all'].includes(c.permission) || !['pending', 'active', 'revoked', 'rejected'].includes(c.status) ||
        ![main.id, sub.id].includes(c.requestedBy) || !Array.isArray(c.approvedBy) ||
        !c.approvedBy.includes(c.requestedBy) || c.approvedBy.length < 1 || c.approvedBy.length > 2 ||
        new Set(c.approvedBy).size !== c.approvedBy.length || c.approvedBy.some(id => ![main.id, sub.id].includes(id)) ||
        (c.status === 'active' && c.approvedBy.length !== 2) || (c.status === 'pending' && c.approvedBy.length !== 1) ||
        !time(c.createdAt) || !time(c.requestExpiresAt) || !time(c.validUntil) || c.requestExpiresAt <= c.createdAt ||
        c.requestExpiresAt > c.createdAt + 10 * 60000 || c.validUntil <= c.requestExpiresAt ||
        (c.validUntil > c.createdAt + WEEK && !(c.permission === 'contribute' && c.validUntil === LOCAL_INBOX_UNTIL_REVOKED)) ||
        !Array.isArray(c.scope) || !c.scope.length || c.scope.length > MAX_PROFILES || new Set(c.scope).size !== c.scope.length ||
        c.scope.some(id => !ids.has(id)) || (c.permission === 'contribute' && (c.scope.length !== 1 || c.scope[0] !== sub.id))) fail();
    connectionIds.add(c.id);
  }
  return registry;
}

export function createProfileRegistry(main: ProfileEntry, legacy?: ProfileEntry): ProfileRegistry {
  return profileRegistrySnapshot({ schema: 1, derivation: 'automesh-profile-hkdf-p256-v1', nextIndex: 1, lastNow: main.createdAt,
    profiles: legacy ? [main, legacy] : [main], connections: [] });
}
export function addProfile(value: unknown, entry: ProfileEntry): ProfileRegistry {
  const registry = profileRegistrySnapshot(value);
  if (entry.index !== registry.nextIndex || entry.role === 'main') throw new Error('invalid_new_profile');
  registry.profiles.push(entry); registry.nextIndex++;
  return profileRegistrySnapshot(registry);
}
export function updateProfile(value: unknown, id: string, changes: { name?: string; archived?: boolean }): ProfileRegistry {
  const registry = profileRegistrySnapshot(value), entry = registry.profiles.find(p => p.id === id);
  const patch = JSON.parse(canonicalJson(changes));
  if (!entry || Object.keys(patch).some(k => !['name', 'archived'].includes(k))) throw new Error('invalid_profile_change');
  Object.assign(entry, patch);
  if (patch.archived === true) for (const c of registry.connections) {
    if (c.subId === id && ['pending', 'active'].includes(c.status)) c.status = 'revoked';
  }
  return profileRegistrySnapshot(registry);
}
const active = (registry: ProfileRegistry, c: InboxConnection, now: number) => c.status === 'active' && c.validUntil > now &&
  !registry.profiles.find(p => p.id === c.subId)!.archived;
function sources(registry: ProfileRegistry, now: number): string[] {
  const main = registry.profiles.find(p => p.role === 'main')!;
  return [...new Set([main.id, ...registry.connections.filter(c => c.permission === 'contribute' && active(registry, c, now)).map(c => c.subId)])];
}

// Local host-mediated consent, NOT proof from a remote account or a sandbox.
// actor is supplied by the trusted unlocked profile controller, never a URL.
export function requestInboxConnection(value: unknown, input: {
  id: string; subId: string; permission: InboxPermission; actor: string; now: number; validUntil: number;
}): ProfileRegistry {
  const registry = profileRegistrySnapshot(value), main = registry.profiles.find(p => p.role === 'main')!;
  const { id, subId, permission, actor, validUntil } = input;
  if (!time(input.now)) throw new Error('inbox_request_not_allowed');
  const now = Math.max(input.now, registry.lastNow); registry.lastNow = now;
  const sub = registry.profiles.find(p => p.id === subId);
  if (!time(now) || !sub || sub.archived || subId === main.id || ![main.id, subId].includes(actor) ||
      registry.connections.some(c => c.subId === subId && c.permission === permission && c.validUntil > now &&
        (c.status === 'active' || c.status === 'pending' && c.requestExpiresAt > now))) throw new Error('inbox_request_not_allowed');
  // Snapshot the current aggregate. Future connections never silently widen access.
  const scope = permission === 'contribute' ? [subId] : sources(registry, now);
  registry.connections.push({ id, subId, permission, scope, requestedBy: actor, approvedBy: [actor],
    createdAt: now, requestExpiresAt: now + 10 * 60000, validUntil, status: 'pending' });
  return profileRegistrySnapshot(registry);
}
export function decideInboxConnection(value: unknown, id: string, actor: string, decision: 'approve' | 'reject' | 'revoke', now: number): ProfileRegistry {
  const registry = profileRegistrySnapshot(value), c = registry.connections.find(c => c.id === id);
  if (!time(now)) throw new Error('inbox_decision_not_allowed');
  now = Math.max(now, registry.lastNow); registry.lastNow = now;
  const main = registry.profiles.find(p => p.role === 'main')!;
  if (!time(now) || !c || ![main.id, c.subId].includes(actor)) throw new Error('inbox_decision_not_allowed');
  if (decision === 'revoke') {
    if (!['pending', 'active'].includes(c.status)) throw new Error('inbox_decision_not_allowed');
    c.status = 'revoked';
  } else {
    if (c.status !== 'pending' || c.requestExpiresAt <= now || c.validUntil <= now || c.approvedBy.includes(actor) ||
        registry.profiles.find(p => p.id === c.subId)!.archived) throw new Error('inbox_decision_not_allowed');
    if (decision === 'reject') c.status = 'rejected';
    else if (decision === 'approve') { c.approvedBy.push(actor); c.status = 'active'; }
    else throw new Error('inbox_decision_not_allowed');
  }
  return profileRegistrySnapshot(registry);
}
export function visibleInboxSources(value: unknown, viewer: string, now: number): string[] {
  const registry = profileRegistrySnapshot(value), profile = registry.profiles.find(p => p.id === viewer);
  if (!time(now) || !profile || profile.archived) throw new Error('inbox_view_not_allowed');
  now = Math.max(now, registry.lastNow);
  const available = sources(registry, now);
  if (profile.role === 'main') return available;
  const extra = registry.connections.filter(c => c.subId === viewer && c.permission === 'read-all' && active(registry, c, now))
    .flatMap(c => c.scope.filter(id => available.includes(id)));
  return [...new Set([viewer, ...extra])];
}
