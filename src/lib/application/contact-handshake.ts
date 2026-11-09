import type { ContactState } from '../chat/session-chats';
// Reaffirm existing consent after the other side restored an account. No new
// consent is inferred from a connection, prekey bundle or unsolicited ACK.
export function contactHandshake(state: ContactState | undefined, signal: 'message' | 'accepted') {
  const accept = state === 'outgoing';
  const keys = accept || state === 'accepted';
  return { accept, keys, confirm: keys && (signal === 'message' || accept) };
}
