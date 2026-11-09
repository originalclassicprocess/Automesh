import { describe, expect, it } from 'vitest';
import { contactMedia } from './contact-media';
import type { ChatEntry } from './session-chats';
function file(id: string, mime: string, name: string, timestamp: number): ChatEntry {
  return { id, text: '', from: 'peer', direction: 'incoming', timestamp,
    file: { name, mime, size: 1, sha256: 'a'.repeat(64) } as ChatEntry['file'] };
}
describe('contact attachment inventory', () => {
  it('keeps stickers separate from ordinary photos without classifying text emoji as files', () => {
    const sticker = {...file('sticker','image/png','heart.png',2), details:{media:{kind:'sticker' as const}}};
    const photo = file('photo','image/png','photo.png',1);
    expect(contactMedia([sticker,photo],'image').map(message=>message.id)).toEqual(['photo']);
    expect(contactMedia([sticker,photo],'sticker').map(message=>message.id)).toEqual(['sticker']);
    expect(contactMedia([sticker,photo]).map(message=>message.id)).toEqual(['sticker','photo']);
  });
  it('lists both sent and received metadata, newest first without mutating history', () => {
    const messages = [file('a', 'image/png', 'a.png', 1), { ...file('b', 'audio/mpeg', 'b.mp3', 2), direction: 'outgoing' as const }];
    expect(contactMedia(messages).map(m => m.id)).toEqual(['b', 'a']);
    expect(messages.map(m => m.id)).toEqual(['a', 'b']);
  });
  it('excludes deleted files and text, categorizes active formats as downloads only', () => {
    const messages = [file('a', 'image/png', 'a.png', 1), file('v', 'video/mp4', 'v.mp4', 2),
      file('s', 'image/svg+xml', 's.svg', 3), { ...file('d', 'audio/mpeg', 'd.mp3', 4), fileDeleted: true },
      { id: 'text', text: 'hello', from: 'peer', direction: 'incoming' as const, timestamp: 5 }];
    expect(contactMedia(messages, 'image').map(m => m.id)).toEqual(['a']);
    expect(contactMedia(messages, 'video').map(m => m.id)).toEqual(['v']);
    expect(contactMedia(messages, 'other').map(m => m.id)).toEqual(['s']);
    expect(contactMedia(messages, 'audio')).toEqual([]);
  });
});
