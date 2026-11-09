import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testProtector } from './test-protection.fixture.js';
import { COURIER_PURPOSE, CONFIG_PURPOSE, sealSecret, openSecret, protectNodeConfig, readNodeConfig, windowsSecretProtector } from './secrets.js';
import { Courier } from './courier.js';
const directories = [];
const temporary = async () => { const d = await mkdtemp(join(tmpdir(), 'automesh-secrets-test-')); directories.push(d); return d; };
afterEach(async () => { for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
describe('node secret envelopes', () => {
  it('authenticates purpose, rejects tampering and another user key without plaintext fallback', async () => {
    const protector = testProtector(), value = { privateKey: 'secret-private-key' };
    const sealed = await sealSecret(value, COURIER_PURPOSE, protector);
    expect(JSON.stringify(sealed)).not.toContain(value.privateKey);
    expect(await openSecret(sealed, COURIER_PURPOSE, protector)).toEqual(value);
    await expect(openSecret(sealed, CONFIG_PURPOSE, protector)).rejects.toThrow('invalid_node_secret');
    await expect(openSecret(sealed, COURIER_PURPOSE, testProtector())).rejects.toThrow();
    const bytes = Buffer.from(sealed.ciphertext, 'base64'); bytes[16] ^= 1;
    await expect(openSecret({ ...sealed, ciphertext: bytes.toString('base64') }, COURIER_PURPOSE, protector)).rejects.toThrow();
    expect(() => windowsSecretProtector({ platform: 'linux' })).toThrow('node_secret_protection_unavailable');
  });
  it('migrates configuration without dropping public settings or exposing admin/TLS secrets', async () => {
    const d = await temporary(), path = join(d, 'config.json'), protector = testProtector();
    const value = { version: 1, adminToken: 'a'.repeat(64), pfxPassword: 'certificate-secret', port: 3003, maxMessages: 1000, signalingEnabled: false };
    await writeFile(path, JSON.stringify(value));
    expect(await readNodeConfig(path, protector)).toEqual(value);
    await protectNodeConfig(path, value, protector);
    const raw = await readFile(path, 'utf8');
    expect(raw).not.toContain(value.adminToken); expect(raw).not.toContain(value.pfxPassword);
    expect(await readNodeConfig(path, protector)).toEqual(value);
    await expect(readNodeConfig(path, testProtector())).rejects.toThrow();
    const disk = JSON.parse(raw); disk.adminToken = value.adminToken; await writeFile(path, JSON.stringify(disk));
    await expect(readNodeConfig(path, protector)).rejects.toThrow('invalid_node_configuration');
  });
  it('keeps courier identity across migration/restart and never resets an unreadable existing key', async () => {
    const d = await temporary(), protector = testProtector();
    let courier = await new Courier(d, { maxBytes: 1024 * 1024, secretProtector: protector }).initialize();
    const address = courier.address, path = join(d, 'courier-key.json'); await courier.close();
    const sealed = JSON.parse(await readFile(path, 'utf8')), legacy = await openSecret(sealed, COURIER_PURPOSE, protector);
    await writeFile(path, JSON.stringify(legacy));
    courier = await new Courier(d, { maxBytes: 1024 * 1024, secretProtector: protector }).initialize();
    expect(courier.address).toBe(address); await courier.close();
    const migrated = await readFile(path, 'utf8'); expect(migrated).not.toContain(legacy.privateKey);
    await expect(new Courier(d, { secretProtector: testProtector() }).initialize()).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(migrated);
    courier = await new Courier(d, { maxBytes: 1024 * 1024, secretProtector: protector }).initialize();
    expect(courier.address).toBe(address); await courier.close();
  });
  it.skipIf(process.platform !== 'win32')('round-trips using actual Windows CurrentUser DPAPI and purpose binding', async () => {
    const protector = windowsSecretProtector(), raw = Buffer.from('isolated-dpapi-test-secret');
    const sealed = await protector.protect(raw, COURIER_PURPOSE);
    expect((await protector.unprotect(sealed, COURIER_PURPOSE)).toString()).toBe(raw.toString());
    await expect(protector.unprotect(sealed, CONFIG_PURPOSE)).rejects.toThrow('node_secret_protection_failed');
  }, 30000);
});
