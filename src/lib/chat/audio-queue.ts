import type { ChatEntry } from './session-chats';
import { inlineMediaFor } from './media-preview';

export type AudioOrder = 'forward' | 'reverse' | 'shuffle';
export type AudioRepeat = 'none' | 'one' | 'all';
export type AudioQueueTrack = {
  id: string; name: string; size: number; mime: string; timestamp: number;
  sender: string; senderAddress: string;
};

// VoiceMessage uses this filename convention; those clips stay inline.
export function isQueueAudio(message: ChatEntry): boolean {
  return !!message.file && inlineMediaFor(message.file)?.kind === 'audio' &&
    !/^voice-\d{4}-\d{2}-\d{2}T/.test(message.file.name);
}

export function reconcileShuffle(ids: readonly string[], previous: readonly string[], current: string): string[] {
  const available = new Set(ids);
  const kept = previous.filter(id => available.has(id));
  const known = new Set(kept);
  const added = ids.filter(id => !known.has(id) && (kept.length > 0 || id !== current));
  for (let i = added.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [added[i], added[j]] = [added[j], added[i]];
  }
  return kept.length ? [...kept, ...added] : [...(available.has(current) ? [current] : []), ...added];
}

export function orderedAudio(ids: readonly string[], order: AudioOrder, shuffled: readonly string[]): string[] {
  if (order === 'reverse') return [...ids].reverse();
  if (order === 'shuffle') {
    const available = new Set(ids), known = new Set(shuffled);
    return [...shuffled.filter(id => available.has(id)), ...ids.filter(id => !known.has(id))];
  }
  return [...ids];
}

export function adjacentAudio(ids: readonly string[], current: string, direction: -1 | 1, wrap: boolean): string | null {
  const index = ids.indexOf(current);
  if (index < 0 || !ids.length) return null;
  const next = index + direction;
  return next >= 0 && next < ids.length ? ids[next] : wrap ? ids[(next + ids.length) % ids.length] : null;
}
