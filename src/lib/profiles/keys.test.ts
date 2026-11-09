import { describe, expect, it, vi } from 'vitest';
import { deriveProfileRegistryKey, deriveProfileSeed } from './keys';
const root = new Uint8Array(32); root[31] = 1; // public fixed vector
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
describe('profile HKDF v1', () => {
  it.each([
    [0, '14cbb82d0822292aedb8082748dcf86f310a312f97fa018131a2e6c4ee7e0439'],
    [1, '457cc1a3f317e34cf820009646f7537196f16505364721eb126d145a9bfdadf5'],
    [2, '0b43365ebe08d7b195debd29ccd56300d761cead42d32ae52e63d3b9419dc29f'],
    [4294967295, 'd885a2af344dc9b98c6011f5a46842ba8a61ef41cafe24cc76f41dafa28b2862'],
  ])('matches an independent Node HKDF vector at index %i', async (index, expected) => {
    expect(hex(await deriveProfileSeed(root, index as number, crypto.subtle))).toBe(expected);
    expect(root[31]).toBe(1);
  });
  it('copies root material before asynchronous import', async () => {
    const input = root.slice(), pending = deriveProfileSeed(input, 0, crypto.subtle); input.fill(7);
    expect(hex(await pending)).toBe('14cbb82d0822292aedb8082748dcf86f310a312f97fa018131a2e6c4ee7e0439');
  });
  it('rejects invalid lengths, fractional/negative/overflow indices', async () => {
    for (const index of [-1, 0.1, NaN, 0x100000000]) await expect(deriveProfileSeed(root, index, crypto.subtle)).rejects.toThrow('invalid_profile_index');
    await expect(deriveProfileSeed(new Uint8Array(31), 0, crypto.subtle)).rejects.toThrow('invalid_profile_root');
  });
  it('uses rejection sampling for invalid scalars, not biased modulo reduction', async () => {
    const original = crypto.subtle.deriveBits.bind(crypto.subtle);
    const derive = vi.spyOn(crypto.subtle, 'deriveBits').mockResolvedValueOnce(new ArrayBuffer(32)).mockImplementation(original);
    try {
      const seed = await deriveProfileSeed(root, 0, crypto.subtle);
      expect(seed.some(Boolean)).toBe(true); expect(derive).toHaveBeenCalledTimes(2);
      expect(new TextDecoder().decode((derive.mock.calls[1][0] as HkdfParams).info)).toContain(',0,1]');
    } finally { derive.mockRestore(); }
  });
  it('returns nonextractable storage keys separated by scope', async () => {
    const a = await deriveProfileRegistryKey(root, 'scope-a', crypto.subtle);
    const b = await deriveProfileRegistryKey(root, 'scope-b', crypto.subtle);
    expect(a.extractable).toBe(false);
    const iv = new Uint8Array(12), cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, a, new Uint8Array([1]));
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, b, cipher)).rejects.toThrow();
  });
});
