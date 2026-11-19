import type { ChatEntry } from './session-chats';
import { messageLinks } from './message-links';
export type SearchKind = 'all' | 'images' | 'videos' | 'audio' | 'files' | 'links';
function matchesKind(message:ChatEntry,kind:SearchKind):boolean {
  const mime=message.file?.mime.toLowerCase()??'',sticker=message.details?.media?.kind==='sticker';
  if(kind==='images')return mime.startsWith('image/')&&!sticker;
  if(kind==='videos')return mime.startsWith('video/')&&!sticker;
  if(kind==='audio')return mime.startsWith('audio/');
  if(kind==='files')return !!message.file;
  if(kind==='links')return messageLinks(message.text).some(part=>!!part.href);
  return true;
}

// A date input is a local calendar day, not a UTC midnight.
export function searchMessages(messages: readonly ChatEntry[], query: string, date = '',kind:SearchKind='all'): ChatEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle && !date && kind==='all') return [];
  return messages.filter(message => {
    if (message.details?.ephemeral || message.details?.ephemeralOpened || message.details?.pin || message.details?.edit || message.details?.reaction) return false;
    const day = new Date(message.timestamp);
    const localDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return (!date || localDate === date) && (!needle ||
      [message.text, message.file?.name, message.details?.contactCard?.nickname].some(text => text?.toLocaleLowerCase().includes(needle)))&&matchesKind(message,kind);
  });
}

export function historyJumpVisible(count: number, twelfthLastBottom: number | undefined, viewportBottom: number): boolean {
  return count >= 12 && twelfthLastBottom !== undefined && twelfthLastBottom > viewportBottom + 1;
}
