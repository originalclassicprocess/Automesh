import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { contactFromHash } from './contact-link';
import { isLocalHost, signalingUrlForPage, validatedSignalingUrl } from '$lib/transport/client-config';

export type ContactReference = { accountId: string; signalingUrl?: string };

// Parse data only: no navigation, probes or registration. A route from a shared
// contact URL is an untrusted discovery hint; accepting it grants no account or
// node permissions. MAE still authenticates the exact requested Account ID.
export function contactReferenceFromInput(value: string, ownId: string): ContactReference {
  let id = value.trim(), signalingUrl: string | undefined;
  if (id.length <= 2048 && !isValidAccountId(id)) {
    try {
      const url = new URL(id);
      const accountId = contactFromHash(url.hash);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.search && url.pathname === '/' && accountId) {
        id = accountId;
        // Do not turn someone else's LAN/loopback address into a destination on
        // this device. Local routes continue to use explicit node/direct QR.
        if (!isLocalHost(url.hostname) && /[a-z]/i.test(url.hostname) && !url.hostname.startsWith('[')) {
          signalingUrl = validatedSignalingUrl(signalingUrlForPage(url.href), url.href, 'internet') ?? undefined;
        }
      }
    } catch { /* Reject malformed input below. */ }
  }
  if (!isValidAccountId(id)) throw new Error('Нужен Mesh ID собеседника (mesh1…) или его контактный QR. QR сервера или соединения сюда не подходит.');
  if (id === ownId) throw new Error('Это ваш аккаунт. Выберите QR собеседника.');
  return { accountId: id, ...(signalingUrl ? { signalingUrl } : {}) };
}
export function contactIdFromInput(value: string, ownId: string): string {
  return contactReferenceFromInput(value, ownId).accountId;
}
