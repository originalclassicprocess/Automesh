import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { applicationOrigin } from '../application/deployment';
// Public contact address, not an invitation or permission to access an account.
export function contactLink(accountId: string, pageUrl?: string): string {
  if (!isValidAccountId(accountId)) throw new Error('invalid_account_id');
  return `${applicationOrigin(pageUrl)}/#/contact/${encodeURIComponent(accountId)}`;
}
export function contactFromHash(hash: string): string | null {
  if (hash.length > 200 || !hash.startsWith('#/contact/')) return null;
  try {
    const id = decodeURIComponent(hash.slice('#/contact/'.length));
    return isValidAccountId(id) ? id : null;
  } catch { return null; }
}
