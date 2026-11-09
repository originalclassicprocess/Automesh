import type { IdentityProvider } from '$lib/identity/identity';
import { isLocalHost } from '$lib/transport/client-config';
import { nodeProofBytes, NODE_PROTOCOL } from './protocol.js';
import { isValidAccountId } from '$lib/addressing/bech32m.js';
import {COURIER_PREKEY_PATHS} from './courier-prekeys.js';
import {RECIPIENT_INBOX_PATHS} from './recipient-inbox.js';

export type NodeInfo = { protocol: string; nodeId: string; role?: 'home' | 'server'; adminPanel?: boolean; capabilities: string[]; paired: boolean; chatOfflineDelivery: boolean; multiMailbox?: boolean;
  deviceDirectory?: { protocol: string; publicKey: string };
  courierProtocol?: string; courierAddress?: string; courierEnabled?: boolean; signalingEnabled?: boolean;
  courierLanEnabled?: boolean; courierInternetEnabled?: boolean; deliveryScopes?: boolean;
  fileQueue?: { protocol: string; maxFileBytes: number; chunkBytes: number } };
export function homeNodeUrl(value: string): string {
  const url = new URL(value.trim());
  if (value.length > 512 || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('invalid_node_url');
  return url.origin;
}
export function requireNodeNetwork(url: string, lanOnly = false): void {
  if (lanOnly && !isLocalHost(new URL(homeNodeUrl(url)).hostname)) throw new Error('internet_disabled');
}
const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const paths = new Set(['/node/pair','/node/join','/mailbox/put','/mailbox/list','/mailbox/receipts','/mailbox/ack','/mailbox/grant','/mailbox/revoke','/mailbox/status',
  '/devices/publish','/devices/policy','/devices/keys','/devices/allocate','/devices/put','/devices/list','/devices/ack','/devices/receipts','/devices/grant',
  ...COURIER_PREKEY_PATHS,...RECIPIENT_INBOX_PATHS,'/outbox/put','/outbox/status','/outbox/list','/outbox/receipts','/outbox/outcomes','/outbox/cancel','/outbox/route','/outbox/file/start','/outbox/file/part','/outbox/file/cancel','/inbox/list','/inbox/ack','/inbox/file/parts','/admin/connect/approve']);
const publicErrors = new Set(['invalid_recipient_grant','unauthorized','not_owner','not_member','sender_not_allowed','invalid_pair_code','already_paired','member_removal_pending',
  'device_denied','device_capacity','device_policy_conflict','device_keys_unavailable','invalid_device_signature','invalid_device_roster','invalid_device_authority','invalid_device_object',
  'invalid_envelope','invalid_ack','message_conflict','mailbox_full','courier_disabled','invalid_courier_job','invalid_courier_author','invalid_courier_signature',
  'invalid_attachment','invalid_attachment_part','attachment_conflict','attachment_incomplete','attachment_denied','attachment_digest_mismatch',
  'invalid_courier_receipt','invalid_challenge','too_many_challenges','invalid_sender','sender_limit','member_limit','body_limit','rate_limit',
  'prekey_denied','prekey_capacity','prekeys_unavailable','invalid_prekey','invalid_prekey_lifetime','invalid_prekey_source','invalid_prekey_request','prekey_conflict',
  'node_unavailable','invalid_host','origin_denied','not_found','json_required','invalid_request','invalid_json']);
export function nodeResponseError(value: unknown): string {
  // Remote errors are untrusted. Never echo response bodies, URLs, IDs or
  // arbitrary text into interface/diagnostic exceptions.
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : undefined;
  const error = record?.error;
  if (error === 'mailbox_full') {
    const reasons: Record<string,string> = { node_files:'node_file_limit', profile_files:'profile_file_limit', storage:'node_storage_limit',
      node_messages:'node_message_limit', profile_messages:'profile_message_limit' };
    if (typeof record?.limit === 'string' && Object.hasOwn(reasons, record.limit)) return reasons[record.limit];
  }
  return typeof error === 'string' && publicErrors.has(error) ? error : 'node_unavailable';
}
export function normalizeNodeInfo(raw: unknown): NodeInfo {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('node_protocol_invalid');
  const value = raw as Record<string,unknown>;
  if (value.protocol !== NODE_PROTOCOL || typeof value.nodeId !== 'string' || !/^[a-f0-9]{32}$/.test(value.nodeId) ||
      !Array.isArray(value.capabilities) || value.capabilities.length > 32 ||
      value.capabilities.some(item=>typeof item!=='string' || !/^[a-z][a-z0-9-]{0,63}$/.test(item)) ||
      !value.capabilities.includes('opaque-mailbox') || typeof value.paired !== 'boolean') throw new Error('node_protocol_invalid');
  const result: NodeInfo = {protocol:NODE_PROTOCOL,nodeId:value.nodeId,capabilities:[...new Set(value.capabilities as string[])],paired:value.paired,chatOfflineDelivery:false};
  if (value.deviceDirectory !== undefined) {
    const directory = value.deviceDirectory as Record<string, unknown>;
    if (!directory || directory.protocol !== 'automesh-device-directory-v2' || typeof directory.publicKey !== 'string' || !/^04[a-f0-9]{128}$/.test(directory.publicKey)) throw new Error('node_protocol_invalid');
    result.deviceDirectory = { protocol: directory.protocol, publicKey: directory.publicKey };
  }
  for (const field of ['adminPanel','chatOfflineDelivery','multiMailbox','courierEnabled','signalingEnabled','courierLanEnabled','courierInternetEnabled','deliveryScopes'] as const) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== 'boolean') throw new Error('node_protocol_invalid');
      result[field] = value[field];
    }
  }
  if (value.role !== undefined) {
    if (value.role!=='home' && value.role!=='server') throw new Error('node_protocol_invalid');
    result.role=value.role;
  }
  if (value.courierProtocol !== undefined) {
    if (typeof value.courierProtocol!=='string' || !/^[a-z0-9-]{1,64}$/.test(value.courierProtocol)) throw new Error('node_protocol_invalid');
    result.courierProtocol=value.courierProtocol;
  }
  if (value.courierAddress !== undefined) {
    if (typeof value.courierAddress!=='string' || !isValidAccountId(value.courierAddress)) throw new Error('node_protocol_invalid');
    result.courierAddress=value.courierAddress;
  }
  if (value.fileQueue !== undefined) {
    const file = value.fileQueue as Record<string,unknown>;
    if (!file || typeof file!=='object' || Array.isArray(file) || typeof file.protocol!=='string' || !/^[a-z0-9-]{1,64}$/.test(file.protocol) ||
        !Number.isSafeInteger(file.maxFileBytes) || (file.maxFileBytes as number)<1 || (file.maxFileBytes as number)>100*1024*1024 ||
        !Number.isSafeInteger(file.chunkBytes) || (file.chunkBytes as number)<1 || (file.chunkBytes as number)>256*1024) throw new Error('node_protocol_invalid');
    result.fileQueue={protocol:file.protocol,maxFileBytes:file.maxFileBytes as number,chunkBytes:file.chunkBytes as number};
  }
  return result;
}
async function responseJson(response: Response) {
  if (response.redirected) throw new Error('node_redirect');
  const reader = response.body?.getReader(); if (!reader) throw new Error('node_empty_response');
  const decoder = new TextDecoder(); const parts: string[] = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break; bytes += next.value.length;
      if (bytes > 512 * 1024) { await reader.cancel(); throw new Error('node_response_limit'); }
      parts.push(decoder.decode(next.value, { stream: true }));
    }
    parts.push(decoder.decode());
  } finally { reader.releaseLock(); }
  const text = parts.join('');
  let value: unknown;
  try { value=JSON.parse(text); } catch { throw new Error('node_response_invalid'); }
  if (!response.ok) throw new Error(nodeResponseError(value)); return value;
}
export async function inspectHomeNode(url: string, signal: AbortSignal): Promise<NodeInfo> {
  const value = await responseJson(await fetch(`${homeNodeUrl(url)}/node/info`, { signal, credentials: 'omit', cache: 'no-store', redirect: 'error' }));
  return normalizeNodeInfo(value);
}
export async function signedNodeRequest(url: string, nodeId: string, identity: IdentityProvider, address: string,
  path: string, value: unknown, signal: AbortSignal): Promise<unknown> {
  const base = homeNodeUrl(url);
  if (!paths.has(path) || !/^[a-f0-9]{32}$/.test(nodeId) || !isValidAccountId(address)) throw new Error('invalid_node_request');
  if (signal.aborted) throw new Error('node_cancelled');
  const body = JSON.stringify(value); const bytes = new TextEncoder().encode(body);
  const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const challenge = await responseJson(await fetch(`${base}/node/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, method: 'POST', path, digest }), signal, credentials: 'omit', redirect: 'error', cache: 'no-store' }));
  if (!challenge || typeof challenge!=='object' || Array.isArray(challenge)) throw new Error('node_identity_changed');
  const proofChallenge=challenge as Record<string,unknown>;
  if (proofChallenge.nodeId !== nodeId || typeof proofChallenge.challenge!=='string' || !/^[a-f0-9]{64}$/.test(proofChallenge.challenge)) throw new Error('node_identity_changed');
  if (signal.aborted) throw new Error('node_cancelled');
  const publicKey = hex(await identity.getPublicKeyBytes());
  if (signal.aborted) throw new Error('node_cancelled');
  const signature = hex(await identity.sign(nodeProofBytes(nodeId, address, proofChallenge.challenge, 'POST', path, digest)));
  if (signal.aborted) throw new Error('node_cancelled');
  const proof = btoa(JSON.stringify({ address, publicKey, signature, challenge: proofChallenge.challenge }))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return responseJson(await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Automesh-Proof': proof },
    body, signal, credentials: 'omit', redirect: 'error', cache: 'no-store' }));
}
