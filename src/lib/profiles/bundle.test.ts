import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openBrowserProfileBundle, clearAllProfileStorage, PROFILE_DATABASE_NAME } from './browser';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { CORE_DATABASE_NAME, createIndexedDbCoreRecords } from '../core-storage/indexeddb';
import { beginStorageReset } from '../application/storage-reset';
import { deriveProfileRegistryKey } from './keys';
import { createProfileRegistryStore } from './store';
const root = new Uint8Array(32); root[31] = 1;
let scope: string, factory: IDBFactory, now: number;
const bundles: Awaited<ReturnType<typeof openBrowserProfileBundle>>[] = [];
beforeAll(async () => {
  const identity = new WebCryptoIdentity(); scope = await accountIdFromPublicKey((await identity.fromSeed(root)).publicKey); identity.dispose();
});
beforeEach(() => {
  factory = new IDBFactory(); now = 1_800_000_000_000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); } });
});
afterEach(() => { for (const bundle of bundles) bundle.close(); bundles.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open(input = root) {
  const bundle = await openBrowserProfileBundle({ root: input, scope, trusted: true, factory }); bundles.push(bundle); return bundle;
}
const mapped = () => ({ open: (_name: string, version?: number) => factory.open(PROFILE_DATABASE_NAME, version) } as IDBFactory);
describe('encrypted profile registry and controller', () => {
  it('creates arbitrary ordinary profiles without any aggregate permissions and restores their addresses', async () => {
    const bundle = await open(); await bundle.initializePersonal();
    await bundle.create('custom','Для объявлений');
    const saved = await bundle.create('custom','Хобби'), extra = saved.profiles.slice(2);
    expect(saved.connections).toEqual([]);
    expect(extra.map(p => p.name)).toEqual(['Для объявлений','Хобби']);
    expect(new Set(saved.profiles.map(p => p.accountId)).size).toBe(4);
    for (const p of extra) expect(await bundle.sources(p.id)).toEqual([p.id]);
    bundle.close(); factory = new IDBFactory();
    const target = await open(), restored = await target.restore(saved);
    expect(restored.profiles).toEqual(saved.profiles); expect(restored.connections).toEqual([]);
    for (const p of extra) { const signer = await target.openIdentity(p.id); expect(signer.accountId).toBe(p.accountId); signer.close(); }
  });
  it('does not erase or activate existing advanced grants when initializing or adding an ordinary profile', async () => {
    const bundle = await open(); let r = await bundle.initializePersonal();
    r = await bundle.createPreset('work','Старый рабочий',true);
    const before = structuredClone(r.connections);
    expect((await bundle.initializePersonal()).connections).toEqual(before);
    r = await bundle.create('custom','Новый');
    expect(r.connections).toEqual(before);
    expect(await bundle.sources(r.profiles[0].id)).not.toContain(r.profiles.at(-1)!.id);
  });
  it('initializes a private personal address without cross-profile permissions, once and atomically', async () => {
    const bundle = await open(), r = await bundle.initializePersonal();
    const main = r.profiles[0], personal = r.profiles[1];
    expect(r.profiles).toHaveLength(2); expect(main.name).toBe('Все чаты');
    expect(personal).toMatchObject({ role: 'personal',index: 1,name: 'Личный' });
    expect(personal.accountId).not.toBe(scope); expect(main.accountId).not.toBe(scope);
    expect(r.profiles.every(p => p.accountId !== scope)).toBe(true);
    expect(r.connections).toEqual([]);
    expect(await bundle.sources(main.id)).toEqual([main.id]);
    now += 30 * 86400000;
    expect(await bundle.sources(main.id)).toEqual([main.id]);
    expect(await bundle.sources(personal.id)).toEqual([personal.id]);
    const before = await bundle.read(); expect(await bundle.initializePersonal()).toEqual(before);
    expect(await bundle.initializePersonal(true)).toEqual(before);
  });
  it('explicitly keeps the old address when enabling the simple UI for an existing account', async () => {
    const bundle = await open(), r = await bundle.initializePersonal(true);
    expect(r.profiles[1]).toMatchObject({ accountId: scope,index: null,name: 'Личный' });
    expect(r.nextIndex).toBe(1); expect(r.connections).toEqual([]);
    expect(await bundle.sources(r.profiles[0].id)).not.toContain(r.profiles[1].id);
  });
  it('creates presets without granting network registration or cross-profile reading', async () => {
    const bundle = await open(); await bundle.initializePersonal();
    const r = await bundle.createPreset('work','Рабочий',true), work = r.profiles.at(-1)!;
    expect(work.role).toBe('custom'); expect(await bundle.sources(work.id)).toEqual([work.id]);
    expect(await bundle.sources(r.profiles[0].id)).toContain(work.id);
    const next = await bundle.createPreset('automation','Автоматизация',false), automation = next.profiles.at(-1)!;
    expect(await bundle.sources(next.profiles[0].id)).not.toContain(automation.id);
    await expect(bundle.createPreset('unknown' as never,'Неизвестный',true)).rejects.toThrow('unknown_profile_preset');
    expect((await bundle.read()).profiles).toEqual(next.profiles);
  });
  it('shows the exact read-all scope in one local consent and rejects changed sources', async () => {
    const bundle = await open(); let r = await bundle.initializePersonal();
    r = await bundle.createPreset('work','Рабочий',false); const work = r.profiles.at(-1)!, main = r.profiles[0];
    const scopeShown = await bundle.sources(main.id);
    r = await bundle.createPreset('incoming','Входящие',true);
    await expect(bundle.configureInbox(work.id,'read-all',true,scopeShown)).rejects.toThrow('profile_consent_changed');
    expect(await bundle.sources(work.id)).toEqual([work.id]);
    const accepted = await bundle.sources(main.id); await bundle.configureInbox(work.id,'read-all',true,accepted);
    expect(await bundle.sources(work.id)).toEqual([work.id,...accepted]);
    const next = await bundle.createPreset('outgoing','Исходящие',true), outgoing = next.profiles.at(-1)!;
    expect(await bundle.sources(work.id)).not.toContain(outgoing.id);
    now += 8 * 86400000; expect(await bundle.sources(work.id)).toEqual([work.id]);
    expect(await bundle.sources(main.id)).toContain(outgoing.id);
  });
  it('can toggle a local contribution repeatedly without accumulating consent records', async () => {
    const bundle = await open(), r = await bundle.initializePersonal(), personal = r.profiles[1];
    for (let i = 0; i < 65; i++) {
      await bundle.configureInbox(personal.id,'contribute',false,[]);
      await bundle.configureInbox(personal.id,'contribute',true,[personal.id]);
    }
    expect((await bundle.read()).connections).toHaveLength(1);
    await bundle.configureInbox(personal.id,'contribute',false,[]);
    expect(await bundle.sources(r.profiles[0].id)).toEqual([r.profiles[0].id]);
  });
  it('owns a detached copy when typed-array slice returns a shared view (like a Node Buffer)', async () => {
    const input = new Uint8Array(new ArrayBuffer(128), 32, 32); input.set(root);
    Object.defineProperty(input, 'slice', { value: () => input.subarray() });
    const before = new Uint8Array(input), bundle = await open(input);
    await bundle.initialize(); bundle.close(); expect(new Uint8Array(input)).toEqual(before);
  });
  it('restores on a fresh device and drops old authorizations durably', async () => {
    const source = await open(); await source.initialize('Личный'); const initial = await source.create('incoming', 'Приём');
    const main = initial.profiles[0], sub = initial.profiles[2];
    let r = await source.request(sub.id, 'contribute', sub.id, now + 86400000);
    r = await source.decide(r.connections[0].id, main.id, 'approve'); source.close();
    factory = new IDBFactory(); const target = await open(); const restored = await target.restore(r);
    expect(restored.profiles).toEqual(r.profiles); expect(restored.connections).toEqual([]);
    expect(await target.read()).toEqual(restored);
    expect((await target.openIdentity(sub.id)).accountId).toBe(sub.accountId);
  });
  it('failed restore never changes the existing encrypted registry', async () => {
    const target = await open(); const r = await target.initialize();
    const changed = structuredClone(r); changed.profiles[0].id = crypto.randomUUID();
    await expect(target.restore(changed)).rejects.toThrow('profile_backup_conflict');
    expect(await target.read()).toEqual(r);
  });
  it('host invalidation prevents late profile writes even without a storage reset', async () => {
    let current = true;
    const bundle = await openBrowserProfileBundle({ root, scope, trusted: true, factory, isCurrent: () => current }); bundles.push(bundle);
    await bundle.initialize(); current = false;
    await expect(bundle.create('outgoing', 'Late')).rejects.toThrow('profile_session_changed');
    current = true; expect((await bundle.read()).profiles).toHaveLength(1);
  });
  it('creates a separate main address while preserving the old account exactly', async () => {
    const bundle = await open(), r = await bundle.initialize('Старый профиль');
    expect(r.profiles).toHaveLength(2); expect(r.profiles[0].accountId).not.toBe(scope);
    expect(r.profiles[1]).toMatchObject({ accountId: scope, index: null, name: 'Старый профиль' });
    const original = await bundle.openIdentity(r.profiles[1].id); expect(original.accountId).toBe(scope); original.close();
    await expect(bundle.openIdentity(r.profiles[0].id)).rejects.toThrow('main_profile_local_only');
  });
  it('assigns distinct keys to incoming/outgoing profiles and regenerates them on reopen', async () => {
    const bundle = await open(); await bundle.initialize(); await bundle.create('incoming', 'Входящая');
    const r = await bundle.create('outgoing', 'Исходящая'); bundle.close();
    expect(new Set(r.profiles.map(p => p.accountId)).size).toBe(3);
    const reopened = await open(); const next = await reopened.read(); expect(next).toEqual(r);
    for (const p of next.profiles.slice(1)) { const identity = await reopened.openIdentity(p.id); expect(identity.accountId).toBe(p.accountId); identity.close(); }
  });
  it('creates concurrent profiles under distinct monotonically allocated indices', async () => {
    const a = await open(), b = await open(); await a.initialize();
    await Promise.all([a.create('incoming', 'Входящая'), b.create('outgoing', 'Исходящая')]);
    const r = await a.read(); expect(r.nextIndex).toBe(3);
    expect(new Set(r.profiles.map(p => p.index)).size).toBe(3);
    expect(new Set(r.profiles.map(p => p.accountId)).size).toBe(3);
  });
  it('persists mutual consent and independent read permissions after reopening', async () => {
    const a = await open(); await a.initialize(); let r = await a.create('incoming', 'Приём');
    const main = r.profiles[0], sub = r.profiles[1];
    r = await a.request(sub.id, 'contribute', sub.id, now + 86400000);
    expect(await a.sources(main.id)).toEqual([main.id]);
    r = await a.decide(r.connections[0].id, main.id, 'approve');
    expect(await a.sources(main.id)).toEqual([main.id, sub.id]);
    expect(await a.sources(sub.id)).toEqual([sub.id]);
    r = await a.request(sub.id, 'read-all', main.id, now + 86400000);
    r = await a.decide(r.connections[1].id, sub.id, 'approve'); a.close();
    const b = await open(); expect(await b.sources(sub.id)).toContain(main.id);
    await b.decide(r.connections[1].id, main.id, 'revoke'); expect(await b.sources(sub.id)).toEqual([sub.id]);
  });
  it('does not leak names/addresses in plaintext or open the user core database', async () => {
    const dbOpen = vi.spyOn(factory, 'open'); const a = await open(); let r = await a.initialize('Частный ник');
    const raw = await createIndexedDbCoreRecords(mapped(), () => {}).read(scope);
    const serialized = new TextDecoder().decode(raw!.cipher);
    expect(serialized).not.toContain('Частный ник'); expect(serialized).not.toContain(r.profiles[0].accountId);
    expect(Object.keys(raw!).sort()).toEqual(['cipher', 'iv', 'revision', 'schema']);
    expect(dbOpen.mock.calls.every(([name]) => name === PROFILE_DATABASE_NAME)).toBe(true);
  });
  it('fails closed for corrupted records and a wrong root without overwriting earlier data', async () => {
    const a = await open(); await a.initialize(); const wrong = root.slice(); wrong[31] = 2;
    const b = await open(wrong); await expect(b.read()).rejects.toThrow();
    const records = createIndexedDbCoreRecords(mapped(), () => {}), raw = await records.read(scope);
    new Uint8Array(raw!.cipher)[0] ^= 1;
    await records.compareAndSwap(scope, raw!.revision, { ...raw!, revision: raw!.revision + 1 });
    await expect(a.read()).rejects.toThrow(); await expect(a.initialize()).rejects.toThrow();
  });
  it('never overwrites an existing registry on initialize', async () => {
    const a = await open(); await a.initialize('До'); await a.create('incoming', 'Приём');
    const before = await a.read(); expect(await a.initialize('После')).toEqual(before);
  });
  it('does not persist an untrusted session', async () => {
    const dbOpen = vi.spyOn(factory, 'open');
    await expect(openBrowserProfileBundle({ root, scope, trusted: false, factory })).rejects.toThrow('profiles_require_trusted_session');
    expect(dbOpen).not.toHaveBeenCalled();
  });
  it('does not change caller root and closes every child signer on lock', async () => {
    const input = root.slice(), a = await open(input); expect(input).toEqual(root);
    await a.initialize(); const r = await a.create('outgoing', 'Отправка');
    const identity = await a.openIdentity(r.profiles[1].id);
    const bytes = new Uint8Array([1, 2]); const signature = await identity.provider.sign(bytes);
    expect(await identity.provider.verify(bytes, signature)).toBe(true);
    a.close(); expect(input).toEqual(root);
    await expect(identity.provider.sign(bytes)).rejects.toThrow('identity_not_initialized');
    await expect(a.create('personal', 'Поздний')).rejects.toThrow('profile_bundle_closed');
  });
  it('blocks pending writes after emergency erasure and keeps the replay DB intact', async () => {
    const a = await open(); await a.initialize();
    const core = createIndexedDbCoreRecords(factory, () => {});
    await core.compareAndSwap(scope, null, { schema: 1, revision: 1, iv: new Uint8Array(12), cipher: new ArrayBuffer(16) });
    beginStorageReset(); await clearAllProfileStorage(factory);
    await expect(a.read()).rejects.toThrow('storage_reset_during_operation');
    expect(await createIndexedDbCoreRecords(mapped(), () => {}).read(scope)).toBeUndefined();
    expect((await core.read(scope))?.revision).toBe(1);
    expect(CORE_DATABASE_NAME).not.toBe(PROFILE_DATABASE_NAME);
  });
  it('reports quota failures, without pretending a profile was created', async () => {
    const a = await open(); await a.initialize();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('disk full', 'QuotaExceededError'); });
    await expect(a.create('incoming', 'Не сохранён')).rejects.toThrow('disk full'); put.mockRestore();
    expect((await a.read()).profiles).toHaveLength(1);
  });
  it('does not resurrect permissions after observing expiry then moving the clock backwards', async () => {
    const a = await open(); await a.initialize(); let r = await a.create('incoming', 'Входящая');
    r = await a.request(r.profiles[1].id, 'contribute', r.profiles[1].id, now + 86400000);
    r = await a.decide(r.connections[0].id, r.profiles[0].id, 'approve');
    now += 86400000; expect(await a.sources(r.profiles[0].id)).toEqual([r.profiles[0].id]);
    now -= 86400000; expect(await a.sources(r.profiles[0].id)).toEqual([r.profiles[0].id]);
  });
  it('a concurrent approval cannot resurrect a revoked request', async () => {
    const a = await open(), b = await open(); await a.initialize(); let r = await a.create('incoming', 'Входящий');
    r = await a.request(r.profiles[1].id, 'contribute', r.profiles[1].id, now + 86400000);
    await Promise.allSettled([a.decide(r.connections[0].id, r.profiles[0].id, 'approve'),
      b.decide(r.connections[0].id, r.profiles[1].id, 'revoke')]);
    expect((await a.read()).connections[0].status).toBe('revoked');
    expect(await a.sources(r.profiles[0].id)).toEqual([r.profiles[0].id]);
  });
  it('rejects late results after close during encryption', async () => {
    const a = await open(); await a.initialize(); let unblock!: () => void, entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { unblock = resolve; });
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => { entered(); await gate; return original(...args); });
    const pending = a.create('incoming', 'Закрытый'); const denied = expect(pending).rejects.toThrow('profile_store_closed');
    await ready; a.close(); unblock(); await denied;
  });
  it('rejects rollback of AAD scope/revision and unsafe registry keys', async () => {
    const key = await deriveProfileRegistryKey(root, scope, crypto.subtle);
    const records = createIndexedDbCoreRecords(mapped(), () => {});
    const store = createProfileRegistryStore({ key, scope, records, subtle: crypto.subtle, now: () => now,
      guard() {}, randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) });
    const a = await open(); await a.initialize(); const raw = await records.read(scope);
    await records.compareAndSwap(scope, raw!.revision, { ...raw!, revision: raw!.revision + 1 });
    await expect(store.read()).rejects.toThrow(); store.close();
    expect(() => createProfileRegistryStore({ key: { ...key, extractable: true } as CryptoKey, scope, records,
      subtle: crypto.subtle, now: () => now, guard() {}, randomBytes: n => new Uint8Array(n) })).toThrow();
  });
});
