import { inlineMediaFor } from './media-preview';
import type { ChatEntry } from './session-chats';
export type ContactMediaCategory = 'all' | 'image' | 'video' | 'audio' | 'sticker' | 'other';
export function contactMediaKind(message: ChatEntry): Exclude<ContactMediaCategory, 'all'> {
  return message.details?.media?.kind === 'sticker' ? 'sticker' : message.file ? inlineMediaFor(message.file)?.kind ?? 'other' : 'other';
}
export function contactMedia(messages: readonly ChatEntry[], category: ContactMediaCategory = 'all'): ChatEntry[] {
  return messages.filter(message => message.file && !message.fileDeleted &&
    (category === 'all' || contactMediaKind(message) === category))
    .slice().sort((a, b) => b.timestamp - a.timestamp);
}
