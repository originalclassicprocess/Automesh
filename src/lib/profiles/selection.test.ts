import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { withBrowserProfileSelection, clearAllProfileStorage, PROFILE_SELECTION_DATABASE_NAME } from './browser';
import { resolveProfileSelection, resolveCommunicationProfileSelection, createProfileSelectionStore } from './selection';
import { deriveProfileSelectionKey, deriveProfileRegistryKey } from './keys';
import { createIndexedDbCoreRecords } from '../core-storage/indexeddb';
import { createProfileRegistry, addProfile, type ProfileEntry } from '../core/profiles';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { deriveProfileSeed } from './keys';
const root = new Uint8Array(32); root[31] = 1;
let scope: string, main: ProfileEntry, legacy: ProfileEntry, sub: ProfileEntry;
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => {
  const entry = async (index: number | null, role: ProfileEntry['role']): Promise<ProfileEntry> => {
    const seed = index === null ? new Uint8Array(root) : await deriveProfileSeed(root,index,crypto.subtle), identity = new WebCryptoIdentity();
    try { return { index, role, id: crypto.randomUUID(), name: role, archived: false, createdAt: 1000,
      accountId: await accountIdFromPublicKey((await identity.fromSeed(seed)).publicKey) }; }
    finally { seed.fill(0); identity.dispose(); }
  };
  legacy = await entry(null,'personal'); scope = legacy.accountId; main = await entry(0,'main'); sub = await entry(1,'incoming');
});
const registry = () => addProfile(createProfileRegistry(main,legacy),sub);
describe('private device profile selection', () => {
  it('moves an explicitly remembered technical inbox to an ordinary profile in simple mode, never reviving an archived choice', () => {
    expect(resolveCommunicationProfileSelection(registry(),main.id)).toBe(legacy.id);
    const fresh = addProfile(createProfileRegistry(main), { ...sub, role: 'personal' });
    expect(resolveCommunicationProfileSelection(fresh,main.id)).toBe(sub.id);
    const archived = registry(); archived.profiles[2].archived = true;
    expect(resolveCommunicationProfileSelection(archived,sub.id)).toBe(main.id);
    expect(resolveCommunicationProfileSelection(createProfileRegistry(main),main.id)).toBe(main.id);
  });
  it('chooses the new personal profile on first login, never root or the technical inbox', () => {
    const personal = { ...sub,role: 'personal' as const };
    const r = addProfile(createProfileRegistry(main),personal);
    expect(resolveProfileSelection(r)).toBe(personal.id);
  });
  it('preserves legacy first login, remembers a child, and fails private after archive/removal', () => {
    expect(resolveProfileSelection(null)).toBeUndefined(); expect(resolveProfileSelection(registry())).toBe(legacy.id);
    expect(resolveProfileSelection(registry(),sub.id)).toBe(sub.id);
    const archived = registry(); archived.profiles[2].archived = true;
    expect(resolveProfileSelection(archived,sub.id)).toBe(main.id);
    expect(resolveProfileSelection(registry(),crypto.randomUUID())).toBe(main.id);
    expect(() => resolveProfileSelection(null,sub.id)).toThrow('profile_registry_missing');
  });
  it('reopens an encrypted preference, isolates its key from registry and clears it on full erasure', async () => {
    const factory = new IDBFactory(), options = { root, scope, trusted: true, factory, guard() {} };
    expect(await withBrowserProfileSelection(options,s => s.read())).toBeUndefined();
    await withBrowserProfileSelection(options,s => s.save(sub.id));
    expect(await withBrowserProfileSelection(options,s => s.read())).toBe(sub.id);
    const mapped = { open: (_n: string, v?: number) => factory.open(PROFILE_SELECTION_DATABASE_NAME,v) } as IDBFactory;
    const records = createIndexedDbCoreRecords(mapped, () => {}), raw = (await records.read(scope))!;
    expect(new TextDecoder().decode(raw.cipher)).not.toContain(sub.id);
    const wrongKey = await deriveProfileRegistryKey(root,scope,crypto.subtle);
    await expect(createProfileSelectionStore({ scope, key: wrongKey, records, guard() {} }).read()).rejects.toThrow();
    await clearAllProfileStorage(factory);
    expect(await withBrowserProfileSelection(options,s => s.read())).toBeUndefined(); records.close();
  });
  it('rejects invalid ids and stale/untrusted operations without overwriting the choice', async () => {
    const factory = new IDBFactory(), options = { root, scope, trusted: true, factory, guard() {} };
    await withBrowserProfileSelection(options,s => s.save(sub.id));
    await expect(withBrowserProfileSelection(options,s => s.save('x'))).rejects.toThrow('invalid_profile_selection');
    await expect(withBrowserProfileSelection({ ...options, trusted: false },s => s.read())).rejects.toThrow('profiles_require_trusted_session');
    await expect(withBrowserProfileSelection({ ...options, guard() { throw new Error('stale'); } },s => s.save(main.id))).rejects.toThrow('stale');
    expect(await withBrowserProfileSelection(options,s => s.read())).toBe(sub.id);
  });
  it('authenticates revision/scope and refuses damaged data rather than resetting it', async () => {
    const factory = new IDBFactory(), options = { root, scope, trusted: true, factory, guard() {} };
    await withBrowserProfileSelection(options,s => s.save(sub.id));
    const records = createIndexedDbCoreRecords({ open: (_n,v) => factory.open(PROFILE_SELECTION_DATABASE_NAME,v) } as IDBFactory, () => {});
    const raw = (await records.read(scope))!;
    await records.compareAndSwap(scope,raw.revision,{ ...raw, revision: raw.revision + 1 });
    await expect(withBrowserProfileSelection(options,s => s.read())).rejects.toThrow();
    await expect(withBrowserProfileSelection(options,s => s.save(main.id))).rejects.toThrow();
    const key = await deriveProfileSelectionKey(root,scope,crypto.subtle); expect(key.extractable).toBe(false); records.close();
  });
});
