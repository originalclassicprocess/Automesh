import { inlineMediaFor } from '$lib/chat/media-preview';
import type { SessionChats } from '$lib/chat/session-chats';
import type { LocalChatData, StorageInventory } from '$lib/chat/local-store';
import { pruneCourierFiles } from '$lib/node/courier-state';
import { isLibraryFileId, libraryFileId, type MediaLibrary } from '$lib/chat/media-library';
import type { AppCacheUsage } from './app-cache';
import { nativeChannelToken, nativeMessageKey } from '$lib/radio/native-channels';
import { groupFileStorageId } from '$lib/groups/attachments';
import { groupVisible, type GroupRooms } from '$lib/groups/storage';
export type FileCategory = 'image' | 'audio' | 'video' | 'other';
export type ManagedFile = { id: string; peer: string; messageId: string; name: string; category: FileCategory; bytes: number; memoryBytes: number; timestamp?: number; shared?: boolean; stickerPack?: true };
export const categoryNames: Record<FileCategory, string> = { image: 'Изображения', audio: 'Аудио', video: 'Видео', other: 'Другие файлы' };
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Неизвестно';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
export function managedFiles(state: SessionChats, disk: StorageInventory, memory: ReadonlyMap<string, Uint8Array>, library?: MediaLibrary,
  groups: GroupRooms = []): ManagedFile[] {
  const stored = new Map(disk.files.map(file => [file.id, file.bytes]));
  const ids = new Set([...stored.keys(), ...memory.keys()]);
  const libraryIds = new Set(library?.assets.map(a => a.id));
  const entries = new Map<string, Omit<ManagedFile, 'id' | 'bytes' | 'memoryBytes'>>();
  for (const peer of state.order) for (const message of state.byPeer[peer].messages) {
    if (!message.file) continue;
    const id = `${peer}:${message.id}`;
    const shared = !message.fileDeleted && !!message.mediaRef && libraryIds.has(message.mediaRef) && ids.has(libraryFileId(message.mediaRef));
    if (shared) ids.add(id);
    entries.set(id, { peer, messageId: message.id, name: message.file.name, shared,
      ...(message.details?.media?.kind === 'sticker-pack' ? { stickerPack:true } : {}),
      category: inlineMediaFor(message.file)?.kind ?? 'other', timestamp: message.timestamp });
  }
  for (const room of groups.filter(groupVisible)) for (const message of room.entries) {
    if (!message.file) continue;
    entries.set(groupFileStorageId(room.id, message.hash), {
      peer:room.id, messageId:message.hash, name:message.file.name,
      category:inlineMediaFor(message.file)?.kind ?? 'other', timestamp:message.sentAt,
    });
  }
  return [...ids].filter(id => !isLibraryFileId(id)).map(id => ({ id, ...(entries.get(id) ?? { peer: '', messageId: '', name: 'Файл вне истории', category: 'other' as const }),
    bytes: stored.get(id) ?? 0, memoryBytes: memory.get(id)?.byteLength ?? 0 }));
}

export function measureMediaLibrary(disk: StorageInventory, library: MediaLibrary) {
  const sizes = new Map(disk.files.filter(file => isLibraryFileId(file.id)).map(file => [file.id, file.bytes]));
  const gifHashes = new Set(library.gifs);
  const packHashes = new Set(library.packs.flatMap(pack => pack.assets));
  const bytes = { gifs: 0, packs: 0, shared: 0, cached: 0 };
  for (const asset of library.assets) {
    const id = libraryFileId(asset.id);
    const size = sizes.get(id) ?? 0;
    sizes.delete(id);
    const gif = gifHashes.has(asset.hash), pack = packHashes.has(asset.hash);
    bytes[gif && pack ? 'shared' : gif ? 'gifs' : pack ? 'packs' : 'cached'] += size;
  }
  for (const size of sizes.values()) bytes.cached += size;
  return bytes;
}

export type StorageOverview = {
  app: AppCacheUsage | null; origin?: number; history: number; other: number; modelBytes: number;
  incomplete: boolean; media: ReturnType<typeof measureMediaLibrary>;
};

export const sumBytes = (values: Iterable<number>) => Array.from(values).reduce((total, bytes) => total + bytes, 0);

