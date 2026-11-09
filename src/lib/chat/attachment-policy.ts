import { MAX_FILE_BYTES, type FileOffer } from './file-transfer';
import { inlineMediaFor } from './media-preview';
import { MAX_VOICE_BYTES } from './voice-recorder';
import type { SessionChats } from './session-chats';
export const MAX_PENDING_FILES = 16;
export const MAX_AUTO_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_AUTO_FILE_BYTES = 100 * 1024 * 1024;
export function validateAttachmentBatch(files: ReadonlyArray<Pick<File, 'size'>>, pending: number): string | null {
  if (pending + files.length > MAX_PENDING_FILES) return 'В очереди может быть не более 16 файлов. Завершите передачи или выберите меньше файлов.';
  if (files.some(file => file.size > MAX_FILE_BYTES)) return `Каждый файл должен быть не больше ${MAX_FILE_BYTES / (1024 * 1024)} МБ.`;
  return null;
}
export function autoReceiveAudio(offer: FileOffer): boolean {
  return offer.size <= MAX_VOICE_BYTES && inlineMediaFor(offer)?.kind === 'audio';
}

export function automaticAudioOffers(state: SessionChats, receiving: number, remaining: number): Array<{ peer: string; id: string; size: number }> {
  return automaticFileOffers(state, receiving, remaining, true, autoReceiveAudio);
}

export function automaticFileOffers(state: SessionChats, receiving: number, remaining: number, enabled: boolean,
  allowed: (offer: FileOffer) => boolean = offer => offer.size >= 0 && offer.size <= MAX_FILE_BYTES,
): Array<{ peer: string; id: string; size: number }> {
  if (!enabled) return [];
  const result: Array<{ peer: string; id: string; size: number }> = [];
  let slots = Math.max(0, 2 - receiving);
  for (const peer of state.order) {
    const conversation = state.byPeer[peer];
    if (conversation.contact !== 'accepted') continue;
    for (const entry of conversation.messages) {
      if (!slots) return result;
      if (entry.direction !== 'incoming' || entry.fileStatus !== 'offered' || entry.fileAccepted || entry.fileDeleted || !entry.file ||
        (conversation.connection !== 'connected' && !entry.courierVia) ||
        !allowed(entry.file) || entry.file.size > remaining) continue;
      result.push({ peer, id: entry.id, size: entry.file.size }); remaining -= entry.file.size; slots--;
    }
  }
  return result;
}
