import { beforeAll, describe, expect, it } from 'vitest';
import { mnemonicToSeed } from '@scure/bip39';
import { deriveIdentitySeed } from '$lib/identity/namespace';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { getAccountId } from '$lib/addressing/address';
import { bytesToHex } from '$lib/message/encoding';
import { backupFileName, createEncryptedBackup, MAX_BACKUP_BYTES, openEncryptedBackup } from './encrypted-backup';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { openProfileBundle } from '$lib/profiles/bundle';
import { webCryptoEnvironment } from '$lib/core/ports';
import type { ProfileRegistry } from '$lib/core/profiles';

// Public test vectors, unrelated to user accounts.
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = new TextEncoder().encode(phrase);
const password = 'public-test-password';
let id: string;
let encrypted: string;
let profiles: ProfileRegistry;
let withProfiles: string;
beforeAll(async () => {
  const master = await mnemonicToSeed(phrase);
  const derived = await deriveIdentitySeed(master);
  const identity = new WebCryptoIdentity();
  id = await getAccountId(bytesToHex((await identity.fromSeed(derived)).publicKey));
  let record: import('$lib/core/durable-state').SealedCoreRecord | undefined;
  const stored = await openProfileBundle({ root: derived, scope: id, environment: webCryptoEnvironment(), guard: () => {},
    randomBytes: size => crypto.getRandomValues(new Uint8Array(size)), records: {
      read: async () => record,
      compareAndSwap: async (_scope, revision, next) => { if ((record?.revision ?? null) !== revision) return false; record = next; return true; },
    } });
  await stored.initialize('Test Nick'); await stored.create('incoming', 'Inbox'); profiles = await stored.create('outgoing', 'Outbox'); stored.close();
  master.fill(0); derived.fill(0);
  encrypted = await createEncryptedBackup(seed, password, id, 'Test Nick');
  withProfiles = await createEncryptedBackup(seed, password, id, 'Test Nick', profiles);
});

