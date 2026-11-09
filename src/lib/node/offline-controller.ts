import type { IdentityProvider } from '$lib/identity/identity';
import { deliveryIssueForError, type DeliveryIssue } from '$lib/application/delivery-issues';
import type { ChatMessage } from '$lib/chat/ChatService';
import type { SessionChats } from '$lib/chat/session-chats';
import { encodeChatContent, decodeChatContent } from '$lib/chat/message-details';
import { MAILBOX_PROTOCOL, MAX_MAIL_TTL_MS } from './protocol.js';
import { signedNodeRequest, requireNodeNetwork } from './client';
import { cipherDigest, generatePrekey, openOffline, receiptFor, sealOffline, signObject, validateBundle,
  verifyObject, verifyReceipt, unbase64, type Bundle, type MailBody, type NodeAddress, type Signed } from './offline-crypto';
import { MAX_OFFLINE_PENDING, MAX_PENDING_CHARS, type OfflineState, type PendingMail } from './offline-state';

type Port = { address: string; identity: IdentityProvider; state(): OfflineState; update(state: OfflineState): void;
  chats(): SessionChats; persist(): Promise<boolean>; receive(message: ChatMessage): void;
  authorize?(peer: string): Promise<void>; issue?(peer: string, id: string, issue: DeliveryIssue | undefined, error?: unknown): void;
  delivery(peer: string, id: string, status: 'queued' | 'stored' | 'delivered'): void; publish(peer: string, bundle: Bundle): Promise<void>;
  error(message: string): void; preferCourier?(): boolean; request?: typeof signedNodeRequest; lanOnly?(): boolean };
