import type { Conversation, SessionChats } from './session-chats';

export function conversationPreview(conversation: Conversation, ui: (source: string) => string = source => source): string {
  const last = conversation.messages.findLast(message => !message.details?.pin && !message.details?.ephemeralOpened);
  if (!last) return ui('Пока нет сообщений');
  if (last.details?.ephemeral) return ui(last.ephemeralState?.expired ? 'Исчезнувшее сообщение' : 'Исчезающее сообщение');
  return `${last.direction === 'outgoing' ? `${ui('Вы')}: ` : ''}${last.file ? `📎 ${last.file.name}` : last.details?.radioContact ? `LoRa · ${ui('Радиоконтакт')}` : last.details?.contactCard ? `👤 ${last.details.contactCard.nickname || ui('Контакт')}` : last.text}`.slice(0, 160);
}

export function visibleConversations(state: SessionChats, query: string, name: (peer: string) => string, ownId = ''): string[] {
  const needle = query.trim().toLocaleLowerCase();
  return state.order.filter((peer) => !needle || `${name(peer)} ${peer}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => a === ownId ? -1 : b === ownId ? 1 :
      (state.byPeer[b].messages.at(-1)?.timestamp ?? 0) - (state.byPeer[a].messages.at(-1)?.timestamp ?? 0));
}

export function submitOnEnter(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing'>): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing;
}
