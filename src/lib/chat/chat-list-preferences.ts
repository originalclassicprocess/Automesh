export type ChatListKind = 'chat' | 'group' | 'radio' | 'agent';
export type ChatListPreferences = { pinned: string[]; hidden: string[] };
export const chatListKey = (kind: ChatListKind, id: string) => `${kind}:${id}`;

export function normalizeChatListPreferences(value: unknown): ChatListPreferences {
  const source = value as Partial<ChatListPreferences> | undefined;
  const keys = (list: unknown) => Array.isArray(list) ? [...new Set(list.slice(0, 2048).filter((key): key is string =>
    typeof key === 'string' && /^(chat|group|radio|agent):[a-zA-Z0-9_:-]{1,180}$/.test(key)))] : [];
  const hidden = keys(source?.hidden), hiddenSet = new Set(hidden);
  return { pinned:keys(source?.pinned).filter(key => !hiddenSet.has(key)), hidden };
}

export function sortChatList<T extends { kind: ChatListKind; id: string; time: number }>(items: T[], pinned: readonly string[]): T[] {
  const order = new Map(pinned.map((key, index) => [key, index]));
  const rank = (item: T) => order.get(chatListKey(item.kind, item.id)) ?? pinned.length;
  return items.sort((a,b) => rank(a) - rank(b) || b.time - a.time);
}

export function hideChat(prefs: ChatListPreferences, key: string): ChatListPreferences {
  return normalizeChatListPreferences({ pinned:prefs.pinned.filter(item => item !== key), hidden:[key,...prefs.hidden] });
}
