import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  changeVaultPassword,
  clearVault,
  discardTransientVaultOnStartup,
  hasVault,
  isTrustedDevice,
  loadVault,
  saveVault,
  setVaultPersistence,
} from './vault';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

const seed = new TextEncoder().encode('test seed, not a real mnemonic');
afterEach(() => vi.restoreAllMocks());

describe('vault device persistence and password', () => {
  it('opens existing eight-character passwords but rejects them for new password changes', async () => {
    await saveVault(seed, 'legacy88');
    expect((await loadVault('legacy88'))?.mnemonic).toEqual(seed);
    await expect(changeVaultPassword('legacy88', 'short888', true)).rejects.toThrow('10');
    expect((await loadVault('legacy88'))?.mnemonic).toEqual(seed);
    expect(await changeVaultPassword('legacy88', 'new-password', true)).toBe(true);
    expect((await loadVault('new-password'))?.mnemonic).toEqual(seed);
  });
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    discardTransientVaultOnStartup();
  });

  it('keeps an untrusted vault in the current tab only', async () => {
    await saveVault(seed, 'old-password', null, false);
    expect(sessionStorage.getItem('vault')).toBeNull();
    expect(localStorage.getItem('vault')).toBeNull();
    expect(isTrustedDevice()).toBe(false);
    expect(hasVault()).toBe(true);
    expect((await loadVault('old-password'))?.mnemonic).toEqual(seed);
    discardTransientVaultOnStartup();
    expect(hasVault()).toBe(false);
  });

  it('authenticates v3 metadata and rejects a version downgrade', async () => {
    await saveVault(seed, 'old-password', { label: 'original' });
    const raw = localStorage.getItem('vault')!;
    const data = JSON.parse(raw);
    expect(data.version).toBe(3);
    expect(data).not.toHaveProperty('metadata');
    data.metadata = { label: 'forged' };
    localStorage.setItem('vault', JSON.stringify(data));
    expect((await loadVault('old-password'))?.metadata).toEqual({ label: 'original' });
    data.version = 1;
    localStorage.setItem('vault', JSON.stringify(data));
    expect(await loadVault('old-password')).toBeNull();
    localStorage.setItem('vault', raw);
    const modified = JSON.parse(raw); modified.cipher[modified.cipher.length - 1] ^= 1;
    localStorage.setItem('vault', JSON.stringify(modified));
    expect(await loadVault('old-password')).toBeNull();
  });

  it('opens a frozen v1-format vault and rewrites it as v3 without changing the seed', async () => {
    const salt = new Uint8Array(16).fill(5), iv = new Uint8Array(12).fill(7);
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode('old-password'), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 300000, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, seed));
    localStorage.setItem('vault', JSON.stringify({ version: 1, salt: [...salt], iv: [...iv], cipher: [...cipher], metadata: { original: true } }));
    const opened = await loadVault('old-password');
    expect(opened?.legacy).toBe(true);
    expect(opened?.mnemonic).toEqual(seed);
    await saveVault(opened!.mnemonic, 'old-password', opened!.metadata);
    expect(JSON.parse(localStorage.getItem('vault')!).version).toBe(3);
    expect((await loadVault('old-password'))?.mnemonic).toEqual(seed);
  });

  it('opens v2 with its original KDF and upgrades safely; v3 cannot be relabelled v2', async () => {
    const salt = new Uint8Array(16).fill(9), iv = new Uint8Array(12).fill(3);
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode('old-password'), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 300000, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode('Automesh local vault v2:PBKDF2-SHA256-300000:AES-256-GCM') }, key,
      new TextEncoder().encode(JSON.stringify({ mnemonic: [...seed], metadata: { original: true } }))));
    const legacy = JSON.stringify({ version: 2, salt: [...salt], iv: [...iv], cipher: [...cipher] });
    localStorage.setItem('vault', legacy);
    expect(await loadVault('wrong-password')).toBeNull(); expect(localStorage.getItem('vault')).toBe(legacy);
    const opened = await loadVault('old-password'); expect(opened?.legacy).toBe(true);
    const derive = vi.spyOn(crypto.subtle, 'deriveKey');
    await saveVault(opened!.mnemonic, 'old-password', opened!.metadata);
    expect(derive.mock.calls[0][0]).toMatchObject({ iterations: 600000 });
    expect((await loadVault('old-password'))?.metadata).toEqual({ original: true });
    const downgraded = JSON.parse(localStorage.getItem('vault')!); downgraded.version = 2;
    localStorage.setItem('vault', JSON.stringify(downgraded)); expect(await loadVault('old-password')).toBeNull();
  });

  it('rejects malformed or oversized records before spending time on PBKDF2', async () => {
    await saveVault(seed, 'old-password');
    const data = JSON.parse(localStorage.getItem('vault')!);
    const derive = vi.spyOn(crypto.subtle, 'deriveKey');
    for (const invalid of [-1, 256, 1.5, '3', null]) {
      localStorage.setItem('vault', JSON.stringify({ ...data, salt: [invalid, ...data.salt.slice(1)] }));
      expect(await loadVault('old-password')).toBeNull();
    }
    for (const invalid of ['{bad', 'null', 'x'.repeat(65537)]) {
      localStorage.setItem('vault', invalid);
      expect(await loadVault('old-password')).toBeNull();
    }
    expect(derive).not.toHaveBeenCalled();
  });

  it('cannot recreate a deleted vault when a save finishes after logout', async () => {
    const original = crypto.subtle.deriveKey.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(async (...args) => { await gate; return original(...args); });
    const pending = saveVault(seed, 'old-password');
    const rejected = expect(pending).rejects.toThrow('vault_changed_during_operation');
    clearVault(); release();
    await rejected;
    expect(hasVault()).toBe(false);
  });

  it('does not return a secret decrypted after logout or a trust-mode change', async () => {
    await saveVault(seed, 'old-password');
    const original = crypto.subtle.decrypt.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => { await gate; return original(...args); });
    const pending = loadVault('old-password');
    setVaultPersistence(false); release();
    expect(await pending).toBeNull();
    expect(localStorage.getItem('vault')).toBeNull();
  });

  it('cancels a password change if logout happens during replacement encryption', async () => {
    await saveVault(seed, 'old-password');
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let replacing = false;
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => { replacing = true; await gate; return original(...args); });
    const pending = changeVaultPassword('old-password', 'new-password', true);
    const rejected = expect(pending).rejects.toThrow('vault_changed_during_operation');
    await vi.waitFor(() => expect(replacing).toBe(true));
    clearVault(); release();
    await rejected;
    expect(hasVault()).toBe(false);
  });

  it('does not overwrite changes made by another tab while encryption was pending', async () => {
    await saveVault(seed, 'old-password');
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let replacing = false;
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => { replacing = true; await gate; return original(...args); });
    const pending = saveVault(seed, 'new-password');
    const rejected = expect(pending).rejects.toThrow('vault_changed_during_operation');
    await vi.waitFor(() => expect(replacing).toBe(true));
    localStorage.setItem('vault', 'another tab record'); release();
    await rejected;
    expect(localStorage.getItem('vault')).toBe('another tab record');
  });

  it('keeps a trusted vault after a new page runtime starts', async () => {
    await saveVault(seed, 'old-password', null, true);
    discardTransientVaultOnStartup();
    expect(hasVault()).toBe(true);
    expect((await loadVault('old-password'))?.mnemonic).toEqual(seed);
  });

  it('moves the encrypted vault when trust changes', async () => {
    await saveVault(seed, 'old-password', null, true);
    expect(isTrustedDevice()).toBe(true);
    localStorage.removeItem('trustedDevice');
    expect(isTrustedDevice()).toBe(true); // Existing vaults predate the checkbox.
    setVaultPersistence(false);
    expect(localStorage.getItem('vault')).toBeNull();
    expect(sessionStorage.getItem('vault')).toBeNull();
    expect(hasVault()).toBe(true);
    expect((await loadVault('old-password'))?.mnemonic).toEqual(seed);
    setVaultPersistence(true);
    expect(isTrustedDevice()).toBe(true);
    expect(sessionStorage.getItem('vault')).toBeNull();
    discardTransientVaultOnStartup();
    expect((await loadVault('old-password'))?.mnemonic).toEqual(seed);
  });

  it('changes the password of an untrusted in-memory vault', async () => {
    await saveVault(seed, 'old-password', null, false);
    expect(await changeVaultPassword('old-password', 'new-password', false)).toBe(true);
    expect(await loadVault('old-password')).toBeNull();
    expect((await loadVault('new-password'))?.mnemonic).toEqual(seed);
    expect(localStorage.getItem('vault')).toBeNull();
  });

  it('changes the password without a seed prompt and rejects an incorrect old password', async () => {
    await saveVault(seed, 'old-password', null, true);
    expect(await changeVaultPassword('incorrect', 'new-password', true)).toBe(false);
    expect((await loadVault('old-password'))?.mnemonic).toEqual(seed);
    expect(await changeVaultPassword('old-password', 'new-password', true)).toBe(true);
    expect(await loadVault('old-password')).toBeNull();
    expect((await loadVault('new-password'))?.mnemonic).toEqual(seed);
    clearVault();
    expect(hasVault()).toBe(false);
    expect(isTrustedDevice()).toBe(false);
  });
});