export function storageBreakdown(usage: StorageOverview, files: ManagedFile[]) {
  const groups = [
    { id: 'app', bytes: usage.app ? usage.app.shell + usage.app.scripts + usage.app.styles : 0 },
    { id: 'history', bytes: usage.history },
    { id: 'files', bytes: sumBytes(files.map(file => file.bytes)) },
    { id: 'models', bytes: usage.modelBytes + (usage.app?.ai ?? 0) },
    { id: 'library', bytes: sumBytes(Object.values(usage.media)) },
    { id: 'profiles', bytes: usage.other },
  ] as const;
  const measured = sumBytes(groups.map(group => group.bytes));
  const origin = typeof usage.origin === 'number' && Number.isFinite(usage.origin) && usage.origin >= 0 ? usage.origin : undefined;
  const total = Math.max(origin ?? 0, measured);
  return { total, origin, measured, estimated: origin !== undefined && origin >= measured,
    groups: [...groups, { id: 'browser' as const, bytes: total - measured }] };
}

// A resident copy does not occupy a second file slot on disk.
export const fileBytes = (file: ManagedFile): number => file.bytes || file.memoryBytes;
export type StorageFilter = { category?: string; peer?: string | null; query?: string; from?: string; to?: string; sort?: string };
export function filterStoredFiles(files: ManagedFile[], filter: StorageFilter): ManagedFile[] {
  const day = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return NaN;
    const [year, month, date] = match.slice(1).map(Number);
    const result = new Date(year, month - 1, date);
    return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === date ? result.getTime() : NaN;
  };
  const from = filter.from ? day(filter.from) : -Infinity;
  const lastDay = filter.to ? day(filter.to) : Infinity;
  const end = Number.isFinite(lastDay) ? new Date(lastDay) : null;
  if (end) end.setDate(end.getDate() + 1); // Local midnight, including daylight-saving transitions.
  const until = end?.getTime() ?? lastDay;
  const query = filter.query?.trim().toLocaleLowerCase() ?? '';
  return files.filter(file => (!filter.category || filter.category === 'all' || file.category === filter.category) &&
    (filter.peer == null || file.peer === filter.peer) && (!query || file.name.toLocaleLowerCase().includes(query)) &&
    (!(filter.from || filter.to) || (file.timestamp !== undefined && file.timestamp >= from && file.timestamp < until)))
    .sort((a, b) => filter.sort === 'size' ? fileBytes(b) - fileBytes(a) || a.id.localeCompare(b.id)
      : (b.timestamp ?? 0) - (a.timestamp ?? 0) || a.id.localeCompare(b.id));
}
export type ChatStorageUsage = { peer: string; bytes: number; historyBytes: number; files: number; messages: number };
export function chatStorageUsage(state: SessionChats, files: ManagedFile[], rooms: GroupRooms = []): ChatStorageUsage[] {
  const groups = new Map<string, ChatStorageUsage>();
  for (const peer of state.order) {
    const messages = state.byPeer[peer]?.messages ?? [];
    groups.set(peer, {peer, bytes:0, historyBytes:messages.length ? new TextEncoder().encode(JSON.stringify(messages)).byteLength : 0, files:0, messages:messages.length});
  }
  for (const room of rooms.filter(groupVisible)) groups.set(room.id, {
    peer:room.id, bytes:0, historyBytes:new TextEncoder().encode(JSON.stringify(room.entries)).byteLength,
    files:0, messages:room.entries.length,
  });
  for (const file of files) {
    const group = groups.get(file.peer) ?? {peer:file.peer, bytes:0, historyBytes:0, files:0, messages:0};
    group.bytes += fileBytes(file); group.files++; groups.set(file.peer, group);
  }
  return [...groups.values()].sort((a,b) => b.bytes + b.historyBytes - a.bytes - a.historyBytes || a.peer.localeCompare(b.peer));
}

export type ChatStorageCleanup =
  | { kind: 'files'; label: string; ids: string[] }
  | { kind: 'all-files' }
  | { kind: 'chat-files'; peers: string[] }
  | { kind: 'chat'; peer: string }
  | { kind: 'ai-chat' }
  | { kind: 'radio-chat'; token: string; name: string }
  | { kind: 'history' };
export type LocalTranscriptStorage = { title: string; messages: number; bytes: number;
  action: Extract<ChatStorageCleanup, { kind: 'ai-chat' | 'radio-chat' }> };
