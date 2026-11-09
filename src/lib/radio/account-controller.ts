import type { IdentityProvider } from '$lib/identity/identity';
import { bytesToHex, hexToBytes } from '$lib/message/encoding';
import { decodeChatContent, encodeChatContent } from '$lib/chat/message-details';
import { receiveMessage, setDeliveryStatus, updateConversation, type ChatEntry, type SessionChats } from '$lib/chat/session-chats';
import { RadioCrypto, encodeRadioContact, parseRadioContact, MAX_RADIO_TEXT_BYTES } from './crypto';
import { RadioConversation, type RadioMessage, type RadioLink } from './conversation';
import { type RadioAccountState } from './account-state';
import type { RadioPacket } from './serial-radio';
import { RADIO_FRAME_GAP_MS, RADIO_PENDING_LIMIT, RADIO_ACK_TIMEOUT_MS } from './limits';

type Port = {
  signer: IdentityProvider; account: string;
  state(): RadioAccountState; setState(state: RadioAccountState): void;
  chats(): SessionChats; setChats(chats: SessionChats): void;
  persist(): Promise<boolean>; current(): boolean;
  nodeReserved(peer: string, id: string): boolean;
  error(code: string): void; delivered(peer: string, id: string): void;
};
export function radioEligible(message: ChatEntry): boolean {
  return message.direction === 'outgoing' && !message.radioSuppressed && !message.file && !message.localCall && !message.deviceMessage && !message.restoredFromBackup && !message.importedFromDevice && !message.nodeQueue &&
    !message.details?.ephemeral && !message.details?.ephemeralOpened && !message.details?.pin && !message.details?.media && !message.details?.contactCard && !message.details?.radioContact &&
    !['saving','sending','stored','delivered','read'].includes(message.delivery ?? '') &&
    new TextEncoder().encode(encodeChatContent(message.text, message.details)).length <= MAX_RADIO_TEXT_BYTES;
}
export function radioFallbackReady(message: ChatEntry, options: { accepted: boolean; directConnected: boolean; nodeReady: boolean; nodeReserved: boolean; hasRoute: boolean; now?: number }): boolean {
  return options.accepted && !options.directConnected && !options.nodeReady && !options.nodeReserved && options.hasRoute && !message.radioDelivery && radioEligible(message) && (options.now ?? Date.now()) - message.timestamp >= 15000;
}
// One controller per unlocked, durable primary profile. Meshtastic stays outside
// the fast streaming ChatService, but shares IDs, history and durable receipts.
export class RadioAccountController {
  private sessions = new Map<string, RadioConversation>();
  private closed = false;
  private writes: Promise<unknown> = Promise.resolve();
  private sends: Promise<unknown> = Promise.resolve();
  private nextFrame = 0;
  private frameQueue: Promise<unknown> = Promise.resolve();
  private constructor(private port: Port, readonly crypto: RadioCrypto, private link: RadioLink, private channel: number, private gap = RADIO_FRAME_GAP_MS) {}
  private current() { if (this.closed || !this.port.current()) throw Error('radio_closed'); }
  private async save() { this.current(); if (!await this.port.persist()) throw Error('radio_history_not_saved'); this.current(); }
  private write<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.catch(() => {}).then(() => { this.current(); return operation(); });
    this.writes = next; return next;
  }
  static async open(port: Port, network: string, node: number, link: RadioLink, channel: number, gap = RADIO_FRAME_GAP_MS) {
    let keys: RadioCrypto;
    const own = [port.state().own,...(port.state().keys??[])].find(k=>k&&k.contact.body.network===network&&k.contact.body.node===node&&k.contact.body.expires>Date.now());
    if (own && own.contact.body.network === network && own.contact.body.node === node && own.contact.body.expires > Date.now()) keys = await RadioCrypto.restore(port.signer, own);
    else keys = await RadioCrypto.create(port.signer, network, node);
    const controller = new RadioAccountController(port, keys, link, channel, gap);
    try {
      controller.current(); const saved = await keys.save(); controller.current();
      const state=port.state(),keyring=[...(state.keys??[]),...(state.own?[state.own]:[])].filter((k,i,a)=>k.contact.body.keyId!==saved.contact.body.keyId&&a.findIndex(v=>v.contact.body.keyId===k.contact.body.keyId)===i);
      if(keyring.length>=32)throw Error('radio_keyring_full');
      const pending = state.pending.filter(entry => !['delivered','read'].includes(port.chats().byPeer[entry.peer]?.messages.find(m=>m.id===entry.id)?.delivery ?? ''));
      port.setState({ ...state, own: saved, keys:[...keyring,saved], pending }); await controller.save();
      for (const [peer, route] of Object.entries(port.state().routes)) {
        if (port.chats().byPeer[peer]?.contact !== 'accepted') continue;
        try { await controller.addRoute(route, false); } catch { /* stale routes stay visible for replacement */ }
      }
      controller.current(); return controller;
    } catch (error) { controller.close(); throw error; }
  }
  get contact() { return encodeRadioContact(this.crypto.contact); }
  hasRoute(peer: string) { return !this.closed && this.crypto.contact.body.expires > Date.now() && this.sessions.has(peer) && this.sessions.get(peer)!.peer.body.expires > Date.now(); }
  peerNode(peer: string) { return this.hasRoute(peer) ? this.sessions.get(peer)?.peer.body.node : undefined; }
  async addRoute(text: string, persist = true, expectedAccount?: string): Promise<string> {
    const peer = await parseRadioContact(text.trim(), this.crypto.contact.body.network); this.current();
    const id = peer.body.account;
    if (expectedAccount && id !== expectedAccount) throw Error('radio_wrong_or_expired_peer');
    if (this.port.chats().byPeer[id]?.contact !== 'accepted') throw Error('radio_contact_not_accepted');
    if (id === this.port.account || peer.body.node === this.crypto.contact.body.node) throw Error('radio_wrong_or_expired_peer');
    if (this.hasRoute(id) && encodeRadioContact(this.sessions.get(id)!.peer) === text.trim()) return id;
    if (!this.sessions.has(id) && this.sessions.size >= 16) throw Error('radio_route_limit');
    if (persist) await this.write(async () => {
      const before = this.port.state(); this.port.setState({ ...before, routes: { ...before.routes, [id]: text.trim() } });
      try { await this.save(); } catch (error) { if (!this.closed && this.port.current()) this.port.setState(before); throw error; }
    });
    this.current();
    // Another simultaneous acceptance may have installed this exact session
    // while its durable route was being saved. Do not reset its transfers.
    if(this.hasRoute(id)&&encodeRadioContact(this.sessions.get(id)!.peer)===text.trim())return id;
    this.sessions.get(id)?.close();
    const session = new RadioConversation(this.crypto, peer, { send: (to, channel, payload, allowed, receipt) => this.frame(id,to, channel, payload, allowed, receipt) }, this.channel, 0,RADIO_ACK_TIMEOUT_MS,2);
    session.onPrepared = value => this.write(async () => {
      this.assertSend(id, value.message.id);
      const before = this.port.state();
      if (before.pending.length >= RADIO_PENDING_LIMIT) throw Error('radio_outbox_limit');
      const entry = { peer: id, id: value.message.id, text: value.message.text, timestamp: value.message.timestamp, packet: bytesToHex(value.packet), keyId: this.crypto.contact.body.keyId, peerKeyId: peer.body.keyId };
      this.port.setState({ ...before, pending: [...before.pending, entry] });
      try { await this.save(); } catch (error) { if (!this.closed && this.port.current()) this.port.setState(before); throw error; }
    });
    session.onMessage = message => this.write(() => this.receive(id, message));
    session.onUpdate = message => { void this.write(() => this.update(id, message)).catch(error => { if (!this.closed) this.port.error(error.message); }); };
    session.onError = code => { if (!this.closed && this.port.current()) this.port.error(code); };
    this.sessions.set(id, session);
    for (const entry of this.port.state().pending.filter(e => e.peer === id && e.keyId === this.crypto.contact.body.keyId && e.peerKeyId === peer.body.keyId)) {
      const message = this.port.chats().byPeer[id]?.messages.find(m => m.id === entry.id);
      if (!message || !radioEligible(message)) continue;
      await session.restore({ packet: hexToBytes(entry.packet), message: { ...entry, outgoing: true, status: message.radioDelivery === 'board' ? 'board' : 'retry', sent: 0, total: 0 } });
    }
    return id;
  }
  private frame(account:string,to: number, channel: number, payload: Uint8Array, allowed = () => true, receipt?: (accepted: boolean) => void): Promise<void> {
    return this.scheduleChannelSend(async()=>{
      const peer=this.sessions.get(account);
      if(!peer||peer.peer.body.node!==to||this.port.chats().byPeer[account]?.contact!=='accepted')throw Error('radio_contact_not_accepted');
      await this.link.send(to,channel,payload,allowed,receipt);
    },allowed);
  }
  // Native channel broadcasts share the same local airtime queue as signed
  // Automesh messages, but never gain their account/receipt semantics.
  scheduleChannelSend(send:()=>Promise<void>,allowed=()=>true):Promise<void> {
    const operation = this.frameQueue.catch(() => {}).then(async () => {
      const delay = this.nextFrame - Date.now(); if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      this.current();
      if (!allowed()) throw Error('radio_closed');
      this.nextFrame = Date.now() + this.gap; await send();
    }); this.frameQueue = operation; return operation;
  }
  private assertSend(peer: string, id: string) {
    this.current(); const conversation = this.port.chats().byPeer[peer];
    const message = conversation?.messages.find(m => m.id === id);
    if (conversation?.contact !== 'accepted' || !message || !radioEligible(message) || this.port.nodeReserved(peer, id)) throw Error('radio_message_unavailable');
    return message;
  }
  send(peer: string, id: string): Promise<void> {
    const operation = this.sends.catch(() => {}).then(async () => {
      const latest = this.port.chats().byPeer[peer]?.messages.find(m => m.id === id);
      if (latest && ['delivered','read'].includes(latest.delivery ?? '')) { this.acknowledge(peer,id); await this.save(); return; }
      const message = this.assertSend(peer, id), session = this.sessions.get(peer);
      if (!session || !this.hasRoute(peer)) throw Error('radio_route_missing');
      if (message.timestamp < Math.max(session.peer.body.created, this.crypto.contact.body.created) - 300000) throw Error('radio_message_before_route');
      const pending = this.port.state().pending.find(e => e.peer === peer && e.id === id);
      if (pending) {
        if (pending.keyId !== this.crypto.contact.body.keyId || pending.peerKeyId !== session.peer.body.keyId) throw Error('radio_route_changed');
        if (['queued','transmitting'].includes(session.status(id) ?? '')) return;
        if (!session.status(id)) await session.restore({ packet: hexToBytes(pending.packet), message: { ...pending, outgoing: true, status: 'retry', sent: 0, total: 0 } });
        session.retry(id);
      } else await session.send(encodeChatContent(message.text, message.details), id, message.timestamp);
    }); this.sends = operation; return operation;
  }
  receivePacket(packet: RadioPacket) { if (!this.closed && this.port.current()) for (const [peer, session] of this.sessions) if (this.port.chats().byPeer[peer]?.contact === 'accepted') session.receive(packet); }
  private async receive(peer: string, message: RadioMessage) {
    this.current(); const conversation = this.port.chats().byPeer[peer];
    if (conversation?.contact !== 'accepted') throw Error('radio_contact_not_accepted');
    const content = decodeChatContent(message.text);
    if (!content || content.details?.ephemeral || content.details?.ephemeralOpened || content.details?.pin || content.details?.media || content.details?.contactCard || content.details?.radioContact) throw Error('radio_unsupported_content');
    const existing = conversation.messages.find(m => m.id === message.id);
    if (existing && (existing.direction !== 'incoming' || encodeChatContent(existing.text, existing.details) !== encodeChatContent(content.text, content.details))) throw Error('radio_message_id_conflict');
    if (!conversation.deletedIds?.includes(message.id)) this.port.setChats(receiveMessage(this.port.chats(), { id: message.id, from: peer, timestamp: message.timestamp, direction: 'incoming', ...content, ...(message.reception?{radioReception:message.reception}:{}) }));
    // Always re-commit, including an in-memory duplicate after a failed write.
    await this.save();
  }
  private async update(peer: string, message: RadioMessage) {
    this.current(); const existing = this.port.chats().byPeer[peer]?.messages.find(m => m.id === message.id);
    if (!existing || existing.direction !== 'outgoing') return;
    // Frame progress is transient. Re-encrypting the whole history for every
    // fragment delays both directions; persist actual delivery transitions only.
    if (existing.radioDelivery === message.status && message.status !== 'received') return;
    if (message.status === 'received') {
      this.port.setChats(setDeliveryStatus(this.port.chats(), peer, message.id, 'delivered'));
      this.port.delivered(peer, message.id);
      this.port.setState({ ...this.port.state(), pending: this.port.state().pending.filter(e => e.peer !== peer || e.id !== message.id) });
    }
    this.port.setChats(updateConversation(this.port.chats(), peer, c => ({ ...c, messages: c.messages.map(m => m.id === message.id ? { ...m, radioDelivery: message.status } : m) })));
    await this.save();
  }
  acknowledge(peer: string, id: string) {
    if (this.closed) return;
    this.sessions.get(peer)?.acknowledge(id);
    this.port.setState({ ...this.port.state(), pending: this.port.state().pending.filter(e => e.peer !== peer || e.id !== id) });
  }
  async resumePending(onlyPeer?:string): Promise<void> {
    const candidates=this.port.chats().order.filter(peer=>!onlyPeer||peer===onlyPeer).flatMap(peer=>this.port.chats().byPeer[peer].messages.filter(m=>m.radioDelivery&&radioEligible(m)).map(m=>({peer,id:m.id,timestamp:m.timestamp})));
    for (const entry of candidates.sort((a,b)=>a.timestamp-b.timestamp)) {
      this.current();
      const m=this.port.chats().byPeer[entry.peer]?.messages.find(m=>m.id===entry.id);
      if (!m || !radioEligible(m) || !m.radioDelivery || m.radioDelivery === 'board' || this.port.chats().byPeer[entry.peer]?.contact!=='accepted') continue;
      if(!this.hasRoute(entry.peer)){
        this.port.error('radio_route_missing');
        await this.update(entry.peer,{...entry,text:m.text,outgoing:true,status:'retry',sent:0,total:0});continue;
      }
      try { await this.send(entry.peer,entry.id); }
      catch(error) { this.current(); this.port.error(error instanceof Error?error.message:'radio_send_failed'); }
    }
  }
  close() { this.closed = true; for (const session of this.sessions.values()) session.close(); this.sessions.clear(); this.crypto.dispose(); }
}
