import { describe, it, expect } from 'vitest';
import { normalizeAvatar, normalizePeerAvatars, AVATAR_PREFIX } from './avatar';
import { avatarFixture } from './avatar.fixture';
import { getAccountId } from '$lib/addressing/address';

describe('bounded photo avatars', () => {
  it('allows only small square raster JPEG with canonical encoding', () => {
    expect(normalizeAvatar(avatarFixture())).toBe(avatarFixture());
    expect(normalizeAvatar(avatarFixture(1))).toBe(avatarFixture(1));
    for (const raw of ['', null, {}, 'https://tracker.test/photo.jpg', 'data:image/svg+xml;base64,PHN2Zy8+', avatarFixture(0), avatarFixture(161), AVATAR_PREFIX + 'a'.repeat(20000), avatarFixture().slice(0,-1)]) expect(normalizeAvatar(raw)).toBeNull();
    const bytes = Uint8Array.from(atob(avatarFixture().slice(AVATAR_PREFIX.length)), c => c.charCodeAt(0));
    bytes[10] = 1; // Non-square width.
    expect(normalizeAvatar(AVATAR_PREFIX + btoa(String.fromCharCode(...bytes)))).toBeNull();
  });
  it('rejects metadata, malformed JPEG and appended content', () => {
    const raw = atob(avatarFixture().slice(AVATAR_PREFIX.length));
    const metadata = raw.slice(0,2) + String.fromCharCode(255,254,0,8) + 'secret' + raw.slice(2);
    for (const value of [metadata, raw + 'secret', raw.slice(0,-2)]) expect(normalizeAvatar(AVATAR_PREFIX + btoa(value))).toBeNull();
  });
  it('restores only valid avatars bound to actual account IDs', async () => {
    const peer = await getAccountId('04' + '03'.repeat(64));
    expect(normalizePeerAvatars({ [peer]: avatarFixture(), external: avatarFixture() })).toEqual({ [peer]: avatarFixture() });
    expect(normalizePeerAvatars([])).toEqual({}); expect(normalizePeerAvatars(null)).toEqual({});
  });
});
