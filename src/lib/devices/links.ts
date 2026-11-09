import { canonicalJson, type JsonValue } from '../core/canonical';
import { signObject, verifyObject, type SignedObject } from '../core/objects';
import { isValidAccountId } from '../addressing/bech32m.js';
import { homeNodeUrl } from '../node/client';
import type { DirectoryAuthority } from './membership';
import type { IdentityProvider } from '../identity/identity';
import type { CoreEnvironment } from '../core/ports';
import { zlibSync, unzlibSync } from 'fflate';

export const DEVICE_LINK_PREFIX = '#/device/';
const INVITATION = 'automesh-device-invitation-v1', TTL = 10 * 60000;
export type PairingChannel = { origin: string; id: string; token: string; key: string };
export function validatePairingChannel(value: unknown): PairingChannel {
  const p = value as PairingChannel;
  if (!p || Object.keys(p).sort().join(',') !== 'id,key,origin,token' || ![p.id,p.token,p.key].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) throw new Error('device_pair_invalid');
  const url = new URL(p.origin);
  if (url.origin !== p.origin || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('device_pair_invalid');
  return { ...p };
}
export type DeviceLink = { kind: 'invite'; value: SignedObject } | { kind: 'request'; owner: string; value: SignedObject };
export function validateDeviceAuthority(value: unknown): DirectoryAuthority {
  const a = value as DirectoryAuthority;
  if (!a || Object.keys(a).sort().join(',') !== 'nodeId,publicKey,url' || typeof a.url !== 'string' ||
    homeNodeUrl(a.url) !== a.url || !/^[a-f0-9]{32}$/.test(a.nodeId) || !/^04[a-f0-9]{128}$/.test(a.publicKey)) throw new Error('device_invitation_invalid');
  return { url: a.url, nodeId: a.nodeId, publicKey: a.publicKey };
}
export async function createDeviceInvitation(authority: DirectoryAuthority | null, nickname: string, signer: IdentityProvider, env: CoreEnvironment, pairing?: PairingChannel) {
  const directory = authority ? validateDeviceAuthority(authority) : null;
  return signObject({ kind: 'document', audience: [], expiresAt: env.now() + TTL,
    body: { type: INVITATION, directory, nickname: nickname.slice(0, 64), ...(pairing ? { pairing: validatePairingChannel(pairing) } : {}) } as unknown as JsonValue }, signer, env);
}
export async function verifyDeviceInvitation(value: unknown, env: CoreEnvironment) {
  const invitation = await verifyObject(value, env), r = invitation.record, b = r.body as Record<string, unknown>;
  if (r.kind !== 'document' || r.audience.length || r.expiresAt === null || r.expiresAt - r.createdAt > TTL || r.createdAt > env.now() ||
    !b || Object.keys(b).sort().join(',') !== (b.pairing ? 'directory,nickname,pairing,type' : 'directory,nickname,type') || b.type !== INVITATION || typeof b.nickname !== 'string' || b.nickname.length > 64 || /[\u0000-\u001f\u007f]/.test(b.nickname)) throw new Error('device_invitation_invalid');
  return { owner: r.author, authority: b.directory === null ? null : validateDeviceAuthority(b.directory), nickname: b.nickname, pairing: b.pairing ? validatePairingChannel(b.pairing) : null };
}
export function deviceLink(value: DeviceLink, origin: string): string {
  const json = canonicalJson(value); if (new TextEncoder().encode(json).length > 8192) throw new Error('device_link_limit');
  // A new pairing invitation also contains a short-lived encrypted-rendezvous
  // capability. Never log/share this URL publicly. It cannot grant access alone.
  const encoded = btoa(String.fromCharCode(...zlibSync(new TextEncoder().encode(json)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return new URL('/', origin).href + DEVICE_LINK_PREFIX + 'z.' + encoded;
}
export function readDeviceLink(text: string): DeviceLink {
  if (text.length > 16384) throw new Error('device_link_limit');
  const url = new URL(text), packed = url.hash.slice(DEVICE_LINK_PREFIX.length), compressed = packed.startsWith('z.'), raw = compressed ? packed.slice(2) : packed;
  if (!url.hash.startsWith(DEVICE_LINK_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(raw) || url.username || url.password ||
    !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('device_link_invalid');
  const input = Uint8Array.from(atob(raw.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  // Fixed output buffer: reject oversized output without allocating a zip bomb.
  const bytes = compressed ? unzlibSync(input, { out: new Uint8Array(8193) }) : input;
  if (bytes.length > 8192) throw new Error('device_link_limit');
  const link = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as DeviceLink;
  canonicalJson(link);
  if (!link || (link.kind === 'invite' ? Object.keys(link).sort().join(',') !== 'kind,value' : link.kind === 'request'
    ? Object.keys(link).sort().join(',') !== 'kind,owner,value' || !isValidAccountId(link.owner) : true)) throw new Error('device_link_invalid');
  return link;
}
export function defaultDeviceLabel(userAgent: string): string {
  const os = /iPhone|iPod/.test(userAgent) ? 'iPhone' : /iPad/.test(userAgent) ? 'iPad' : /Android/.test(userAgent) ? 'Android'
    : /Windows/.test(userAgent) ? 'Windows' : /Macintosh|Mac OS/.test(userAgent) ? 'Mac' : /Linux/.test(userAgent) ? 'Linux' : 'Устройство';
  const browser = /Edg(?:e|A|iOS)?\//.test(userAgent) ? 'Edge' : /Firefox|FxiOS/.test(userAgent) ? 'Firefox'
    : /OPR\//.test(userAgent) ? 'Opera' : /Chrome|CriOS/.test(userAgent) ? 'Chrome' : /Safari/.test(userAgent) ? 'Safari' : 'Браузер';
  return `${browser} · ${os}`;
}
