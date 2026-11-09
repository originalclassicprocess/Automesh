import { bytesToHex } from '$lib/message/encoding';
import { base64, unbase64 } from '$lib/node/offline-crypto';
export type RadioProfile = { region: number; preset: number; slot: number; primary: string };
export type RadioChannel = { index: number; name: string; psk: Uint8Array; role: number; uplink: boolean; downlink: boolean; aead: boolean };
export type NetworkInvite = { type: 'automesh-radio-network'; version: 1; profile: RadioProfile; name: string; psk: string; aead: boolean };
const prefix = 'mesh-radio-network1:';
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
export function validateProfile(value: unknown): RadioProfile {
  if (!plain(value) || Object.keys(value).sort().join(',') !== 'preset,primary,region,slot' ||
    !Number.isInteger(value.region) || (value.region as number) < 1 || (value.region as number) > 255 ||
    !Number.isInteger(value.preset) || (value.preset as number) < 0 || (value.preset as number) > 255 ||
    !Number.isInteger(value.slot) || (value.slot as number) < 0 || (value.slot as number) > 65535 ||
    typeof value.primary !== 'string' || new TextEncoder().encode(value.primary).length > 11 || /[\u0000-\u001f\u007f]/.test(value.primary)) throw Error('radio_invalid_profile');
  return { region: value.region as number, preset: value.preset as number, slot: value.slot as number, primary: value.primary };
}
export function networkInvite(profile: RadioProfile, channel: RadioChannel): NetworkInvite {
  const value = { type: 'automesh-radio-network' as const, version: 1 as const, profile: validateProfile(profile), name: channel.name, psk: channel.psk.length ? base64(channel.psk) : '', aead: channel.aead };
  return parseNetworkInvite(prefix + base64(new TextEncoder().encode(JSON.stringify(value))));
}
export function encodeNetworkInvite(value: NetworkInvite): string { return prefix + base64(new TextEncoder().encode(JSON.stringify(value))); }
export function parseNetworkInvite(text: string): NetworkInvite {
  if (text.length > 1600 || !text.startsWith(prefix)) throw Error('radio_invalid_network_invite');
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unbase64(text.slice(prefix.length))));
  if (!plain(value) || Object.keys(value).sort().join(',') !== 'aead,name,profile,psk,type,version' || value.type !== 'automesh-radio-network' || value.version !== 1 ||
    typeof value.name !== 'string' || new TextEncoder().encode(value.name).length > 11 || /[\u0000-\u001f\u007f]/.test(value.name) ||
    typeof value.psk !== 'string' || typeof value.aead !== 'boolean') throw Error('radio_invalid_network_invite');
  const key = value.psk ? unbase64(value.psk) : new Uint8Array();
  if (![0, 1, 16, 32].includes(key.length)) throw Error('radio_invalid_channel_key');
  return { type: 'automesh-radio-network', version: 1, profile: validateProfile(value.profile), name: value.name, psk: value.psk, aead: value.aead };
}
export async function networkId(value: NetworkInvite): Promise<string> {
  const p = validateProfile(value.profile);
  // Channel table indices are LOCAL; never use another device's index as a route.
  // When slot is automatic, primary name participates in firmware frequency selection.
  const bytes = new TextEncoder().encode(JSON.stringify(['automesh-radio-network-v1', p.region, p.preset, p.slot, p.slot ? '' : p.primary, value.name, value.psk, value.aead]));
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}
export async function matchingChannel(invite: NetworkInvite, profile: RadioProfile, channels: RadioChannel[]): Promise<RadioChannel | null> {
  const expected = await networkId(invite);
  for (const channel of channels) if (channel.role && await networkId(networkInvite(profile, channel)) === expected) return channel;
  return null;
}
