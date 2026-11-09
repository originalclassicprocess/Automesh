import type { ChatEntry } from './session-chats';
export type MessagePin = { actor: string; targetId: string | null; revision: number; control: ChatEntry };
export function visibleChatMessages(messages: readonly ChatEntry[]): ChatEntry[] {
  return messages.filter(message => !message.details?.pin && !message.details?.ephemeralOpened);
}
// Revision ordering makes delayed offline delivery and retries deterministic.
// Each authenticated participant owns exactly one slot, even when pinning a
// message written by the OTHER participant. Tombstones keep old pins retired.
export function messagePins(messages: readonly ChatEntry[], self: string, peer: string): MessagePin[] {
  const pins = new Map<string, MessagePin>();
  for (const message of messages) {
    const pin = message.details?.pin;
    if (!pin || message.file || message.text !== '' || ![self, peer].includes(message.from)) continue;
    if (message.direction === 'outgoing' ? message.from !== self : message.from !== peer) continue;
    const previous = pins.get(message.from);
    if (!previous || pin.revision > previous.revision || pin.revision === previous.revision && message.id > previous.control.id)
      pins.set(message.from, { actor: message.from, ...pin, control: message });
  }
  return [...pins.values()];
}
export function nextPinRevision(messages: readonly ChatEntry[], self: string, peer: string): number {
  const revision = (messagePins(messages, self, peer).find(pin => pin.actor === self)?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision)) throw new Error('pin_revision_limit');
  return revision;
}
