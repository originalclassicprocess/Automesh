import type { ChatEntry } from './session-chats';

// A date input is a local calendar day, not a UTC midnight.
export function searchMessages(messages: readonly ChatEntry[], query: string, date = ''): ChatEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle && !date) return [];
  return messages.filter(message => {
    if (message.details?.ephemeral || message.details?.ephemeralOpened || message.details?.pin) return false;
    const day = new Date(message.timestamp);
    const localDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return (!date || localDate === date) && (!needle ||
      [message.text, message.file?.name, message.details?.contactCard?.nickname].some(text => text?.toLocaleLowerCase().includes(needle)));
  });
}

export function historyJumpVisible(count: number, twelfthLastBottom: number | undefined, viewportBottom: number): boolean {
  return count >= 12 && twelfthLastBottom !== undefined && twelfthLastBottom > viewportBottom + 1;
}
