import { describe, expect, it, vi } from 'vitest';
import { CourierController } from './courier-controller';
import { emptyCourierState } from './courier-state';
import { createCourierJob, generateCourierKey, signCourier } from './courier-crypto';
import { cipherDigest } from './offline-crypto';
import { COURIER_PROTOCOL } from './courier-protocol.js';
import { deliveryFailure, emptyDeliveryDiagnostics } from './delivery-diagnostics';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { encodeChatContent } from '$lib/chat/message-details';
import { emptySessionChats, ensureConversation, setContactState } from '$lib/chat/session-chats';

async function account() {
  const identity = new WebCryptoIdentity(); await identity.create();
  return { identity, address: await accountIdFromPublicKey(await identity.getPublicKeyBytes()) };
}
describe('privacy-safe delivery diagnostics', () => {
  it('never displays raw exceptions, message text, addresses or credentials', () => {
    const sensitive = 'secret@example.com message=password-token';
    expect(deliveryFailure(new Error(sensitive))).not.toContain(sensitive);
    expect(deliveryFailure(new Error('courier_not_saved'))).toContain('Подтверждение не отправлено');
    for(const code of ['courier_key_import_failed','courier_key_agreement_failed','courier_decryption_failed','invalid_courier_recipient','invalid_courier_packet','invalid_attachment_manifest'])
      expect(deliveryFailure(new Error(code))).toContain(`Код: ${code}`);
  });
  it('tracks a verified envelope but not a save or receipt before durable persistence, then acknowledges a retry', async () => {
    const [sender, recipient, node] = await Promise.all([account(), account(), account()]);
    const expiresAt = Date.now() + 60000, key = await generateCourierKey(sender.address, expiresAt);
    const bundle = await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: recipient.address, to: sender.address,
      expiresAt, keys: [{ id: key.id, publicKey: key.publicKey }] }, recipient.identity);
    const id = crypto.randomUUID();
    const job = await createCourierJob(sender.identity, sender.address, node.address, bundle, key, id, Date.now(), encodeChatContent('private text'));
    const hop = await signCourier('hop', { protocol: COURIER_PROTOCOL, courier: node.address, id, digest: await cipherDigest(job.body.packet) }, node.identity);
    let state = { ...emptyCourierState(), keys: [key] }, diagnostic = emptyDeliveryDiagnostics(), saved = false;
    const chats = setContactState(ensureConversation(emptySessionChats(), sender.address), sender.address, 'accepted');
    const receive = vi.fn(), reply = vi.fn();
    const worker = new CourierController({ ...recipient, state: () => state, update: value => { state = value; }, chats: () => chats,
      persist: async () => saved, receive, delivery: () => {}, publish: async () => {}, error: () => {}, diagnostics: value => { diagnostic = value; } });
    try {
      await expect(worker.receive({ from: node.address, job, hop }, reply)).rejects.toThrow('courier_not_saved');
      expect(diagnostic.envelopeAt).toBeGreaterThan(0);
      expect(diagnostic.savedAt).toBe(0); expect(diagnostic.receiptAt).toBe(0); expect(reply).not.toHaveBeenCalled();
      expect(diagnostic.failure).toContain('копия остаётся на ноде');
      saved = true; await worker.receive({ from: node.address, job, hop }, reply);
      expect(reply).toHaveBeenCalledOnce(); expect(receive).toHaveBeenCalledOnce();
      expect(diagnostic.savedAt).toBeGreaterThan(0); expect(diagnostic.receiptAt).toBeGreaterThan(0); expect(diagnostic.failure).toBe('');
      worker.stop(); const snapshot = diagnostic;
      await expect(worker.receive({ from: node.address, job, hop }, reply)).rejects.toThrow('courier_busy');
      expect(diagnostic).toBe(snapshot);
    } finally { worker.stop(); await worker.settled(); }
  });
});
