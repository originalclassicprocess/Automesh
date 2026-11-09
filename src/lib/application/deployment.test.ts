import { afterEach, describe, expect, it, vi } from 'vitest';
import { applicationOrigin, deploymentDefaults } from './deployment';
import { contactLink, contactFromHash } from '../chat/contact-link';
import { encodeAccountId } from '../addressing/bech32m.js';
const id = encodeAccountId(new Uint8Array(20).fill(2));
afterEach(() => vi.unstubAllGlobals());
describe('deployment-independent contact links', () => {
  it('has two public roles and no website until its domain is owned, without silently connecting to a node', () => {
    expect(deploymentDefaults).toEqual({ appOrigin: 'https://automesh.online', projectOrigin: '', nodeOrigin: 'https://automesh.space' });
  });
  it('uses the current deployment, strips page routing and roundtrips the public contact', () => {
    for (const origin of ['https://automesh.online', 'https://chat.example:8443', 'http://localhost:5173', 'https://192.168.1.2:5174']) {
      const link = contactLink(id, origin + '/settings?x=1#old');
      expect(link).toBe(`${origin}/#/contact/${id}`);
      expect(contactFromHash(new URL(link).hash)).toBe(id);
    }
  });
  it('resolves location at use time and has a safe server fallback', () => {
    vi.stubGlobal('location', undefined); expect(applicationOrigin()).toBe(deploymentDefaults.appOrigin);
    vi.stubGlobal('location', { href: 'https://other.example/path' }); expect(contactLink(id)).toBe(`https://other.example/#/contact/${id}`);
  });
  it('rejects insecure public addresses, credentials, malformed IDs and non-web schemes', () => {
    for (const url of ['http://chat.example', 'https://user:pass@chat.example', 'javascript:alert(1)', 'file:///tmp/app'])
      expect(() => applicationOrigin(url)).toThrow();
    expect(() => contactLink('not-an-id')).toThrow('invalid_account_id');
  });
});
