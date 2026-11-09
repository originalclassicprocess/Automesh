import { profileRegistrySnapshot, visibleInboxSources, type ProfileEntry, type ProfileRegistry } from '../core/profiles';
import { deriveProfileSeed } from './keys';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { deriveChatStoreKey, loadLocalChatData, snapshotLocalChatData, type LocalChatData } from '../chat/local-store';
import type { ChatEntry, SavedChats } from '../chat/session-chats';
import { isValidAccountId } from '../addressing/bech32m.js';
import { deriveOwnerDeviceKey } from '../devices/owner-browser';

export type ProfileChatContext = {
  profile: ProfileEntry | null; accountId: string; provider: WebCryptoIdentity;
  key: CryptoKey; deviceKey?: CryptoKey; data: LocalChatData | undefined; network: boolean; close(): void;
};
type HistoryReader = (key: CryptoKey, accountId: string) => Promise<LocalChatData | null | undefined>;

// Preflight only: no registration, old-session mutation, or plaintext persistence.
// The host commits a context only after stopping and saving its previous one.
export async function prepareProfileChatContext(options: {
  root: Uint8Array; owner: string; registry: ProfileRegistry | null; profileId?: string;
  read?: HistoryReader; guard(): void;
}): Promise<ProfileChatContext> {
  const root = new Uint8Array(options.root), provider = new WebCryptoIdentity();
  let child: Uint8Array | undefined;
  try {
    if (root.length !== 32) throw new Error('invalid_profile_root');
    options.guard();
    const owner = new WebCryptoIdentity();
    try {
      await owner.fromSeed(root); options.guard();
      if (await accountIdFromPublicKey(await owner.getPublicKeyBytes()) !== options.owner) throw new Error('profile_owner_mismatch');
    } finally { owner.dispose(); }
    const registry = options.registry ? profileRegistrySnapshot(options.registry) : null;
    const profile = options.profileId
      ? registry?.profiles.find(p => p.id === options.profileId)
      : registry?.profiles.find(p => p.index === null);
    if (options.profileId && !profile || profile?.archived) throw new Error('profile_identity_unavailable');
    child = profile && profile.index !== null ? await deriveProfileSeed(root, profile.index, crypto.subtle) : new Uint8Array(root);
    options.guard(); await provider.fromSeed(child); options.guard();
    const accountId = await accountIdFromPublicKey(await provider.getPublicKeyBytes()); options.guard();
    if (accountId !== (profile?.accountId ?? options.owner)) throw new Error('profile_address_mismatch');
    const key = await deriveChatStoreKey(child, accountId); options.guard();
    const deviceKey = await deriveOwnerDeviceKey(root, accountId); options.guard();
    const data = await (options.read ?? loadLocalChatData)(key, accountId); options.guard();
    return { profile: profile ?? null, accountId, provider, key, deviceKey,
      data: data ? snapshotLocalChatData(data) : undefined, network: profile?.role !== 'main',
      close: () => provider.dispose() };
  } catch (error) { provider.dispose(); throw error; }
  finally { child?.fill(0); root.fill(0); }
}

