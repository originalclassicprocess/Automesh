import { describe, expect, it } from 'vitest';
import { createDeviceInvitation, verifyDeviceInvitation, deviceLink, readDeviceLink, defaultDeviceLabel } from './links';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { webCryptoEnvironment } from '../core/ports';
import { zlibSync } from 'fflate';
const authority = { url: 'https://node.example.test', nodeId: 'a'.repeat(32), publicKey: '04' + 'b'.repeat(128) };
describe('two-sided public device links', () => {
  it('roundtrips a signed expiring invitation with owner and pinned node, without secrets', async () => {
    const signer = new WebCryptoIdentity(); await signer.create();
    try {
      const env = webCryptoEnvironment(), invitation = await createDeviceInvitation(authority, 'Personal', signer, env);
      const url = deviceLink({ kind: 'invite', value: invitation }, 'https://app.example.test');
      expect(new URL(url).search).toBe('');
      const parsed = readDeviceLink(url); expect(parsed.kind).toBe('invite');
      expect(await verifyDeviceInvitation(parsed.value, env)).toMatchObject({ authority, nickname: 'Personal', owner: invitation.record.author });
      await expect(verifyDeviceInvitation(invitation, { ...env, now: () => env.now() + 11 * 60000 })).rejects.toThrow();
      const changed = structuredClone(invitation); (changed.record.body as Record<string, unknown>).nickname = 'Attacker';
      await expect(verifyDeviceInvitation(changed, env)).rejects.toThrow();
      expect(JSON.stringify(invitation)).not.toMatch(/seed|mnemonic|password|privateKey/);
      expect(() => readDeviceLink(url.replace('https:', 'javascript:'))).toThrow();
      expect(() => readDeviceLink('https://app.example.test/#/device/' + 'a'.repeat(17000))).toThrow();
      const bomb = btoa(String.fromCharCode(...zlibSync(new TextEncoder().encode('x'.repeat(1000000))))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      expect(() => readDeviceLink('https://app.example.test/#/device/z.' + bomb)).toThrow('limit');
    } finally { signer.dispose(); }
  });
  it('uses a modest editable browser/OS label, not a unique fingerprint', () => {
    expect(defaultDeviceLabel('Mozilla iPhone AppleWebKit Safari')).toBe('Safari · iPhone');
    expect(defaultDeviceLabel('Windows Chrome/145 Edg/145')).toBe('Edge · Windows');
    expect(defaultDeviceLabel('Linux Android Chrome/145')).toBe('Chrome · Android');
    expect(defaultDeviceLabel('')).toBe('Браузер · Устройство');
  });
});
