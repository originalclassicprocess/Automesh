import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { isValidAccountId } from '../addressing/bech32m.js';
import { createProfileRegistry, addProfile, updateProfile, requestInboxConnection, decideInboxConnection,
  visibleInboxSources, type ProfileEntry, type ProfileRole, type InboxPermission } from '../core/profiles';
import type { CoreEnvironment } from '../core/ports';
import type { CoreRecordStore } from '../core/durable-state';
import { deriveProfileSeed, deriveProfileRegistryKey } from './keys';
import { createProfileRegistryStore } from './store';
import { verifyProfileRegistry, mergeProfileBackup } from './backup';
import type { ProfileRegistry } from '../core/profiles';
import { configureOwnedInbox } from './owned-consent';
import { profilePreset, type ProfilePresetId } from './presets';

// Trusted local controller. Owns its seed copy; no network, automatic migration,
// blanket authorization or persistence of private signing keys.
export async function openProfileBundle(options: {
  root: Uint8Array; scope: string; records: CoreRecordStore; environment: CoreEnvironment;
  randomBytes(size: number): Uint8Array; guard(): void;
}) {
  const { scope, records, environment, randomBytes, guard } = options;
  if (!(options.root instanceof Uint8Array) || options.root.length !== 32 || !isValidAccountId(scope)) throw new Error('invalid_profile_bundle');
  const root = new Uint8Array(options.root); let closed = false;
  const signers = new Set<WebCryptoIdentity>();
  const requireOpen = () => { if (closed) throw new Error('profile_bundle_closed'); guard(); };
  let store: ReturnType<typeof createProfileRegistryStore>;
  try {
    requireOpen(); const key = await deriveProfileRegistryKey(root, scope, environment.subtle); requireOpen();
    store = createProfileRegistryStore({ scope, key, records, subtle: environment.subtle, randomBytes, guard: requireOpen, now: environment.now });
  } catch (error) { root.fill(0); throw error; }
  const derivedIdentity = async (index: number | null) => {
    requireOpen();
    const seed = index === null ? root.slice() : await deriveProfileSeed(root, index, environment.subtle);
    const provider = new WebCryptoIdentity();
    try {
      requireOpen(); await provider.fromSeed(seed); requireOpen();
      const accountId = await accountIdFromPublicKey(await provider.getPublicKeyBytes(), environment.subtle); requireOpen();
      return { accountId, provider };
    } catch (error) { provider.dispose(); throw error; }
    finally { seed.fill(0); }
  };
  const entry = async (index: number, role: ProfileRole, name: string): Promise<ProfileEntry> => {
    const identity = await derivedIdentity(index);
    try { return { id: environment.newId(), index, role, name, accountId: identity.accountId, archived: false, createdAt: environment.now() }; }
    finally { identity.provider.dispose(); }
  };
  const requireRegistry = async () => { const value = await store.read(); requireOpen(); if (!value) throw new Error('profile_registry_missing'); return value; };
  return Object.freeze({
    read: requireRegistry,
    async restore(value: ProfileRegistry) {
      requireOpen();
      const verified = await verifyProfileRegistry(root, scope, value, requireOpen);
      requireOpen();
      return store.change(current => mergeProfileBackup(current, verified));
    },
    async initialize(legacyName?: string) {
      requireOpen(); const existing = await store.read(); requireOpen(); if (existing) return existing;
      const main = await entry(0, 'main', 'Все входящие');
      let legacy: ProfileEntry | undefined;
      if (legacyName !== undefined) {
        const identity = await derivedIdentity(null);
        try {
          if (identity.accountId !== scope) throw new Error('legacy_profile_address_mismatch');
          legacy = { id: environment.newId(), accountId: scope, index: null, role: 'personal', name: legacyName,
            archived: false, createdAt: environment.now() };
        } finally { identity.provider.dispose(); }
      }
      return store.initialize(createProfileRegistry(main, legacy));
    },
    async initializePersonal(keepCurrentAddress = false) {
      requireOpen(); const existing = await store.read(); requireOpen(); if (existing) return existing;
      if (typeof keepCurrentAddress !== 'boolean') throw new Error('invalid_profile_setup');
      const main = await entry(0, 'main', 'Все чаты');
      let personal: ProfileEntry;
      if (keepCurrentAddress) {
        const identity = await derivedIdentity(null);
        try {
          if (identity.accountId !== scope) throw new Error('legacy_profile_address_mismatch');
          personal = { id: environment.newId(),accountId: scope,index: null,role: 'personal',name: 'Личный',archived: false,createdAt: environment.now() };
        } finally { identity.provider.dispose(); }
      } else personal = await entry(1, 'personal', 'Личный');
      const registry = keepCurrentAddress ? createProfileRegistry(main,personal) : addProfile(createProfileRegistry(main),personal);
      // Simple registration grants no cross-profile access. Keep the technical
      // entry for format compatibility, without activating the aggregate inbox.
      return store.initialize(registry);
    },
    async createPreset(id: ProfilePresetId, name: string, showInAll: boolean) {
      requireOpen(); const preset = profilePreset(id);
      if (typeof showInAll !== 'boolean') throw new Error('invalid_profile_preset');
      return store.change(async value => {
        if (!value) throw new Error('profile_registry_missing');
        const personal = await entry(value.nextIndex,preset.role,name);
        const next = addProfile(value,personal);
        return showInAll ? configureOwnedInbox(next, { id: environment.newId(), subId: personal.id,
          permission: 'contribute', enabled: true, now: environment.now(), expectedScope: [personal.id] }) : next;
      });
    },
    configureInbox: (subId: string, permission: InboxPermission, enabled: boolean, expectedScope: string[]) => {
      requireOpen(); const id = environment.newId(), now = environment.now(), scopeSnapshot = [...expectedScope];
      return store.change(value => configureOwnedInbox(value, { id, subId, permission, enabled, now, expectedScope: scopeSnapshot }));
    },
    async create(role: Exclude<ProfileRole, 'main'>, name: string) {
      requireOpen();
      return store.change(async value => {
        if (!value) throw new Error('profile_registry_missing');
        return addProfile(value, await entry(value.nextIndex, role, name));
      });
    },
    update: (id: string, changes: { name?: string; archived?: boolean }) => {
      requireOpen(); const patch = { ...changes };
      return store.change(value => updateProfile(value, id, patch));
    },
    request: (subId: string, permission: InboxPermission, actor: string, validUntil: number) => {
      requireOpen(); const id = environment.newId(), now = environment.now();
      return store.change(value => requestInboxConnection(value, { id, subId, permission, actor, now, validUntil }));
    },
    decide: (id: string, actor: string, decision: 'approve' | 'reject' | 'revoke') => {
      requireOpen(); return store.change(value => decideInboxConnection(value, id, actor, decision, environment.now()));
    },
    sources: async (viewer: string) => visibleInboxSources(await requireRegistry(), viewer, environment.now()),
    async openIdentity(id: string, allowMain = false) {
      const registry = await requireRegistry(), p = registry.profiles.find(p => p.id === id);
      if (!p || p.archived) throw new Error('profile_identity_unavailable');
      if (p.role === 'main' && !allowMain) throw new Error('main_profile_local_only');
      const identity = await derivedIdentity(p.index);
      if (identity.accountId !== p.accountId) { identity.provider.dispose(); throw new Error('profile_address_mismatch'); }
      signers.add(identity.provider);
      // The trusted host must not register a main-role signer on the network by default.
      return { provider: identity.provider, accountId: identity.accountId,
        close: () => { identity.provider.dispose(); signers.delete(identity.provider); } };
    },
    close: () => { closed = true; root.fill(0); store.close(); for (const signer of signers) signer.dispose(); signers.clear(); },
  });
}