export type ProfileInboxSource = {
  profile: ProfileEntry; data: Pick<LocalChatData, 'selfNickname' | 'aliases' | 'declaredNames' | 'chats'>;
  windows: Record<string, { total: number; start: number; end: number }>;
};
export type InboxFocus = { profileId: string; peer: string; before?: number };
export type ProfileInboxPage = { sources: ProfileInboxSource[]; page: number; totalChats: number; focus?: InboxFocus };
export const INBOX_CHATS_PER_PAGE = 20, INBOX_MESSAGES_PER_CHAT = 50;
// Adoption is synchronous: no partially adopted state across an await boundary.
export async function commitProfileChatContext(context: ProfileChatContext, port: {
  guard(): void; stop(): Promise<void>; save(): Promise<boolean>; adopt(context: ProfileChatContext): void;
  refresh?(context: ProfileChatContext): Promise<void>;
}): Promise<void> {
  port.guard(); await port.stop(); port.guard();
  if (!await port.save()) throw new Error('profile_previous_history_not_saved');
  port.guard(); await port.refresh?.(context);
  port.guard(); port.adopt(context);
}
// Bound the retained/UI model, not the durable archive. The existing archive is
// one encrypted record per profile and still requires a transient full decode.
// Never retain private delivery state in the inbox, nor silently truncate disk data.
export async function readProfileInbox(options: {
  root: Uint8Array; owner: string; registry: ProfileRegistry; viewer: string;
  now: number; read?: HistoryReader; guard(): void; page?: number; focus?: InboxFocus;
}): Promise<ProfileInboxPage> {
  const registry = profileRegistrySnapshot(options.registry);
  const sources = visibleInboxSources(registry, options.viewer, options.now);
  const page = options.page ?? 0, focus = options.focus;
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000000 || focus &&
      (!sources.includes(focus.profileId) || !isValidAccountId(focus.peer) || focus.before !== undefined &&
      (!Number.isSafeInteger(focus.before) || focus.before < 0))) throw new Error('invalid_inbox_page');
  const result: ProfileInboxSource[] = [];
  let totalChats = 0;
  const root = new Uint8Array(options.root), owner = new WebCryptoIdentity();
  try {
    await owner.fromSeed(root); options.guard();
    if (await accountIdFromPublicKey(await owner.getPublicKeyBytes()) !== options.owner) throw new Error('profile_owner_mismatch');
    owner.dispose();
  for (const id of sources) {
    options.guard();
    if (focus && id !== focus.profileId) continue;
    const profile = registry.profiles.find(p => p.id === id)!;
    let seed: Uint8Array | undefined;
    try {
      seed = profile.index === null ? new Uint8Array(root) : await deriveProfileSeed(root,profile.index,crypto.subtle);
      // The history key is bound to BOTH the private derivation and the address.
      // No additional signing identities or copy of the full archive is retained.
      const key = await deriveChatStoreKey(seed,profile.accountId); seed.fill(0); options.guard();
      const data = await (options.read ?? loadLocalChatData)(key,profile.accountId); options.guard();
      if (data) {
        const peers = data.chats.order.filter(peer => data.chats.byPeer[peer] && (!focus || peer === focus.peer));
        const selected = focus ? peers : peers.filter((_peer, index) => {
          const position = totalChats + index;
          return position >= page * INBOX_CHATS_PER_PAGE && position < (page + 1) * INBOX_CHATS_PER_PAGE;
        });
        totalChats += peers.length;
        const chats: SavedChats = { order: selected, byPeer: {} };
        const aliases: Record<string,string> = {}, declaredNames: Record<string,string> = {};
        const windows: ProfileInboxSource['windows'] = {};
        for (const peer of selected) {
          const messages = data.chats.byPeer[peer].messages;
          const end = Math.min(focus?.before ?? messages.length, messages.length), start = Math.max(0, end - INBOX_MESSAGES_PER_CHAT);
          windows[peer] = { total: messages.length, start, end };
          chats.byPeer[peer] = { messages: messages.slice(start,end).map(message => {
            // Keep only renderable fields, with bounded previews (full content in source).
            const view: ChatEntry = { id: message.id, from: message.from, direction: message.direction,
              timestamp: message.timestamp, text: message.text.slice(0,1000) + (message.text.length > 1000 ? '…' : '') };
            if (message.file) view.file = { ...message.file };
            return view;
          }) };
          aliases[peer] = data.aliases[peer] ?? ''; declaredNames[peer] = data.declaredNames[peer] ?? '';
        }
        if (selected.length) result.push({ profile, data: { selfNickname: data.selfNickname, aliases, declaredNames, chats }, windows });
      }
    } finally { seed?.fill(0); }
  }
  options.guard(); return { sources: result, page, totalChats, ...(focus ? { focus: { ...focus } } : {}) };
  } finally { root.fill(0); owner.dispose(); }
}
