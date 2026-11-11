import { isValidAccountId } from '$lib/addressing/bech32m.js';

export type ProfileLink = { label: string; url: string };
export const MAX_PROFILE_LINKS = 5;
const unsafeText = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

// Profile URLs are plain user claims, never an ownership or identity proof.
export function normalizeProfileLinks(value: unknown): ProfileLink[] {
  if (!Array.isArray(value)) return [];
  const result: ProfileLink[] = [];
  for (const item of value.slice(0, MAX_PROFILE_LINKS)) {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string' || typeof item.label !== 'string') continue;
    const url = item.url.trim(), label = item.label.trim();
    if (!url || url.length > 512 || label.length > 40 || unsafeText.test(url + label)) continue;
    try {
      const parsed = new URL(url);
      if (parsed.href.length > 512 || !['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) continue;
      if (!result.some(link => link.url === parsed.href)) result.push({ label, url: parsed.href });
    } catch { /* Invalid URLs never become clickable. */ }
  }
  return result;
}

export function normalizePeerLinks(value: unknown): Record<string, ProfileLink[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 256).filter(([peer]) => isValidAccountId(peer))
    .map(([peer, links]) => [peer, normalizeProfileLinks(links)]));
}

export function readProfileLinksPacket(value: string): ProfileLink[] | null {
  if (value.length > 4000) return null;
  try {
    const raw: unknown = JSON.parse(value);
    if (!Array.isArray(raw) || raw.length > MAX_PROFILE_LINKS) return null;
    const links = normalizeProfileLinks(raw);
    return links.length === raw.length ? links : null;
  } catch { return null; }
}
