export function toggleSelection(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
}
export function selectEveryMessage(messages: readonly { id: string; localCall?: unknown }[]): string[] {
  return [...new Set(messages.filter(message => !message.localCall).map(message => message.id))];
}

export function selectionSummary(messages: readonly { id: string; localCall?: unknown }[], selected: readonly string[]) {
  const ids = new Set(messages.filter(message => !message.localCall).map(message => message.id));
  const count = new Set(selected.filter(id => ids.has(id))).size;
  return { count, total: ids.size, all: ids.size > 0 && count === ids.size, partial: count > 0 && count < ids.size };
}
