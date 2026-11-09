import { createBrowserCoreState } from './browser';
import { deriveCoreStorageKey } from './key';
import { clearAllCoreStorage, CORE_DATABASE_NAME, createIndexedDbCoreRecords } from './indexeddb';
import { createDurableCoreState } from '../core/durable-state';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';

const PREFIX = 'automesh-core-browser-check-v1-';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const GRANT = '12345678-1234-4234-8234-123456789abc';

// Explicit disposable fixture. Only open is exposed; ALL calls are remapped
// to a test-only database. Neither user vault/history nor reset epoch is changed.
export function testCoreFactory(factory: IDBFactory, runId: string): IDBFactory {
  if (!uuid.test(runId)) throw new Error('invalid_browser_check_id');
  return { open(name: string, version?: number) {
    if (name !== CORE_DATABASE_NAME) throw new Error('unexpected_browser_check_database');
    return factory.open(PREFIX + runId, version);
  } } as IDBFactory;
}

export async function openBrowserCoreCheck(runId: string) {
  const factory = testCoreFactory(indexedDB, runId);
  const seed = new Uint8Array(32); seed[31] = 1; // PUBLIC fixture, never an account.
  const provider = new WebCryptoIdentity();
  let key: CryptoKey, accountId: string;
  try {
    accountId = await accountIdFromPublicKey((await provider.fromSeed(seed)).publicKey);
    key = await deriveCoreStorageKey(seed, accountId);
  } finally { seed.fill(0); provider.dispose(); }
  const adapters = new Set<ReturnType<typeof createBrowserCoreState>>();
  const open = () => {
    const state = createBrowserCoreState({ accountId, key, trusted: true, factory });
    adapters.add(state); return state;
  };
  const close = () => { for (const state of adapters) state.close(); adapters.clear(); };
  const ensure = (value: boolean, message: string) => { if (!value) throw new Error(message); };
  const expectDenied = async (work: () => Promise<unknown>, code: string) => {
    try { await work(); } catch (error) {
      if (error instanceof Error && (error.message === code || error.name === code)) return;
      throw error;
    }
    throw new Error('expected_denial_missing:' + code);
  };
  return {
    async prepare(report: (message: string) => void) {
      close(); await clearAllCoreStorage(factory);
      const state = open(), expiry = Date.now() + 3600000;
      ensure(await state.replayStore.claim('persisted-fixture', expiry, Date.now()), 'fixture_not_saved');
      await state.policyStore.initialize({ issuer: accountId, recipient: accountId, resource: 'document:fixture', epoch: 1, validUntil: expiry });
      await state.policyStore.apply({ issuer: accountId, recipient: accountId, resource: 'document:fixture', epoch: 1, validUntil: expiry, sequence: 1, revoked: [GRANT] });
      report('Подготовлено: отметка операции и отзыв сохранены в отдельной тестовой базе.');
      state.close();
      report('Тестовый сеанс закрыт. Можно перезагрузить страницу, закрыть/открыть вкладку или открыть вторую.');
    },
    async verify(report: (message: string) => void) {
      const state = open();
      const policy = await state.policyStore.read(accountId, 'document:fixture');
      ensure(policy.epoch === 1, 'fixture_policy_missing');
      ensure(!await state.replayStore.claim('persisted-fixture', Date.now() + 3600000, Date.now()), 'fixture_replay_not_preserved');
      ensure(await state.policyStore.isRevoked(accountId, 'document:fixture', 1, GRANT), 'fixture_revocation_not_preserved');
      report('ПРОШЛО: операция не принята повторно, отзыв сохранился после повторного открытия.');
      state.close();
    },
    async race(report: (message: string) => void) {
      const state = open();
      try {
        const accepted = await state.replayStore.claim('cross-tab-race', Date.now() + 3600000, Date.now());
        report(accepted ? 'ГОНКА: операция принята этой вкладкой.' : 'ГОНКА: повтор отклонён этой вкладкой.');
      } finally { state.close(); }
    },
    async regress(report: (message: string) => void) {
      const expiry = Date.now() + 3600000, id = crypto.randomUUID();
      const one = open(), two = open();
      const claims = await Promise.all([one.replayStore.claim(id, expiry, Date.now()), two.replayStore.claim(id, expiry, Date.now())]);
      ensure(claims.filter(Boolean).length === 1, 'concurrent_duplicate_accepted');
      report('ПРОШЛО: настоящие IndexedDB-транзакции — два адаптера, только одно принятие.');
      one.close(); await expectDenied(() => one.replayStore.claim('closed', expiry, Date.now()), 'core_state_closed');
      report('ПРОШЛО: закрытый сеанс не возобновляет запись.');
      let reset = false;
      const records = createIndexedDbCoreRecords(factory, () => { if (reset) throw new Error('simulated_storage_reset'); });
      const state = createDurableCoreState({ scope: accountId, key, records,
        environment: { subtle: crypto.subtle, now: () => Date.now(), newId: () => crypto.randomUUID() },
        randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) });
      reset = true;
      try { await expectDenied(() => state.replayStore.claim('reset', expiry, Date.now()), 'simulated_storage_reset'); }
      finally { state.close(); records.close(); }
      report('ПРОШЛО: имитация сброса блокирует старый адаптер; настоящий сброс приложения не выполнялся.');
      const raw = createIndexedDbCoreRecords(factory, () => {}), original = await raw.read(accountId);
      ensure(!!original, 'fixture_missing');
      if (!original) throw new Error('fixture_missing');
      const changed = { ...original, revision: original.revision + 1, cipher: original.cipher.slice(0) };
      new Uint8Array(changed.cipher)[0] ^= 1;
      ensure(await raw.compareAndSwap(accountId, original.revision, changed), 'fixture_write_race');
      try { await expectDenied(() => two.replayStore.claim('corrupt', expiry, Date.now()), 'OperationError'); }
      finally {
        // Restoring old cipher with a different revision would invalidate AAD.
        // Finish only this disposable case; do not try to repair user data.
        close(); raw.close(); await clearAllCoreStorage(factory);
      }
      report('ПРОШЛО: повреждённое состояние отклонено; очищена только тестовая база этого прогона.');
    },
    async clear() { close(); await clearAllCoreStorage(factory); },
    close,
  };
}
