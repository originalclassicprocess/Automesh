import { inlineMediaFor } from '$lib/chat/media-preview';
import type { SessionChats } from '$lib/chat/session-chats';
import type { LocalChatData, StorageInventory } from '$lib/chat/local-store';
import { pruneCourierFiles } from '$lib/node/courier-state';
import { isLibraryFileId } from '$lib/chat/media-library';
export type FileCategory = 'image' | 'audio' | 'video' | 'other';
export type ManagedFile = { id: string; peer: string; messageId: string; name: string; category: FileCategory; bytes: number; memoryBytes: number };
export const categoryNames: Record<FileCategory, string> = { image: 'Изображения', audio: 'Аудио', video: 'Видео', other: 'Другие файлы' };
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Неизвестно';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
export function managedFiles(state: SessionChats, disk: StorageInventory, memory: ReadonlyMap<string, Uint8Array>): ManagedFile[] {
  const entries = new Map<string, { peer: string; messageId: string; name: string; category: FileCategory }>();
  for (const peer of state.order) for (const message of state.byPeer[peer].messages) {
    if (message.file) entries.set(`${peer}:${message.id}`, { peer, messageId: message.id, name: message.file.name,
      category: inlineMediaFor(message.file)?.kind ?? 'other' });
  }
  const stored = new Map(disk.files.map(file => [file.id, file.bytes]));
  const ids = new Set([...stored.keys(), ...memory.keys()]);
  return [...ids].filter(id => !isLibraryFileId(id)).map(id => ({ id, ...(entries.get(id) ?? { peer: '', messageId: '', name: 'Файл вне истории', category: 'other' as const }),
    bytes: stored.get(id) ?? 0, memoryBytes: memory.get(id)?.byteLength ?? 0 }));
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
