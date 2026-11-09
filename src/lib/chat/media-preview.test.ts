import { describe, expect, it } from 'vitest';
import { inlineMediaFor } from './media-preview';
import type { FileOffer } from './file-transfer';

const offer: FileOffer = { id: '12345678-1234-4234-8234-123456789abc', name: 'photo.jpg',
  size: 123, mime: 'image/jpeg', sha256: 'a'.repeat(64) };

describe('inline media classification', () => {
  it('previews common raster images, audio and video', () => {
    expect(inlineMediaFor(offer)).toEqual({ kind: 'image', mime: 'image/jpeg' });
    expect(inlineMediaFor({ ...offer, name: 'song.mp3', mime: 'audio/mpeg' })?.kind).toBe('audio');
    expect(inlineMediaFor({ ...offer, name: 'clip.webm', mime: 'video/webm' })?.kind).toBe('video');
    expect(inlineMediaFor({ ...offer, name: 'song.mp3', mime: '' })?.kind).toBe('audio');
  });

  it('does not inline SVG, HTML, mismatched declared types or empty files', () => {
    expect(inlineMediaFor({ ...offer, name: 'drawing.svg', mime: 'image/svg+xml' })).toBeNull();
    expect(inlineMediaFor({ ...offer, name: 'drawing.svg', mime: 'image/png' })).toBeNull();
    expect(inlineMediaFor({ ...offer, name: 'photo.jpg', mime: 'text/html' })).toBeNull();
    expect(inlineMediaFor({ ...offer, size: 0 })).toBeNull();
  });
});
