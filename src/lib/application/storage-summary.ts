import { inlineMediaFor } from '$lib/chat/media-preview';
import type { SessionChats } from '$lib/chat/session-chats';
import type { LocalChatData, StorageInventory } from '$lib/chat/local-store';
import { pruneCourierFiles } from '$lib/node/courier-state';
import { isLibraryFileId } from '$lib/chat/media-library';
export type FileCategory = 'image' | 'audio' | 'video' | 'other';
export type ManagedFile = { id: string; peer: string; messageId: string; name: string; category: FileCategory; bytes: number; memoryBytes: number; timestamp?: number };
export const categoryNames: Record<FileCategory, string> = { image: 'Изображения', audio: 'Аудио', video: 'Видео', other: 'Другие файлы' };
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Неизвестно';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
export function managedFiles(state: SessionChats, disk: StorageInventory, memory: ReadonlyMap<string, Uint8Array>): ManagedFile[] {
  const entries = new Map<string, { peer: string; messageId: string; name: string; category: FileCategory; timestamp: number }>();
  for (const peer of state.order) for (const message of state.byPeer[peer].messages) {
    if (message.file) entries.set(`${peer}:${message.id}`, { peer, messageId: message.id, name: message.file.name,
      category: inlineMediaFor(message.file)?.kind ?? 'other', timestamp: message.timestamp });
  }
  const stored = new Map(disk.files.map(file => [file.id, file.bytes]));
  const ids = new Set([...stored.keys(), ...memory.keys()]);
  return [...ids].filter(id => !isLibraryFileId(id)).map(id => ({ id, ...(entries.get(id) ?? { peer: '', messageId: '', name: 'Файл вне истории', category: 'other' as const }),
    bytes: stored.get(id) ?? 0, memoryBytes: memory.get(id)?.byteLength ?? 0 }));
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
export function chatStorageUsage(state: SessionChats, files: ManagedFile[]): ChatStorageUsage[] {
  const groups = new Map<string, ChatStorageUsage>();
  for (const peer of state.order) {
    const messages = state.byPeer[peer]?.messages ?? [];
    groups.set(peer, {peer, bytes:0, historyBytes:messages.length ? new TextEncoder().encode(JSON.stringify(messages)).byteLength : 0, files:0, messages:messages.length});
  }
  for (const file of files) {
    const group = groups.get(file.peer) ?? {peer:file.peer, bytes:0, historyBytes:0, files:0, messages:0};
    group.bytes += fileBytes(file); group.files++; groups.set(file.peer, group);
  }
  return [...groups.values()].sort((a,b) => b.bytes + b.historyBytes - a.bytes - a.historyBytes || a.peer.localeCompare(b.peer));
}

// For an untrusted session, clean only the old durable snapshot. Never persist
// new volatile messages merely because the user removed an old file.
export function cleanedHistory(data: LocalChatData, ids?: readonly string[]): LocalChatData {
  const selected = ids ? new Set(ids) : null;
  return { ...data, ...(!selected && data.offlineState ? { offlineState: { ...data.offlineState, pending: [] } } : {}),
    ...(data.courierState ? { courierState: pruneCourierFiles(data.courierState, (peer, id) => !selected || selected.has(`${peer}:${id}`)) } : {}),
    chats: { order: [...data.chats.order], byPeer: Object.fromEntries(data.chats.order.map(peer => [peer, {
    ...data.chats.byPeer[peer], messages: selected ? data.chats.byPeer[peer].messages.map(message =>
      message.file && selected.has(`${peer}:${message.id}`)
        ? { ...message, fileDeleted: true, fileStatus: 'canceled' as const, fileAccepted: false, fileProgress: 0 } : message) : [],
  }])) } };
}
