import { normalizeLocalChatData, openSealedChatData, openSealedFileData, snapshotLocalStorage, type LocalChatData } from '../chat/local-store';
import { dataOnlyChatData } from '../backup/data-backup';
import { MAX_FULL_BACKUP_BYTES, referencedBackupFiles, type BackupProfile } from '../backup/full-backup';
import { emptySessionChats, restoreChats, type ChatEntry, type SessionChats } from '../chat/session-chats';
import { canonicalJson } from '../core/canonical';

export const HISTORY_MAX_BYTES = MAX_FULL_BACKUP_BYTES;
export function selectHistoryData(input: LocalChatData, peers: readonly string[]): LocalChatData {
  const source = dataOnlyChatData(input), chosen = new Set(peers);
  // History is not a settings/credentials import. In particular no device
  // authority, queued sends, prekeys, node URLs, profiles or recovery metadata.
  const data = normalizeLocalChatData({ chats: { order: [], byPeer: {} } });
  for (const peer of source.chats.order) if (chosen.has(peer)) {
    const conversation = source.chats.byPeer[peer];
    const ids = new Set<string>();
    for (const message of conversation.messages) {
      if (ids.has(message.id)) throw new Error('history_message_conflict');
      ids.add(message.id);
    }
    data.chats.order.push(peer);
    data.chats.byPeer[peer] = { contact: conversation.contact, messages: conversation.messages.filter(m => !m.details?.pin).map(message => {
      const copy = { ...message, restoredFromBackup: true, importedFromDevice: true as const };
      delete copy.delivery; delete copy.forwardedTo;
      if (copy.direction === 'incoming') copy.readState = 'skipped';
      if (copy.file) { copy.fileAccepted = false; copy.fileProgress = 0; copy.fileStatus = 'canceled'; }
      return copy;
    }) };
    if (source.aliases[peer]) data.aliases[peer] = source.aliases[peer];
    if (source.declaredNames[peer]) data.declaredNames[peer] = source.declaredNames[peer];
  }
  return data;
}

export async function captureDeviceHistory(owner: string, key: CryptoKey, peers: readonly string[], attachments: boolean,
  guard: () => void): Promise<BackupProfile> {
  const prefixes = peers.map(peer => `${peer}:`);
  guard(); const saved = await snapshotLocalStorage([owner], HISTORY_MAX_BYTES + 20 * 1024 * 1024, guard,
    file => attachments && prefixes.some(prefix => file.id.startsWith(prefix))); guard();
  const record = saved.accounts.find(item => item.accountId === owner);
  const data = selectHistoryData(record ? await openSealedChatData(key, owner, record) : normalizeLocalChatData({}), peers);
  guard(); const profile: BackupProfile = { accountId: owner, data, files: new Map() };
  try {
    if (attachments) for (const id of referencedBackupFiles(data).keys()) {
      const file = saved.files.find(item => item.id === id);
      if (file) { profile.files.set(id, await openSealedFileData(key, owner, id, file)); guard(); }
    }
    return profile;
  } catch (error) { for (const bytes of profile.files.values()) bytes.fill(0); throw error; }
}

const content = (message: ChatEntry) => canonicalJson({ from: message.from, direction: message.direction, text: message.text,
  details: message.details ?? null, file: message.file ?? null, localCall: message.localCall ?? null });
export function requireHistoryConsistency(current: LocalChatData, incoming: LocalChatData): void {
  for (const peer of incoming.chats.order) {
    const previous = current.chats.byPeer[peer]; if (!previous) continue;
    const byId = new Map(previous.messages.map(message => [message.id, message]));
    for (const message of incoming.chats.byPeer[peer].messages) {
      const old = byId.get(message.id);
      if (old && content(old) !== content(message)) throw new Error('history_message_conflict');
    }
  }
}
// Historical overlay only. Live data always owns drafts, permissions, delivery,
// read receipts and tombstones. This result is NEVER a runtime outbox input.
export function historyView(live: SessionChats, history: LocalChatData | null): SessionChats {
  const result: SessionChats = { ...live, order: [...live.order], byPeer: { ...live.byPeer } };
  for (const peer of result.order) result.byPeer[peer] = { ...result.byPeer[peer], messages: [...result.byPeer[peer].messages].sort((a,b) => a.timestamp-b.timestamp) };
  if (!history) return result;
  const archived = restoreChats(history.chats);
  for (const peer of archived.order) {
    const old = result.byPeer[peer], from = archived.byPeer[peer];
    if (!old) { result.order.push(peer); result.byPeer[peer] = { ...from, messages: [...from.messages].sort((a,b) => a.timestamp-b.timestamp), unread: 0 }; continue; }
    const known = new Set([...old.messages.map(m => m.id), ...(old.deletedIds ?? [])]);
    result.byPeer[peer] = { ...old, messages: [...from.messages.filter(m => !known.has(m.id)), ...old.messages]
      .sort((a, b) => a.timestamp - b.timestamp) };
  }
  return result;
}

function boundedHistory(data: LocalChatData): LocalChatData {
  if (data.chats.order.length > 10000 || data.chats.order.reduce((n, peer) => n + data.chats.byPeer[peer].messages.length, 0) > 100000 ||
    new TextEncoder().encode(JSON.stringify(data)).length > 16 * 1024 * 1024) throw new Error('history_capacity');
  return data;
}
export function mergeHistory(previous: LocalChatData | null, profile: BackupProfile): LocalChatData {
  const source = selectHistoryData(profile.data, profile.data.chats.order);
  for (const peer of source.chats.order) for (const message of source.chats.byPeer[peer].messages) if (message.file && !message.fileDeleted) {
    const file = profile.files.get(`${peer}:${message.file.id}`);
    message.fileStatus = file ? 'ready' : 'canceled'; message.fileProgress = file?.length ?? 0;
  }
  if (!previous) return boundedHistory(source);
  requireHistoryConsistency(previous, source);
  const next = normalizeLocalChatData(previous);
  for (const peer of source.chats.order) {
    const old = next.chats.byPeer[peer], incoming = source.chats.byPeer[peer];
    if (!old) { next.chats.order.push(peer); next.chats.byPeer[peer] = incoming; }
    else {
      const ids = new Set([...old.messages.map(m => m.id), ...(old.deletedIds ?? [])]);
      old.messages.push(...incoming.messages.filter(m => !ids.has(m.id)));
      for (const message of old.messages) if (message.file && !message.fileDeleted && profile.files.has(`${peer}:${message.file.id}`)) {
        message.fileStatus = 'ready'; message.fileProgress = message.file.size;
      }
      old.messages.sort((a, b) => a.timestamp - b.timestamp);
    }
    if (!next.aliases[peer] && source.aliases[peer]) next.aliases[peer] = source.aliases[peer];
    if (!next.declaredNames[peer] && source.declaredNames[peer]) next.declaredNames[peer] = source.declaredNames[peer];
  }
  return boundedHistory(next);
}
