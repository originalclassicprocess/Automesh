import { homeNodeUrl } from '../node/client';
import { isValidAccountId } from '../addressing/bech32m.js';
import { canonicalJson } from '../core/canonical';
import type { SignedObject } from '../core/objects';
import type { DirectoryAuthority } from './membership';
export type DeviceSettings = { enabled: boolean; allowCached: boolean; authority: DirectoryAuthority | null; peers: SignedObject[]; bootstrapSeen?: string[] };
export const emptyDeviceSettings = (): DeviceSettings => ({ enabled: true, allowCached: false, authority: null, peers: [] });
export function normalizeDeviceSettings(value: unknown): DeviceSettings {
  if (value === undefined) return emptyDeviceSettings();
  const raw = value as DeviceSettings;
  if (!raw || typeof raw.enabled !== 'boolean' || typeof raw.allowCached !== 'boolean' || !Array.isArray(raw.peers) || raw.peers.length > 50) throw new Error('device_settings_invalid');
  if (raw.authority && (homeNodeUrl(raw.authority.url) !== raw.authority.url || !/^[a-f0-9]{32}$/.test(raw.authority.nodeId) || !/^04[a-f0-9]{128}$/.test(raw.authority.publicKey))) throw new Error('device_settings_invalid');
  if (raw.bootstrapSeen !== undefined && (!Array.isArray(raw.bootstrapSeen) || raw.bootstrapSeen.length > 128 ||
    raw.bootstrapSeen.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)) || new Set(raw.bootstrapSeen).size !== raw.bootstrapSeen.length)) throw new Error('device_settings_invalid');
  const peers = raw.peers.map(roster => {
    canonicalJson(roster);
    if (!isValidAccountId(roster?.record?.author)) throw new Error('device_settings_invalid');
    return JSON.parse(JSON.stringify(roster)) as SignedObject; // Runtime verifies every signature before use.
  });
  if (new Set(peers.map(p => p.record.author)).size !== peers.length) throw new Error('device_settings_invalid');
  return { enabled: raw.enabled, allowCached: raw.allowCached, authority: raw.authority ? { ...raw.authority } : null, peers,
    ...(raw.bootstrapSeen ? { bootstrapSeen: [...raw.bootstrapSeen] } : {}) };
}
