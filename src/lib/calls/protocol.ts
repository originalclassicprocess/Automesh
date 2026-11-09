// Controls travel ONLY through authenticated MAE, never through the courier.
export const CALL_PREFIX = '\u0000mesh-call-v1:';
export const RING_MS = 45_000;
export const CONNECT_MS = 30_000;
export const MAX_SDP = 24_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type CallSignal =
  | { kind: 'invite'; id: string; expires: number }
  | { kind: 'accept'; id: string }
  | { kind: 'busy'; id: string }
  | { kind: 'end'; id: string; reason?: 'finished' | 'declined' | 'busy' | 'unanswered' | 'network' | 'microphone' | 'security' | 'unsupported' }
  | { kind: 'offer' | 'answer'; id: string; sdp: string }
  | { kind: 'confirm'; id: string; digest: string }
  | { kind: 'candidate'; id: string; candidate: RTCIceCandidateInit };

export function normalizeCallSignal(value: unknown): CallSignal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !UUID.test(v.id)) return null;
  const id = v.id;
  if (v.kind === 'invite' && Number.isSafeInteger(v.expires)) return { kind: 'invite', id, expires: v.expires as number };
  if (v.kind === 'accept' || v.kind === 'busy') return { kind: v.kind, id };
  if (v.kind === 'end') {
    if (v.reason !== undefined && !['finished', 'declined', 'busy', 'unanswered', 'network', 'microphone', 'security', 'unsupported'].includes(v.reason as string)) return null;
    return { kind: 'end', id, ...(v.reason ? { reason: v.reason as Extract<CallSignal, { kind: 'end' }>['reason'] } : {}) };
  }
  if ((v.kind === 'offer' || v.kind === 'answer') && typeof v.sdp === 'string' && v.sdp.length <= MAX_SDP) {
    return { kind: v.kind, id, sdp: v.sdp };
  }
  if (v.kind === 'confirm' && typeof v.digest === 'string' && /^[0-9a-f]{64}$/.test(v.digest)) return { kind: 'confirm', id, digest: v.digest };
  if (v.kind === 'candidate' && v.candidate && typeof v.candidate === 'object') {
    const c = v.candidate as Record<string, unknown>;
    if (typeof c.candidate !== 'string' || c.candidate.length > 2048 ||
        !(c.sdpMid === null || typeof c.sdpMid === 'string' && c.sdpMid.length <= 64) ||
        !(c.sdpMLineIndex === null || Number.isInteger(c.sdpMLineIndex) && (c.sdpMLineIndex as number) >= 0 && (c.sdpMLineIndex as number) <= 1)) return null;
    return { kind: 'candidate', id, candidate: { candidate: c.candidate, sdpMid: c.sdpMid as string | null, sdpMLineIndex: c.sdpMLineIndex as number | null } };
  }
  return null;
}

export function encodeCallSignal(value: CallSignal): string {
  const valid = normalizeCallSignal(value);
  if (!valid) throw new Error('invalid_call_signal');
  return CALL_PREFIX + JSON.stringify(valid);
}

export function decodeCallSignal(text: string): CallSignal | null {
  if (!text.startsWith(CALL_PREFIX) || text.length > MAX_SDP + 3000) return null;
  try { return normalizeCallSignal(JSON.parse(text.slice(CALL_PREFIX.length))); } catch { return null; }
}

// Voice-only v1: no SDP downgrade, data/SFU/video channels, or renegotiation.
// The browser validates the remote DTLS certificate against this fingerprint.
export function audioFingerprint(sdp: string): string {
  if (!sdp || sdp.length > MAX_SDP || sdp.includes('\u0000')) throw new Error('call_security');
  const lines = sdp.split(/\r?\n/);
  const media = lines.filter(line => line.startsWith('m='));
  if (media.length !== 1 || !/^m=audio [1-9]\d* (?:UDP\/TLS\/RTP\/SAVPF|TCP\/TLS\/RTP\/SAVPF) \d+(?: \d+)*$/.test(media[0])) throw new Error('call_security');
  const fingerprints = lines.filter(line => line.startsWith('a=fingerprint:'));
  if (!fingerprints.length || fingerprints.some(line => !/^a=fingerprint:sha-256 (?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(line))) throw new Error('call_security');
  const values = fingerprints.map(line => line.slice('a=fingerprint:sha-256 '.length).replaceAll(':', '').toLowerCase());
  if (new Set(values).size !== 1 || lines.some(line => line.startsWith('a=crypto:'))) throw new Error('call_security');
  return values[0];
}

export async function callDigest(value: { id: string; expires: number; caller: string; callee: string; offer: string; answer: string }): Promise<string> {
  audioFingerprint(value.offer); audioFingerprint(value.answer);
  // Bind the complete authenticated offer/answer, roles, accounts and invite.
  const bytes = new TextEncoder().encode(JSON.stringify(['automesh-call-binding-v1', value.id, value.expires, value.caller, value.callee, value.offer, value.answer]));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function verificationCode(digest: string): string {
  if (!/^[0-9a-f]{64}$/.test(digest)) return '';
  // 128-bit comparison, not a guessable four-digit badge. Not a secret key.
  return digest.slice(0, 32).toUpperCase().match(/.{4}/g)!.join(' ');
}
