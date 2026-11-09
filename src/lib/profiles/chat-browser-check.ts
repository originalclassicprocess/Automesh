// PUBLIC, offline-only fixture. No real vault, history, transport or node access.
import { CORE_DATABASE_NAME, createIndexedDbCoreRecords } from '../core-storage/indexeddb';
import { UUID_PATTERN } from '../core/objects';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { profileCheckFactory } from './browser-check';
import { openBrowserProfileBundle, withBrowserProfileSelection } from './browser';
import { resolveProfileSelection } from './selection';
import { prepareProfileChatContext, commitProfileChatContext, readProfileInbox, type InboxFocus, type ProfileChatContext } from './chat-context';
import { snapshotLocalChatData, type LocalChatData } from '../chat/local-store';
import { emptySessionChats, saveChats } from '../chat/session-chats';
export const PROFILE_CHAT_TEST_PASSWORD = 'public-test-password';
export async function openProfileChatBrowserCheck(run: string, factory: IDBFactory = indexedDB) {
  if (!UUID_PATTERN.test(run)) throw new Error('invalid_profile_check_id');
  const root = new Uint8Array(32); root[31] = 1;
  const identity = new WebCryptoIdentity(), scope = await accountIdFromPublicKey((await identity.fromSeed(root)).publicKey); identity.dispose();
  let closed = false, context: ProfileChatContext | undefined;
  const guard = () => { if (closed) throw new Error('test_session_closed'); };
  const profileFactory = profileCheckFactory(factory,run);
  const bundle = await openBrowserProfileBundle({ root, scope, trusted: true, factory: profileFactory, isCurrent: () => !closed });
  const records = createIndexedDbCoreRecords({ open(name,v) {
    if (name !== CORE_DATABASE_NAME) throw new Error('unexpected_test_history_database');
    return factory.open('automesh-profile-chat-check-v1-' + run,v);
  } } as IDBFactory, guard);
  const aad = (accountId: string, revision: number) => new TextEncoder().encode(JSON.stringify(['PUBLIC Automesh profile chat check v1',accountId,revision]));
  const read = async (key: CryptoKey, accountId: string): Promise<LocalChatData | undefined> => {
    const sealed = await records.read(accountId); if (!sealed) return undefined;
    const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv), additionalData: aad(accountId,sealed.revision) },key,sealed.cipher));
    try { guard(); return JSON.parse(new TextDecoder().decode(bytes)); }
    finally { bytes.fill(0); }
  };
  const save = async () => {
    guard(); if (!context) return false;
    const account = context, previous = await records.read(account.accountId), revision = (previous?.revision ?? 0) + 1;
    const bytes = new TextEncoder().encode(JSON.stringify(account.data)), iv = crypto.getRandomValues(new Uint8Array(12));
    let cipher: ArrayBuffer;
    try { cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(account.accountId,revision) },account.key,bytes); }
    finally { bytes.fill(0); }
    guard(); return records.compareAndSwap(account.accountId,previous?.revision ?? null,{ schema: 1, revision, iv, cipher });
  };
  const empty = (): LocalChatData => ({ selfNickname: '', readReceiptsEnabled: true, autoLockMinutes: 5,
    aliases: {}, declaredNames: {}, peerPublicKeys: {}, peerReadPreferences: {}, chats: saveChats(emptySessionChats()) });
  try {
    await bundle.initialize('Старый личный'); let registry = await bundle.read();
    if (!registry.profiles.some(p => p.role === 'incoming')) registry = await bundle.create('incoming','Приём');
    if (!registry.profiles.some(p => p.role === 'outgoing')) registry = await bundle.create('outgoing','Отправка');
    const state = () => ({ registry, profile: context?.profile ?? null, accountId: context?.accountId ?? '', network: context?.network ?? false,
      data: context?.data ? snapshotLocalChatData(context.data) : null });
    const preference = <T>(work: Parameters<typeof withBrowserProfileSelection<T>>[1]) => withBrowserProfileSelection({ root, scope, trusted: true, factory: profileFactory, guard },work);
    async function unlock(password: string) {
      if (password !== PROFILE_CHAT_TEST_PASSWORD) return false;
      guard(); registry = await bundle.read();
      const selected = resolveProfileSelection(registry,await preference(s => s.read()));
      const next = await prepareProfileChatContext({ root, owner: scope, registry, profileId: selected, read, guard });
      next.data ??= empty(); context?.close(); context = next; return true;
    }
    await unlock(PROFILE_CHAT_TEST_PASSWORD);
    return {
      state,
      async switchProfile(id: string, password: string) {
        if (password !== PROFILE_CHAT_TEST_PASSWORD) return false;
        guard(); registry = await bundle.read();
        const next = await prepareProfileChatContext({ root, owner: scope, registry, profileId: id, read, guard });
        next.data ??= empty();
        try {
          await commitProfileChatContext(next,{ guard, stop: async () => {},
            save,
            refresh: async selected => { selected.data = await read(selected.key,selected.accountId) ?? empty(); await preference(s => s.save(id)); },
            adopt: selected => { context?.close(); context = selected; } });
          return true;
        } catch (error) { next.close(); throw error; }
      },
      async addSaved(text: string) {
        guard(); if (!context?.data) throw new Error('test_locked');
        const data = context.data, peer = context.accountId;
        if (!data.chats.byPeer[peer]) { data.chats.order.push(peer); data.chats.byPeer[peer] = { messages: [], contact: 'accepted' }; }
        data.chats.byPeer[peer].messages.push({ id: crypto.randomUUID(), text, from: peer, timestamp: Date.now(), direction: 'outgoing' });
        if (!await save()) throw new Error('test_save_failed');
      },
      inbox: (page = 0, focus?: InboxFocus) => readProfileInbox({ root, owner: scope, registry, viewer: context!.profile!.id, now: Date.now(), guard, read, page, focus }),
      async allInbox(page = 0, focus?: InboxFocus) {
        guard(); registry = await bundle.read();
        if (!await save()) throw new Error('test_save_failed');
        return readProfileInbox({ root,owner: scope,registry,viewer: registry.profiles.find(p => p.role === 'main')!.id,
          now: Date.now(),guard,read,page,focus });
      },
      async lock() { if (!await save()) throw new Error('test_save_failed'); context?.close(); context = undefined; },
      unlock,
      close() { closed = true; context?.close(); context = undefined; root.fill(0); bundle.close(); records.close(); },
    };
  } catch (error) { closed = true; root.fill(0); bundle.close(); records.close(); throw error; }
}