type Envelope = { id: string; sender: string; ciphertext: string; expiresAt: number };
// One serialized actor per unlocked account. The UI is a port, not a crypto dependency.
export class OfflineController {
  private active = true;
  private controller = new AbortController();
  private chain = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private port: Port) {}
  stop() { this.active = false; this.controller.abort(); clearTimeout(this.timer); }
  settled() { return this.chain; }
  private current() { if (!this.active) throw new Error('offline_session_closed'); }
  private serial(work: () => Promise<void>): Promise<void> {
    const result = this.chain.then(async () => { this.current(); await work(); }); this.chain = result.catch(() => {}); return result;
  }
  private async persist() { this.current(); if (!await this.port.persist()) throw new Error('offline_not_saved'); this.current(); }
  private update(state: OfflineState) { this.current(); this.port.update(state); }
  private async request(node: NodeAddress, path: string, value: unknown): Promise<any> {
    this.current(); const timeout = new AbortController();
    requireNodeNetwork(node.url, this.port.lanOnly?.());
    const abort = () => timeout.abort(); this.controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15000);
    try { const result = await (this.port.request ?? signedNodeRequest)(node.url, node.nodeId, this.port.identity, this.port.address, path, value, timeout.signal);
      this.current(); return result;
    } finally { clearTimeout(timer); this.controller.signal.removeEventListener('abort', abort); }
  }
  start() {
    const tick = async () => { if (!this.active) return;
      try { await this.poll(); } catch { if (this.active) this.port.error('Офлайн-узел недоступен или конверт не прошёл проверку. Очередь сохранена; повторим попытку.'); }
      if (this.active) this.timer = setTimeout(tick, 10000);
    }; void tick();
  }
  configure(node: NodeAddress, enabled: boolean) { return this.serial(async () => {
    const state = this.port.state();
    if (state.node && (state.node.url !== node.url || state.node.nodeId !== node.nodeId) && (state.keys.length || state.acks.length)) throw new Error('offline_node_change_pending');
    await this.request(node, '/mailbox/status', {});
    this.update({ ...state, node, enabled }); await this.persist();
  }); }
  accept(peer: string, input: unknown) { return this.serial(async () => {
    if (this.port.chats().byPeer[peer]?.contact !== 'accepted') return;
    const bundle = validateBundle(input as Bundle, peer, this.port.address);
    await verifyObject(bundle, 'prekeys', peer); this.current();
    const state = this.port.state();
    if (!state.bundles[peer] && Object.keys(state.bundles).length >= 50) throw new Error('offline_contact_limit');
    // Preserve signed bytes; consumption is tracked separately and never reset by a replay.
    this.update({ ...state, bundles: { ...state.bundles, [peer]: bundle } }); await this.persist();
  }); }
  publish(peer: string) { return this.serial(async () => {
    if (peer === this.port.address) return;
    let state = this.port.state(); const node = state.node;
    if (!state.enabled || !node || this.port.chats().byPeer[peer]?.contact !== 'accepted') return;
    await this.request(node, '/mailbox/grant', { address: peer });
    const now = Date.now(); const expiresAt = now + MAX_MAIL_TTL_MS;
    let keys = state.keys.filter(key => key.expiresAt > now);
    const reusable = keys.filter(key => key.peer === peer && key.nodeId === node.nodeId && (key.publishUntil??key.expiresAt) > now + 3600000);
    // Use a uniform expiry for the advertised batch; old batches remain decryptable until their TTL.
    const batch = reusable.length >= 8 ? reusable.slice(0, 32) : [];
    if (!batch.length) {
      if (keys.length + 16 > 1024) throw new Error('offline_prekey_limit');
      for (let i = 0; i < 16; i++) { const key = await generatePrekey(peer, node.nodeId, expiresAt,expiresAt+MAX_MAIL_TTL_MS); this.current(); batch.push(key); }
      keys = [...keys, ...batch]; this.update({ ...this.port.state(),version:2, keys }); await this.persist();
    }
    const body = { version: 1 as const, from: this.port.address, to: peer, node,
      ...(batch.every(k=>k.publishUntil!==undefined)?{deliveryTtlMs:MAX_MAIL_TTL_MS,retainUntil:Math.min(...batch.map(k=>k.publishUntil!))+MAX_MAIL_TTL_MS}:{}),
      expiresAt: Math.min(...batch.map(key => key.publishUntil??key.expiresAt)), keys: batch.map(({ id, publicKey }) => ({ id, publicKey })) };
    const bundle = await signObject(body, 'prekeys', this.port.identity); this.current();
    await this.port.publish(peer, bundle);
  }); }
  poll() { return this.serial(async () => {
    const state = this.port.state(); if (!state.enabled || !state.node) return;
    const now = Date.now();
    const expired = state.pending.filter(item => item.expiresAt <= now);
    for (const item of expired) this.port.delivery(item.peer, item.messageId, 'queued');
    this.update({ ...state, keys: state.keys.filter(key => key.expiresAt > now), pending: state.pending.filter(item => {
      const contact = this.port.chats().byPeer[item.peer]; const message = contact?.messages.find(msg => msg.id === item.messageId);
      return item.expiresAt > now && contact?.contact === 'accepted' && message && message.delivery !== 'delivered' && message.delivery !== 'read';
    }),
      acks: state.acks.filter(item => item.expiresAt > now), used: Object.fromEntries(Object.entries(state.used).filter(([, expiry]) => expiry > now)) });
    await this.persist();
    const node = this.port.state().node!;
    // Persisted receipt also acts as a replay tombstone, without keeping the private key.
    for (const ack of this.port.state().acks.filter(ack => !ack.confirmed).slice(0, 10)) {
      await this.request(node, '/mailbox/ack', { ids: [ack.id], receipts: { [ack.id]: ack.receipt } });
      this.update({ ...this.port.state(), acks: this.port.state().acks.map(item => item.id === ack.id ? { ...item, confirmed: true } : item) });
      await this.persist();
    }
    const incoming = await this.request(node, '/mailbox/list', {});
    if (!Array.isArray(incoming.envelopes) || incoming.envelopes.length > 10) throw new Error('invalid_offline_list');
    for (const item of incoming.envelopes as Envelope[]) {
      try { await this.receive(node, item); } catch { this.current(); this.port.error('Один конверт не прошёл проверку и не был подтверждён. Остальная очередь обрабатывается.'); }
    }
    const pending = this.port.state().pending.slice(0, 5);
    for (const item of pending) {
      const contact = this.port.chats().byPeer[item.peer];
      if (contact?.contact !== 'accepted' || !contact.messages.some(message => message.id === item.messageId && !message.nodeQueue)) continue;
      try { await this.port.authorize?.(item.peer); this.current(); }
      catch(error) { this.current(); this.port.issue?.(item.peer,item.messageId,deliveryIssueForError(error,'primary_policy_invalid'),error); continue; }
      const result = await this.request(item.node, '/mailbox/put', { protocol: MAILBOX_PROTOCOL, recipient: item.peer,
        id: item.id, expiresAt: item.expiresAt, ciphertext: item.ciphertext });
      if (result.status !== 'stored' && result.status !== 'acknowledged') throw new Error('invalid_offline_store');
      this.port.delivery(item.peer, item.messageId, 'stored');
      const receipts = await this.request(item.node, '/mailbox/receipts', { recipient: item.peer, ids: [item.id] });
      if (!Array.isArray(receipts.receipts) || receipts.receipts.length > 1) throw new Error('invalid_offline_receipts');
      if (receipts.receipts.length) {
        await verifyReceipt(receipts.receipts[0].receipt, { version: 1, from: item.peer, to: this.port.address, id: item.messageId,
          digest: await cipherDigest(item.ciphertext), nodeId: item.node.nodeId }); this.current();
        this.port.delivery(item.peer, item.messageId, 'delivered');
        this.update({ ...this.port.state(), pending: this.port.state().pending.filter(mail => mail.id !== item.id) });
      }
      await this.persist();
    }
    // New ciphertext is durably reserved BEFORE any upload. Retry always sends exact bytes.
    if (this.port.preferCourier?.()) return;
    let reserved = 0;
    for (const peer of this.port.chats().order) {
      const contact = this.port.chats().byPeer[peer]; const bundle = this.port.state().bundles[peer];
      if (peer === this.port.address || contact.contact !== 'accepted' || contact.connection === 'connected' || !bundle) continue;
      try { await this.port.authorize?.(peer); this.current(); }
      catch(error) { this.current(); for (const m of contact.messages.filter(m => !m.nodeQueue && m.direction === 'outgoing' && m.delivery === 'queued')) this.port.issue?.(peer,m.id,deliveryIssueForError(error,'primary_policy_invalid'),error); continue; }
      try { validateBundle(bundle, peer, this.port.address); await verifyObject(bundle, 'prekeys', peer); } catch { continue; }
      for (const message of contact.messages.filter(msg => !msg.radioDelivery && !msg.nodeQueue && !msg.restoredFromBackup && !msg.file && !msg.deviceMessage && msg.direction === 'outgoing' && ['queued', 'sent', 'stored'].includes(msg.delivery ?? ''))) {
        const state = this.port.state(); if (state.pending.some(mail => mail.messageId === message.id && mail.peer === peer)) continue;
        const key = bundle.body.keys.find(key => !state.used[key.id]);
        if (!key || reserved >= 10 || state.pending.length >= MAX_OFFLINE_PENDING || Object.keys(state.used).length >= 4096) break;
        const ciphertext = await sealOffline(this.port.identity, this.port.address, bundle, key, message.id, message.timestamp, encodeChatContent(message.text, message.details)); this.current();
        if (!this.port.chats().byPeer[peer]?.messages.some(msg => msg.id === message.id && !msg.nodeQueue && msg.delivery !== 'delivered' && msg.delivery !== 'read')) continue;
        const mail: PendingMail = { id: message.id.replaceAll('-', '').toLowerCase(), messageId: message.id, peer,
          node: bundle.body.node, expiresAt: (JSON.parse(new TextDecoder().decode(unbase64(ciphertext))) as Signed<MailBody>).body.expiresAt, ciphertext };
        if (state.pending.reduce((sum, mail) => sum + mail.ciphertext.length, ciphertext.length) > MAX_PENDING_CHARS) break;
        this.update({ ...this.port.state(), used: { ...this.port.state().used, [key.id]: mail.expiresAt + 86400000 }, pending: [...this.port.state().pending, mail] });
        await this.persist(); // Upload on the next poll; no uncommitted key can reach the node.
        reserved++;
      }
    }
  }); }
  private async receive(node: NodeAddress, envelope: Envelope) {
    const digest = await cipherDigest(envelope.ciphertext);
    const previous = this.port.state().acks.find(ack => ack.id === envelope.id);
    if (previous) { if (previous.digest !== digest || previous.sender !== envelope.sender) throw new Error('offline_replay_conflict'); return; }
    const raw: Signed<MailBody> = JSON.parse(new TextDecoder().decode(unbase64(envelope.ciphertext)));
    const key = this.port.state().keys.find(key => key.id === raw.body?.keyId);
    if (!key || envelope.sender !== key.peer) throw new Error('offline_key_unavailable');
    const opened = await openOffline(envelope.ciphertext, key, this.port.address, node.nodeId, envelope.id, envelope.expiresAt); this.current();
    const contact = this.port.chats().byPeer[key.peer];
    const accepted = contact?.contact === 'accepted';
    const content = decodeChatContent(opened.content)!;
    const receipt = accepted ? await receiptFor(opened.packet, envelope.ciphertext, this.port.identity) : ''; this.current();
    if (this.port.state().acks.length >= 2000) throw new Error('offline_ack_limit');
    if (accepted) this.port.receive({ id: raw.body.id, from: key.peer, timestamp: raw.body.timestamp, verified: true, via: 'mailbox', ...content });
    this.update({ ...this.port.state(), keys: this.port.state().keys.filter(item => item.id !== key.id),
      acks: [...this.port.state().acks, { id: envelope.id, sender: envelope.sender, digest, receipt, expiresAt: envelope.expiresAt }] });
    await this.persist(); // Message + key deletion + receipt are one encrypted account write.
    await this.request(node, '/mailbox/ack', { ids: [envelope.id], receipts: receipt ? { [envelope.id]: receipt } : {} });
    this.update({ ...this.port.state(), acks: this.port.state().acks.map(item => item.id === envelope.id ? { ...item, confirmed: true } : item) });
    await this.persist();
  }
}