describe('encrypted Automesh account backup', () => {
  it('round-trips v2 with all profile metadata inside authenticated ciphertext', async () => {
    expect(JSON.parse(withProfiles).version).toBe(2);
    for (const p of profiles.profiles) { expect(withProfiles).not.toContain(p.accountId); expect(withProfiles).not.toContain(p.name); }
    const opened = await openEncryptedBackup(withProfiles, password, id);
    try { expect(opened.profiles).toEqual(profiles); expect(new TextDecoder().decode(opened.seed)).toBe(phrase); }
    finally { opened.seed.fill(0); }
  });
  it('authenticates the v2 version and rejects a wrong password', async () => {
    await expect(openEncryptedBackup(withProfiles, 'wrong-password')).rejects.toThrow('backup_cannot_decrypt');
    const downgrade = JSON.stringify({ ...JSON.parse(withProfiles), version: 1 });
    await expect(openEncryptedBackup(downgrade, password)).rejects.toThrow('backup_cannot_decrypt');
  });
  it('refuses to export a substituted profile key', async () => {
    const changed = structuredClone(profiles); changed.profiles[2].accountId = encodeAccountId(new Uint8Array(20).fill(12));
    await expect(createEncryptedBackup(seed, password, id, '', changed)).rejects.toThrow('profile_backup_address_mismatch');
  });
  it('snapshots caller profile metadata before asynchronous work', async () => {
    const changed = structuredClone(profiles); const promise = createEncryptedBackup(seed, password, id, '', changed);
    changed.profiles[2].name = 'Changed during encryption';
    const opened = await openEncryptedBackup(await promise, password);
    try { expect(opened.profiles!.profiles[2].name).toBe(profiles.profiles[2].name); } finally { opened.seed.fill(0); }
  });
  it('verifies child ownership again when opening an authenticated but forged registry', async () => {
    const envelope = JSON.parse(withProfiles);
    const decode = (v: string) => Uint8Array.from(atob(v), c => c.charCodeAt(0));
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: decode(envelope.salt), iterations: 600000, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const parameters = { name: 'AES-GCM', iv: decode(envelope.iv), additionalData: new TextEncoder().encode('Automesh account backup v2:PBKDF2-SHA256-600000:AES-256-GCM') };
    const bytes = new Uint8Array(await crypto.subtle.decrypt(parameters, key, decode(envelope.ciphertext)));
    try {
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      payload.profiles.profiles[2].accountId = encodeAccountId(new Uint8Array(20).fill(12));
      const forged = new Uint8Array(await crypto.subtle.encrypt(parameters, key, new TextEncoder().encode(JSON.stringify(payload))));
      envelope.ciphertext = btoa(String.fromCharCode(...forged));
      await expect(openEncryptedBackup(JSON.stringify(envelope), password)).rejects.toThrow('profile_backup_address_mismatch');
    } finally { bytes.fill(0); }
  });
  it('opens an unchanged pre-fix backup and retains its original Account ID', async () => {
    // Public test account, generated before the PKCS#8 compatibility fix.
    // Fixed salt/IV belong ONLY to this frozen test fixture, not production.
    const legacy = JSON.stringify({ format: 'automesh-account-backup', version: 1,
      kdf: 'PBKDF2-SHA256', iterations: 600000, encryption: 'AES-256-GCM',
      salt: 'BwcHBwcHBwcHBwcHBwcHBw==', iv: 'CQkJCQkJCQkJCQkJ',
      ciphertext: 'Ry+GSNQ5dKly6jTszK099TRP2XFpqoY/pMNpDb+uNcilDjXeLYR+ephZVTfx+rQygxiZWC2cLFlDws7k9pnErNRh3BH9ZT3PGy/ooThkETuxrfV9pSUmXSGNwZ6eivPVBSo0JRRvTRIhKqjI1RpBsovgtfwhHZAkmVLQYxSxZ0lYg8v/t9YUnbdJ487smZ6TB4K2xRq7ct/toR6/tspSFi95gFU+wlkABObLAaI7OyU9P60LQ/s909VRwPZt6BPHursIeDziU3UBcbdalHMyXZxAYFegRHx1bRMB25IMMqAwqVjrOI0eCjlXqDbU4PVBf6UzGHIJFBKdlt/4v06N1c2ugWSC9ALTtF5BEUAi1BLV3O5A3xsYL+pfPB53MW2yIgOp' });
    const opened = await openEncryptedBackup(legacy, password);
    try {
      expect(new TextDecoder().decode(opened.seed)).toBe(phrase);
      expect(opened.accountId).toBe('mesh1q93lgc7ekj058ysfcfev89jcqnzceh4hps85cz4m');
      expect(opened.nickname).toBe('Legacy fixture');
    } finally { opened.seed.fill(0); }
  });
  it('round-trips the original account with a new independent password-derived key', async () => {
    expect(encrypted).not.toContain(phrase);
    expect(encrypted).not.toContain(id);
    expect(encrypted).not.toContain('Test Nick');
    const opened = await openEncryptedBackup(encrypted, password, id);
    expect(new TextDecoder().decode(opened.seed)).toBe(phrase);
    expect(opened.accountId).toBe(id);
    expect(opened.nickname).toBe('Test Nick');
    opened.seed.fill(0);
  });
  it('uses fresh salt and IV even with the same seed and password', async () => {
    const another = JSON.parse(await createEncryptedBackup(seed, password, id, 'Test Nick'));
    const previous = JSON.parse(encrypted);
    expect(another.salt).not.toBe(previous.salt);
    expect(another.iv).not.toBe(previous.iv);
    expect(another.ciphertext).not.toBe(previous.ciphertext);
  });
  it('rejects a wrong password, tampering, and a different expected account', async () => {
    await expect(openEncryptedBackup(encrypted, 'wrong-password')).rejects.toThrow('backup_cannot_decrypt');
    const damaged = JSON.parse(encrypted);
    const bytes = Uint8Array.from(atob(damaged.ciphertext), (char) => char.charCodeAt(0));
    bytes[0] ^= 1;
    damaged.ciphertext = btoa(String.fromCharCode(...bytes));
    await expect(openEncryptedBackup(JSON.stringify(damaged), password)).rejects.toThrow('backup_cannot_decrypt');
    await expect(openEncryptedBackup(encrypted, password, encodeAccountId(new Uint8Array(20).fill(12)))).rejects.toThrow('backup_wrong_account');
  });
  it('rejects unsupported parameters and oversized or malformed files before deriving keys', async () => {
    for (const change of [{ version: 2 }, { format: 'vault' }, { iterations: 1 }, { iterations: 999_999_999 },
      { salt: 'AA==' }, { iv: 'AA==' }, { ciphertext: '==' }, { encryption: 'AES-CBC' }, { kdf: 'other' }]) {
      await expect(openEncryptedBackup(JSON.stringify({ ...JSON.parse(encrypted), ...change }), password)).rejects.toThrow();
    }
    await expect(openEncryptedBackup('x'.repeat(MAX_BACKUP_BYTES + 1), password)).rejects.toThrow('backup_too_large');
    await expect(openEncryptedBackup('null', password)).rejects.toThrow('backup_invalid');
    await expect(openEncryptedBackup('[]', password)).rejects.toThrow('backup_invalid');
    await expect(openEncryptedBackup('not json', password)).rejects.toThrow('backup_invalid');
  });
  it('rejects an invalid seed, short password or mismatching export identity', async () => {
    await expect(createEncryptedBackup(seed, 'short', id)).rejects.toThrow('backup_password_short');
    await expect(createEncryptedBackup(new TextEncoder().encode('invalid seed'), password, id)).rejects.toThrow();
    await expect(createEncryptedBackup(seed, password, encodeAccountId(new Uint8Array(20).fill(8)))).rejects.toThrow('backup_account_mismatch');
  });
  it('uses a private default name and sanitizes optional nickname/path/control characters', () => {
    const date = new Date(2026, 8, 30);
    expect(backupFileName('', date)).toBe('Automesh-2026-09-30.automesh');
    expect(backupFileName('Alice', date)).toBe('Automesh-Alice-2026-09-30.automesh');
    expect(backupFileName('../evil\\nick:\u202e\n', date)).not.toMatch(/[/\\:\u202e\n]/);
    expect(backupFileName('a'.repeat(100), date).length).toBeLessThan(80);
  });
});