export type StorageCleanup = ChatStorageCleanup | { kind: 'sticker-packs' } | { kind: 'ai-runtime' };

export function withoutStickerPacks(library: MediaLibrary): MediaLibrary {
  const packHashes = new Set(library.packs.flatMap(pack => pack.assets));
  const kept = new Set([...library.gifs, ...(library.cached ?? [])]);
  return { ...library, packs: [], assets: library.assets.filter(asset => !packHashes.has(asset.hash) || kept.has(asset.hash)) };
}

// The same policy is applied to the runtime and the old encrypted snapshot.
// Volatile messages are never written to disk while cleaning an untrusted session.
export function prepareChatStorageCleanup(data: LocalChatData, choice: ChatStorageCleanup, localIds: Iterable<string>) {
  const peers = new Set(choice.kind === 'chat-files' ? choice.peers : choice.kind === 'chat' ? [choice.peer] : []);
  const matched = choice.kind === 'files' ? new Set(choice.ids) : new Set<string>();
  const removed = new Set<string>();
  const matchFile = (key: string) => !isLibraryFileId(key) &&
    (choice.kind === 'all-files' || matched.has(key) || (key.includes(':') &&
      peers.has(key.startsWith('group-file:') ? key.split(':', 2)[1] : key.split(':', 1)[0])));
  const ids = new Set([...localIds].filter(matchFile));
  for (const incoming of data.courierState?.incomingFiles ?? []) {
    const { from, id } = incoming.job.body;
    const key = `${from}:${id}`;
    const chunks = Array.from({length: incoming.manifest.attachment.chunks}, (_, index) => `${key}:courier:${index}`);
    if (matchFile(key) || chunks.some(chunk => ids.has(chunk))) {
      ids.add(key);
      for (const chunk of chunks) ids.add(chunk);
    }
  }
  const byPeer: LocalChatData['chats']['byPeer'] = { ...data.chats.byPeer };
  for (const peer of data.chats.order) {
    const conversation = byPeer[peer];
    const deletedIds = new Set(conversation.deletedIds);
    const messages = conversation.messages.flatMap(message => {
      const key = `${peer}:${message.id}`;
      if (choice.kind === 'chat' && peer === choice.peer || choice.kind === 'history' && !message.file) {
        removed.add(key); deletedIds.add(message.id);
        return [];
      }
      if (!message.file || (!ids.has(key) && !matchFile(key))) return [message];
      ids.add(key);
      return [{ ...message, fileDeleted: true, fileStatus: 'canceled' as const, fileAccepted: false, fileProgress: 0 }];
    });
    byPeer[peer] = { ...conversation, messages, ...(deletedIds.size ? { deletedIds: [...deletedIds] } : {}) };
  }
  const drop = (peer: string, id: string) => removed.has(`${peer}:${id}`) || ids.has(`${peer}:${id}`) || choice.kind === 'chat' && peer === choice.peer;
  const clearRadio = choice.kind === 'history' || choice.kind === 'radio-chat';
  const snapshot: LocalChatData = { ...data, chats: { ...data.chats, byPeer },
    ...(choice.kind === 'history' || choice.kind === 'ai-chat' ? { localAgentHistory: [] } : {}),
    ...(clearRadio && data.meshtastic ? {
      meshtastic: { ...data.meshtastic, channels: data.meshtastic.channels.map(channel =>
        choice.kind === 'radio-chat' && nativeChannelToken(channel) !== choice.token ? channel : {
        ...channel, messages: [], reactions: [], unread: 0, draft: '', replyId: undefined,
        deleted: [...new Set([...(channel.deleted ?? []), ...channel.messages.map(nativeMessageKey)])].slice(-2000),
      }) },
    } : {}),
    ...(data.offlineState ? { offlineState: { ...data.offlineState, pending: data.offlineState.pending.filter(mail => !drop(mail.peer, mail.messageId)) } } : {}),
    ...(data.courierState ? { courierState: pruneCourierFiles(data.courierState, drop) } : {}),
    ...(data.radioState ? { radioState: { ...data.radioState, pending: data.radioState.pending.filter(packet => !drop(packet.peer, packet.id)) } } : {}),
  };
  return { snapshot, ids: [...ids] };
}
