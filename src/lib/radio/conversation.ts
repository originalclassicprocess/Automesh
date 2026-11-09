import { RadioAssembly, fragment } from './fragments';
import { RadioCrypto, digest, packetId, type RadioContact } from './crypto';
import { bytesToHex } from '$lib/message/encoding';
import type { RadioPacket } from './serial-radio';
import { weakestReception, type RadioReception } from './reception';
import { RADIO_PENDING_LIMIT, RADIO_ACK_TIMEOUT_MS } from './limits';
export type RadioDelivery = 'queued' | 'transmitting' | 'awaiting' | 'board' | 'received' | 'retry' | 'stopped';
export type RadioMessage = { id: string; text: string; timestamp: number; outgoing: boolean; status: RadioDelivery; sent: number; total: number; reception?:RadioReception };
export type RadioLink = { send(to: number, channel: number, payload: Uint8Array, allowed?: () => boolean, receipt?: (accepted: boolean) => void): Promise<void> };
export type PreparedRadioMessage = { packet: Uint8Array; message: RadioMessage };
// A deliberately bounded, single-peer text experiment. It is not the live MAE
// reliable stream, has no automatic broadcasts, and never changes IP delivery.
export class RadioConversation {
  private readonly assembly = new RadioAssembly();
  private receptions = new Map<string,{until:number;value:RadioReception}>();
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private receiptQueue: Promise<void> = Promise.resolve();
  private frameQueue: Promise<void> = Promise.resolve();
  private receives: Promise<void> = Promise.resolve();
  private receiveCount = 0;
  private nextTransmission = 0;
  private stopped = false;
  private pending = new Map<string, { packet: Uint8Array; hash: Uint8Array; message: RadioMessage; attempts?:number; boardAccepted?:boolean; timer?: ReturnType<typeof setTimeout> }>();
  private accepted = new Map<string, { hash: string; receipt: Uint8Array; lastAck: number }>();
  onMessage: (message: RadioMessage) => Promise<void> | void = () => {};
  onUpdate: (message: RadioMessage) => void = () => {};
  onError: (code: string) => void = () => {};
  onPrepared: (value: PreparedRadioMessage) => Promise<void> = async () => {};
  constructor(readonly crypto: RadioCrypto, readonly peer: RadioContact, private readonly link: RadioLink, private readonly channel: number,
    private readonly gapMs = 10000, private readonly ackTimeoutMs = RADIO_ACK_TIMEOUT_MS, private readonly automaticRetries=0, private readonly retryDelayMs=30000) {}
  private update(message: RadioMessage) { this.onUpdate({ ...message }); }
  status(id: string) { return this.pending.get(id)?.message.status; }
  async send(text: string, id: string = crypto.randomUUID(), timestamp = Date.now()): Promise<string> {
    if (this.stopped) throw Error('radio_closed');
    if (this.pending.size >= RADIO_PENDING_LIMIT) throw Error('radio_outbox_limit');
    // Reserve before awaiting crypto, so parallel callers cannot bypass limits.
    if (this.pending.has(id)) throw Error('radio_message_already_queued');
    const message: RadioMessage = { id, text, timestamp, outgoing: true, status: 'queued', sent: 0, total: 0 };
    const entry: { packet: Uint8Array; hash: Uint8Array; message: RadioMessage; timer?: ReturnType<typeof setTimeout> } = { packet: new Uint8Array(), hash: new Uint8Array(), message };
    this.pending.set(id, entry); const generation = this.generation;
    try {
      const packet = await this.crypto.seal(this.peer, text, id, timestamp); const hash = await digest(packet);
      if (generation !== this.generation || this.pending.get(id) !== entry) throw Error('radio_closed');
      await this.onPrepared({ packet: packet.slice(), message: { ...message } });
      if (generation !== this.generation || this.pending.get(id) !== entry) throw Error('radio_closed');
      entry.packet = packet; entry.hash = hash; this.update(message);
      this.transmit(id); return id;
    } catch (error) { this.pending.delete(id); throw error; }
  }
  async restore(value: PreparedRadioMessage): Promise<void> {
    if (this.stopped || this.pending.size >= RADIO_PENDING_LIMIT || packetId(value.packet) !== value.message.id) throw Error('radio_invalid_saved_message');
    if (this.pending.has(value.message.id)) return;
    this.pending.set(value.message.id, { packet: value.packet.slice(), hash: await digest(value.packet), message: { ...value.message, status: value.message.status === 'board' ? 'board' : 'retry', sent: 0 } });
  }
  acknowledge(id: string) {
    const entry = this.pending.get(id); if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.message.status = 'received'; this.pending.delete(id);
  }
  retry(id: string) {
    const entry = this.pending.get(id);
    if (!entry || !['retry','stopped','awaiting','board'].includes(entry.message.status) || this.stopped) throw Error('radio_retry_unavailable');
    if (entry.timer) clearTimeout(entry.timer);
    entry.boardAccepted=false;
    entry.message.status = 'queued'; entry.message.sent = 0; this.update(entry.message); this.transmit(id);
  }
  private transmit(id: string) {
    const entry = this.pending.get(id); if (!entry) return;
    const frames = fragment(entry.packet); entry.message.total = frames.length;
    this.enqueue(async generation => {
      try {
        entry.attempts=(entry.attempts??0)+1;
        const attempt = entry.attempts, accepted = new Set<number>(); let rejected = false, sent = 0;
        const receipt = (index: number, success: boolean) => {
          if (generation !== this.generation || this.stopped || this.pending.get(id) !== entry || this.isReceived(entry.message)) return;
          if (!success) {
            if(entry.attempts!==attempt||entry.boardAccepted)return;
            rejected = true; if (entry.timer) clearTimeout(entry.timer);
            entry.message.status = 'retry'; this.update(entry.message); return;
          }
          accepted.add(index);
          // A slow firmware ACK can arrive after the next automatic attempt
          // started. Each closure still tracks all fragments of ONE attempt of
          // this exact signed ciphertext; never combine incomplete attempts.
          if (!rejected && accepted.size === frames.length && sent === frames.length) {
            entry.boardAccepted=true;
            if (entry.timer) clearTimeout(entry.timer);
            entry.message.status = 'board'; this.update(entry.message);
          }
        };
        entry.message.status = 'transmitting'; this.update(entry.message);
        for (let index = 0; index < frames.length; index++) {
          if (this.isReceived(entry.message) || rejected || entry.boardAccepted) break;
          await this.sendFrame(frames[index], generation, () => !this.isReceived(entry.message) && !rejected && !entry.boardAccepted, success => receipt(index, success));
          if (generation !== this.generation) return;
          sent=index+1;entry.message.sent = sent; this.update(entry.message);
        }
        if (!this.isReceived(entry.message) && !rejected) {
          if (entry.boardAccepted || accepted.size === frames.length) { entry.boardAccepted=true;entry.message.status = 'board'; this.update(entry.message); return; }
          entry.message.status = 'awaiting'; this.update(entry.message);
          entry.timer = setTimeout(() => {
            if (entry.message.status !== 'awaiting') return;
            if((entry.attempts??0)<=this.automaticRetries) {
              // An automatic retry is still work in progress (yellow), not a
              // request for the user to intervene (red).
              entry.timer=setTimeout(()=>{
                if(!this.stopped&&generation===this.generation&&entry.message.status==='awaiting')this.retry(id);
              },this.retryDelayMs);
            } else { entry.message.status='retry';this.update(entry.message); }
          }, this.ackTimeoutMs);
        }
      } catch (error) {
        if (generation !== this.generation || entry.message.status === 'received' || entry.boardAccepted) return;
        entry.message.status = 'retry'; this.update(entry.message); this.onError(error instanceof Error ? error.message : 'radio_send_failed');
      }
    });
  }
  private isReceived(message: RadioMessage) { return message.status === 'received'; }
  private enqueue(work: (generation: number) => Promise<void>) {
    const generation = this.generation;
    this.queue = this.queue.catch(() => {}).then(async () => { if (!this.stopped && generation === this.generation) await work(generation); }).catch(error => { if (!this.stopped) this.onError(error instanceof Error ? error.message : 'radio_queue_failed'); });
  }
  private sendFrame(frame: Uint8Array, generation: number, allowed = () => true, receipt?: (accepted: boolean) => void):Promise<void> {
    const next=this.frameQueue.catch(()=>{}).then(async()=>{
      const delay = Math.max(0, this.nextTransmission - Date.now()); if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (generation !== this.generation || this.stopped || !allowed()) throw Error('radio_closed');
      // All frames, including priority receipts, share the airtime guard.
      this.nextTransmission = Date.now() + this.gapMs; await this.link.send(this.peer.body.node, this.channel, frame, () => generation === this.generation && !this.stopped && allowed(), receipt);
    });this.frameQueue=next;return next;
  }
  receive(packet: RadioPacket) {
    // Meshtastic unicast can use node PKI and then reports channel 0, even when
    // the sender chose a secondary channel. This is not a PSK-channel fallback:
    // require the firmware PKI flag and still verify the paired route, network-
    // bound application signature, recipient key and authenticated ciphertext.
    const selectedPath = packet.channel === this.channel || (packet.channel === 0 && packet.pkiEncrypted === true);
    if (this.stopped || packet.from !== this.peer.body.node || packet.to !== this.crypto.contact.body.node || !selectedPath || this.receiveCount >= 16) return;
    let envelope: Uint8Array | null;
    try { envelope = this.assembly.add(packet.payload); } catch (error) { this.onError(error instanceof Error ? error.message : 'radio_invalid_fragment'); return; }
    let reception = packet.reception;
    if(packet.payload[3]===1){
      const key=bytesToHex(packet.payload.slice(4,20));
      for(const [id,value] of this.receptions)if(value.until<=Date.now())this.receptions.delete(id);
      if(reception){
        reception=weakestReception(this.receptions.get(key)?.value,reception);
        if(!this.receptions.has(key)&&this.receptions.size>=8)this.receptions.delete(this.receptions.keys().next().value!);
        this.receptions.set(key,{until:Date.now()+180000,value:reception});
      }else reception=this.receptions.get(key)?.value;
      if(envelope)this.receptions.delete(key);
    }
    if (!envelope) return;
    const snapshot = envelope, generation = this.generation; this.receiveCount++;
    this.receives = this.receives.catch(() => {}).then(async () => {
      if (generation !== this.generation) return;
      const id = packetId(snapshot);
      if (RadioCrypto.isReceipt(snapshot)) {
        const entry = this.pending.get(id); if (!entry) return;
        await this.crypto.verifyReceipt(this.peer, snapshot, entry.hash);
        if (generation !== this.generation) return;
        if (entry.timer) clearTimeout(entry.timer); entry.message.status = 'received'; this.update(entry.message); this.pending.delete(id); return;
      }
      const hash = bytesToHex(await digest(snapshot)), prior = this.accepted.get(id);
      if (prior) {
        if (prior.hash !== hash) throw Error('radio_message_id_conflict');
        if (Date.now() - prior.lastAck >= Math.max(30000, this.gapMs)) { prior.lastAck = Date.now(); this.sendReceipt(prior.receipt); }
        return;
      }
      const content = await this.crypto.open(this.peer, snapshot);
      if (generation !== this.generation) return;
      // The consumer must commit the receive before an application ACK is sent.
      await this.onMessage({ ...content, outgoing: false, status: 'received', sent: 0, total: 0, reception });
      if (generation !== this.generation) return;
      const receipt = await this.crypto.receipt(this.peer, snapshot);
      if (generation !== this.generation) return;
      // History remains the durable duplicate/conflict authority. This cache
      // only accelerates ACK replay and must never stop a long-lived chat.
      if (this.accepted.size >= 256) this.accepted.delete(this.accepted.keys().next().value!);
      this.accepted.set(id, { hash, receipt, lastAck: Date.now() }); this.sendReceipt(receipt);
    }).catch(error => { if (generation === this.generation) this.onError(error instanceof Error ? error.message : 'radio_receive_failed'); }).finally(() => { this.receiveCount--; });
  }
  private sendReceipt(receipt: Uint8Array) {
    const generation=this.generation;
    // Do not put an ACK behind every queued outgoing message for this peer.
    this.receiptQueue=this.receiptQueue.catch(()=>{}).then(async()=>{
      if(this.stopped||generation!==this.generation)return;
      // Ask firmware to retry the short application receipt too. A radio ACK
      // never changes application delivery and must not itself generate an ACK.
      for(const frame of fragment(receipt))await this.sendFrame(frame,generation,()=>true,()=>{});
    }).catch(error=>{if(generation===this.generation)this.onError(error instanceof Error?error.message:'radio_receipt_failed');});
  }
  close() {
    this.stopped = true; ++this.generation; this.assembly.clear(); this.receptions.clear();
    for (const entry of this.pending.values()) { if (entry.timer) clearTimeout(entry.timer); if (entry.message.status !== 'board') entry.message.status = 'stopped'; this.update(entry.message); }
    this.pending.clear(); this.accepted.clear();
  }
}
