import { describe, expect, it } from 'vitest';
import { requireDeviceAuthority, deviceStartupFailure, deviceNodeCandidate } from './startup';

const authority = { url: 'https://node.example.test', nodeId: 'a'.repeat(32), publicKey: '04' + 'b'.repeat(128) };
describe('device startup feedback and pinned authority', () => {
  it('finds old incoming-only bindings without requiring the outgoing-reserve toggle', () => {
    const legacy = { url: authority.url, nodeId: authority.nodeId };
    expect(deviceNodeCandidate(null, null, legacy)).toBe(legacy);
    expect(deviceNodeCandidate(null, legacy, null)).toBe(legacy);
    expect(deviceNodeCandidate(authority, { ...legacy, nodeId: 'c'.repeat(32) }, legacy)).toBe(authority);
    expect(deviceNodeCandidate(null, null, null)).toBeNull();
  });
  it('accepts the same node after canonical serialization reorders its fields', () => {
    const reordered = { nodeId: authority.nodeId, publicKey: authority.publicKey, url: authority.url };
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(authority));
    expect(() => requireDeviceAuthority(reordered, authority)).not.toThrow();
    expect(() => requireDeviceAuthority(null, authority)).not.toThrow();
  });
  it.each(['url', 'nodeId', 'publicKey'] as const)('still rejects a changed %s without replacing trust', field => {
    expect(() => requireDeviceAuthority(authority, { ...authority, [field]: authority[field] + 'x' })).toThrow('device_directory_migration_required');
  });
  it('explains denied membership and retains only allowlisted diagnostic codes', () => {
    expect(deviceStartupFailure(new Error('device_denied')).message).toContain('этого профиля');
    expect(deviceStartupFailure(new Error('not_member')).code).toBe('not_member');
    const secret = 'secret-account-key https://private.test';
    expect(JSON.stringify(deviceStartupFailure(new Error(secret)))).not.toContain(secret);
    expect(deviceStartupFailure(new DOMException('secret', 'AbortError')).code).toBe('node_timeout');
  });
});
