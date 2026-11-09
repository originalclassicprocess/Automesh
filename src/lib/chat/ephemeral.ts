import type { ChatEntry } from './session-chats';
export function normalizeEphemeralState(raw: unknown): ChatEntry['ephemeralState'] | undefined {
  const value = raw as ChatEntry['ephemeralState'];
  return value && Number.isSafeInteger(value.firstViewedAt) && value.firstViewedAt > 0 &&
    Number.isSafeInteger(value.views) && value.views >= 1 && value.views <= 20
    ? { firstViewedAt: value.firstViewedAt, views: value.views, ...(value.expired === true ? { expired: true } : {}) } : undefined;
}
export function ephemeralState(message: ChatEntry, messages: readonly ChatEntry[]): ChatEntry['ephemeralState'] {
  return ephemeralStates(messages.some(entry => entry.id === message.id) ? messages : [...messages,message]).get(message.id) ?? message.ephemeralState;
}
// One scan per conversation, not one history scan per message on every tick.
export function ephemeralStates(messages: readonly ChatEntry[]): Map<string, NonNullable<ChatEntry['ephemeralState']>> {
  const targets = new Map(messages.filter(message => message.details?.ephemeral).map(message => [message.id,message]));
  const result = new Map<string, NonNullable<ChatEntry['ephemeralState']>>();
  for (const [id,message] of targets) if (message.ephemeralState) result.set(id,message.ephemeralState);
  for (const entry of messages) {
    const opened = entry.details?.ephemeralOpened;
    if (entry.direction !== 'incoming' || !opened || targets.get(opened.targetId)?.direction !== 'outgoing') continue;
    const previous = result.get(opened.targetId);
    result.set(opened.targetId,{ firstViewedAt: Math.min(previous?.firstViewedAt ?? Infinity, opened.viewedAt), views: Math.max(previous?.views ?? 0, opened.views), ...(previous?.expired ? { expired: true } : {}) });
  }
  return result;
}
export function ephemeralExpired(message: ChatEntry, state = message.ephemeralState, now = Date.now()): boolean {
  const rule = message.details?.ephemeral;
  return !!rule && !!state && (!!state.expired || !!rule.seconds && now >= state.firstViewedAt + rule.seconds * 1000 || !!rule.views && state.views >= rule.views);
}
export function nextEphemeralOpening(message: ChatEntry, now = Date.now()): ChatEntry['ephemeralState'] | null {
  if (!message.details?.ephemeral || ephemeralExpired(message,message.ephemeralState,now)) return null;
  // Timer-only policies allow unlimited openings. The bounded wire counter can
  // saturate without inventing an undisclosed 20-view limit for those policies.
  return { firstViewedAt:message.ephemeralState?.firstViewedAt ?? now, views:Math.min(20,(message.ephemeralState?.views ?? 0) + 1) };
}
export function ephemeralLabel(message: ChatEntry): string {
  const rule = message.details?.ephemeral;
  const seconds = rule?.seconds;
  const duration = seconds ? seconds % 86400 === 0 ? `${seconds/86400} дн.` : seconds % 3600 === 0 ? `${seconds/3600} ч` : seconds % 60 === 0 ? `${seconds/60} мин` : `${seconds} с` : '';
  return rule ? [seconds ? `${duration} после первого открытия` : '', rule.views ? `${rule.views} ${rule.views === 1 ? 'просмотр' : rule.views < 5 ? 'просмотра' : 'просмотров'}` : '', rule.allowDownload ? 'скачивание разрешено' : 'без скачивания'].filter(Boolean).join(' · ') : '';
}
export function expiredMessage(message: ChatEntry): ChatEntry {
  return { id: message.id, from: message.from, timestamp: message.timestamp, direction: message.direction,
    text: '', details: { ephemeral: message.details!.ephemeral! }, readState: 'skipped',
    ...(message.direction === 'outgoing' ? { delivery: 'delivered' as const } : {}),
    ephemeralState: { firstViewedAt: message.ephemeralState?.firstViewedAt || Date.now(), views: message.ephemeralState?.views || 1, expired: true } };
}
