import type { ChatEntry } from '$lib/chat/session-chats';
import type { MessageDetails } from '$lib/chat/message-details';
import { parseRadioContact, type RadioContact } from './crypto';

export type RadioContactOffer = NonNullable<MessageDetails['radioContact']>;

// Only an account's own route can be accepted from that account's encrypted
// chat. A forwarded card remains displayable, but is never an authorization.
export async function verifyChatRadioContact(invite: string, peer: string, network: string): Promise<RadioContact> {
  const contact = await parseRadioContact(invite, network);
  if (contact.body.account !== peer) throw Error('radio_wrong_or_expired_peer');
  return contact;
}

export async function matchingRadioReply(message: ChatEntry, messages: ChatEntry[], own: RadioContact): Promise<boolean> {
  const reply = message.details?.radioContact;
  if (message.direction !== 'incoming' || message.file || message.details?.ephemeral || message.details?.forwarded || message.restoredFromBackup || message.importedFromDevice ||
      !reply?.replyTo || reply.replyTo !== own.body.keyId || own.body.expires <= Date.now()) return false;
  // Require the offer actually sent by this device/profile to this contact.
  // Merely guessing a public key ID or restoring old history grants no route.
  for (const offer of messages) {
    if (offer.direction !== 'outgoing' || offer.file || offer.details?.ephemeral || offer.details?.forwarded || offer.restoredFromBackup || offer.importedFromDevice ||
        offer.details?.radioContact?.replyTo || !offer.details?.radioContact) continue;
    if (offer.timestamp > message.timestamp + 300000) continue;
    try {
      const contact = await parseRadioContact(offer.details.radioContact.invite, own.body.network);
      if (contact.body.account === own.body.account && contact.body.keyId === own.body.keyId &&
          contact.publicKey === own.publicKey && contact.signature === own.signature) return true;
    } catch { /* Expired/invalid historical cards do not authorize an exchange. */ }
  }
  return false;
}
