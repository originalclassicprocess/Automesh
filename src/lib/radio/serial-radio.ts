import { binary, bytesField, fields, numberField, int32Field, nonzeroFloat, PRIVATE_APP_PORT, TEXT_MESSAGE_APP, SerialFrames, serialFrame, textField, toRadioPacket, toChannelTextPacket, uint } from './meshtastic-wire';
import type { ChannelText, ChannelStatus } from './native-channels';
import type { RadioChannel, RadioProfile } from './network';
import { packetReception, type RadioReception } from './reception';
import { radioBoardName } from './board-name';
// Structural browser API types keep the core usable without Web Serial globals.
export type SerialPortLike = { readable: ReadableStream<Uint8Array> | null; writable: WritableStream<Uint8Array> | null;
  framing?: 'protobuf'; transport?: 'bluetooth'; deviceId?: string; deviceName?:string; connected?:boolean; resume?():Promise<void>;
  open(options: { baudRate: number }): Promise<void>; close(): Promise<void> };
export type RadioSnapshot = { node: number; firmware: string; name?:string; shortName?:string; profile: RadioProfile; channels: RadioChannel[] };
export type RadioPacket = { from: number; to: number; channel: number; payload: Uint8Array; pkiEncrypted?: boolean; reception?:RadioReception };
export type RadioDiagnostics = { queued: number; queueErrors: number; incoming: number; application: number; pki: number;
  undecoded: number; mqttSkipped: number; parseErrors: number; routeErrors: number;
  lastApplication: { from: number; to: number; channel: number; pkiEncrypted: boolean } | null; lastRouteError: number | null };
const emptyDiagnostics = (): RadioDiagnostics => ({ queued: 0, queueErrors: 0, incoming: 0, application: 0, pki: 0,
  undecoded: 0, mqttSkipped: 0, parseErrors: 0, routeErrors: 0, lastApplication: null, lastRouteError: null });
export class SerialRadio {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private generation = 0;
  private reading: Promise<void> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private pending = new Map<number, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private configuration: { resolve(snapshot: RadioSnapshot): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; nonce: number } | null = null;
  private channels = new Map<number, RadioChannel>();
  private node = 0; private firmware = ''; private lora: RadioProfile | null = null;
  private names=new Map<number,{name:string;shortName:string}>();
  private configSeen={node:false,lora:false};
  private nodeNames=new Map<number,string>();
  private failed = false;
  private stats = emptyDiagnostics();
  private sentIds = new Map<number, { time: number; to: number; channel?:number; receipt?: (accepted: boolean) => void }>();
  onPacket: (packet: RadioPacket) => void = () => {};
  onChannelText: (packet:ChannelText) => void = () => {};
  onChannelStatus:(status:ChannelStatus)=>void=()=>{};
  onHeard: (node:number,receivedAt:number) => void = () => {};
  onError: (code: string) => void = () => {};
  onDiagnostics: (diagnostics: RadioDiagnostics) => void = () => {};
  onConnection: (ready:boolean) => void = () => {};
  get ready() { return !!this.port && !!this.reader && !!this.writer && !this.failed && !!this.node && !!this.lora && this.port.connected!==false; }
  get diagnostics(): RadioDiagnostics { return { ...this.stats, lastApplication: this.stats.lastApplication && { ...this.stats.lastApplication } }; }
  private report() { this.onDiagnostics(this.diagnostics); }
  static supported(): boolean { return typeof navigator !== 'undefined' && 'serial' in navigator; }
  static async grantedPorts(): Promise<SerialPortLike[]> {
    if (!SerialRadio.supported()) return [];
    return (navigator as unknown as {serial:{getPorts():Promise<SerialPortLike[]>}}).serial.getPorts();
  }
  get selectedPort(): SerialPortLike | null { return this.port; }
  static async requestPort(): Promise<SerialPortLike> {
    if (!SerialRadio.supported()) throw Error('radio_serial_unsupported');
    return (navigator as unknown as {serial:{requestPort():Promise<SerialPortLike>}}).serial.requestPort();
  }
  async selectAndOpen(): Promise<RadioSnapshot> {
    if (!SerialRadio.supported()) throw Error('radio_serial_unsupported');
    // Must run from the user's button gesture; no automatic port claim.
    const port = await SerialRadio.requestPort(); return this.open(port);
  }
  async open(port: SerialPortLike): Promise<RadioSnapshot> {
    await this.close(); const generation = ++this.generation; this.failed = false;
    this.stats = emptyDiagnostics(); this.report();
    this.port = port;
    await port.open({ baudRate: 115200 });
    if (generation !== this.generation) { await port.close(); throw Error('radio_closed'); }
    this.port = port;
    try {
      if (!port.readable || !port.writable) throw Error('radio_serial_stream_missing');
      this.reader = port.readable.getReader(); this.writer = port.writable.getWriter();
      const nonce = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
      this.configSeen={node:false,lora:false};
      const ready = new Promise<RadioSnapshot>((resolve, reject) => {
        const timer = setTimeout(() => { this.configuration = null; reject(Error('radio_config_timeout')); }, port.transport==='bluetooth'?60000:30000);
        this.configuration = { resolve, reject, timer, nonce };
      });
      this.reading = this.read(generation);
      void this.write(uint(3, nonce)).catch(error => this.fail(error));
      const snapshot = await ready;
      if (generation !== this.generation) throw Error('radio_closed');
      this.onConnection(true);
      this.heartbeat = setInterval(() => { void this.write(binary(7, new Uint8Array())).catch(error => this.fail(error)); }, 60000);
      return snapshot;
    } catch (error) { await this.close(); throw error; }
  }
  private fail(error: unknown) {
    this.failed = true;
    this.onConnection(false);
    const failure = error instanceof Error ? error : Error('radio_serial_error');
    if (this.configuration) { clearTimeout(this.configuration.timer); this.configuration.reject(failure); this.configuration = null; }
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(failure); } this.pending.clear();
    this.onError(failure.message);
  }
  async resume():Promise<void> {
    const port=this.port,generation=this.generation;
    if(!this.ready||!port)throw Error('radio_not_ready');
    await port.resume?.();
    if(generation!==this.generation||this.port!==port||!this.ready)throw Error('radio_not_ready');
  }
  async check():Promise<RadioSnapshot>{
    if(!this.port||this.failed||this.configuration)throw Error('radio_not_ready');
    const nonce=crypto.getRandomValues(new Uint32Array(1))[0]||1;
    this.configSeen={node:false,lora:false};this.channels.clear();
    const ready=new Promise<RadioSnapshot>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.configuration=null;reject(Error('radio_config_timeout'));},this.port?.transport==='bluetooth'?30000:15000);
      this.configuration={resolve,reject,timer,nonce};
    });
    void this.write(uint(3,nonce)).catch(error=>this.fail(error));return ready;
  }
  private async write(bytes: Uint8Array) {
    const generation = this.generation, writer = this.writer;
    const operation = this.writeQueue.catch(() => {}).then(async () => {
      if (!writer || generation !== this.generation || this.failed) throw Error('radio_closed'); await writer.write(this.port?.framing === 'protobuf' ? bytes : serialFrame(bytes));
    }); this.writeQueue = operation; return operation;
  }
  async send(to: number, channel: number, payload: Uint8Array, allowed = () => true, receipt?: (accepted: boolean) => void): Promise<void> {
    if (!this.port || !this.node || !this.lora || this.failed) throw Error('radio_not_ready');
    if (!allowed()) throw Error('radio_closed');
    if (this.pending.size >= 2) throw Error('radio_usb_queue_full');
    let id = crypto.getRandomValues(new Uint32Array(1))[0] || 1; while (this.pending.has(id) || this.sentIds.has(id)) id = (id + 1) >>> 0 || 1;
    const request = toRadioPacket(to, channel, id, payload, !!receipt);
    return this.submit(id,to,request,receipt);
  }
  async sendChannelText(channel:number,id:number,text:string,replyId?:number):Promise<void> {
    if(!this.ready||!this.channels.has(channel))throw Error('radio_not_ready');
    if(this.pending.has(id)||this.sentIds.has(id)||this.pending.size>=2)throw Error('radio_usb_queue_full');
    return this.submit(id,0xffffffff,toChannelTextPacket(channel,id,text,replyId),undefined,channel);
  }
  private submit(id:number,to:number,request:Uint8Array,receipt?: (accepted:boolean)=>void,channel?:number):Promise<void> {
    const now = Date.now();
    for (const [oldId, sent] of this.sentIds) if (now - sent.time >= 600000) this.sentIds.delete(oldId);
    this.sentIds.set(id, { time: now, to, receipt,channel });
    if (this.sentIds.size > 1024) this.sentIds.delete(this.sentIds.keys().next().value!);
    const accepted = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('radio_queue_confirmation_timeout')); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
    });
    void this.write(request).catch(error => { const pending = this.pending.get(id); if (!pending) return; clearTimeout(pending.timer); this.pending.delete(id); pending.reject(error); });
    return accepted; // Device queue acceptance, NEVER recipient/application delivery.
  }
  private async read(generation: number) {
    const parser = new SerialFrames(), reader = this.reader!;
    try {
      while (generation === this.generation) {
        const { done, value } = await reader.read(); if (done) break;
        if (generation !== this.generation) return;
        for (const frame of this.port?.framing === 'protobuf' ? [value] : parser.feed(value)) {
          try { this.receive(frame); } catch (error) { this.stats.parseErrors++; this.report(); if (this.configuration) this.fail(error); else this.onError(error instanceof Error ? error.message : 'radio_invalid_device_packet'); }
        }
      }
      if (generation === this.generation) this.fail(Error('radio_usb_disconnected'));
    } catch (error) { if (generation === this.generation) this.fail(error); }
  }
  private receive(bytes: Uint8Array) {
    const frame = fields(bytes);
    if (frame.has(3)) {this.node = numberField(fields(bytesField(frame, 3)), 1);if(this.configuration)this.configSeen.node=true;}
    if(frame.has(4)) {
      const info=fields(bytesField(frame,4)),node=numberField(info,1);
      if(node&&info.has(2)) {
        const user=fields(bytesField(info,2)),name=radioBoardName(textField(user,2))||radioBoardName(textField(user,3));
        if(name){if(this.nodeNames.size>=256&&!this.nodeNames.has(node))this.nodeNames.delete(this.nodeNames.keys().next().value!);this.nodeNames.set(node,name);}
      }
      if(node&&info.has(2)&&(node===this.node||!this.node&&this.names.size<16)) {
        const user=fields(bytesField(info,2));
        this.names.set(node,{name:radioBoardName(textField(user,2)),shortName:radioBoardName(textField(user,3))});
      }
    }
    if (frame.has(13)) this.firmware = textField(fields(bytesField(frame, 13)), 1).slice(0, 80);
    if (frame.has(10)) {
      const outer = fields(bytesField(frame, 10)), index = numberField(outer, 1), role = numberField(outer, 3), channel = fields(bytesField(outer, 2));
      if (index > 7 || role > 2) throw Error('radio_invalid_channel');
      this.channels.set(index, { index, role, name: textField(channel, 3), psk: bytesField(channel, 2), uplink: !!numberField(channel, 5), downlink: !!numberField(channel, 6), aead: !!numberField(channel, 8) });
    }
    if (frame.has(5)) {
      const config = fields(bytesField(frame, 5));
      if (config.has(6)) {
        if(this.configuration)this.configSeen.lora=true;
        const lora = fields(bytesField(config, 6));
        if (!numberField(lora, 1) || nonzeroFloat(lora, 6) || nonzeroFloat(lora, 14) || numberField(lora, 12)) throw Error('radio_custom_modem_unsupported');
        this.lora = { region: numberField(lora, 7), preset: numberField(lora, 2), slot: numberField(lora, 11), primary: '' };
        if (!numberField(lora, 9)) throw Error('radio_transmit_disabled');
      }
    }
    if (frame.has(8) && numberField(frame, 8)) { this.fail(Error('radio_device_restarted')); return; }
    if (frame.has(7) && this.configuration && numberField(frame, 7) === this.configuration.nonce) {
      const pending = this.configuration; clearTimeout(pending.timer); this.configuration = null;
      const primary = [...this.channels.values()].find(channel => channel.role === 1);
      if (!this.configSeen.node || !this.configSeen.lora || !this.lora?.region || !primary || !this.node || this.node === 0xffffffff) { pending.reject(Error('radio_incomplete_config')); return; }
      const profile = { ...this.lora, primary: primary.name };
      pending.resolve({ node: this.node, firmware: this.firmware, ...this.names.get(this.node), profile, channels: [...this.channels.values()].filter(channel => channel.role) });
    }
    if (frame.has(11)) {
      const queue = fields(bytesField(frame, 11)), id = numberField(queue, 4), pending = this.pending.get(id);
      const sent=this.sentIds.get(id),code=int32Field(queue,1),native=sent?.to===0xffffffff&&sent.channel!==undefined;
      const rejected=code!==0&&!(native&&code===35);
      if(native&&Date.now()-sent.time<600000)this.onChannelStatus({id,channel:sent.channel!,status:rejected?'failed':'accepted',...(rejected?{failure:{source:'queue',code}}:{})});
      if (pending) {
        clearTimeout(pending.timer); this.pending.delete(id);
        if (rejected) { this.stats.queueErrors++; pending.reject(Error('radio_device_queue_rejected')); }
        else { this.stats.queued++; pending.resolve(); }
        this.report();
      }
    }
    if (frame.has(2)) {
      const packet = fields(bytesField(frame, 2));
      this.stats.incoming++;
      if (numberField(packet, 14)) { this.stats.mqttSkipped++; this.report(); return; } // Never bridge MQTT into the local-only experiment.
      const reception = packetReception(packet), from = numberField(packet,1);
      if(reception&&from&&from!==this.node)this.onHeard(from,reception.receivedAt);
      if (!packet.has(4)) { this.stats.undecoded++; this.report(); return; }
      const data = fields(bytesField(packet, 4)), port = numberField(data, 1);
      if(port===TEXT_MESSAGE_APP&&numberField(packet,2)===0xffffffff) {
        const channel=numberField(packet,3),id=numberField(packet,6),payload=bytesField(data,2);
        if(channel<=7&&id&&from&&from<0xffffffff&&this.channels.has(channel)&&payload.length<=512) {
          let text:string;
          try{text=new TextDecoder('utf-8',{fatal:true}).decode(payload);}
          catch{this.stats.parseErrors++;this.report();return;}
          if(text.trim()&&!numberField(data,8))this.onChannelText({id,from,channel,text,...(numberField(data,7)?{replyId:numberField(data,7)}:{}),name:this.nodeNames.get(from)??'',receivedAt:reception?.receivedAt??Date.now(),...(reception?{reception}:{})});
        }
        this.report();return;
      }
      if (port === 5) { // ROUTING_APP: device diagnostics, never application delivery.
        const requestId = numberField(data, 6), sent = this.sentIds.get(requestId);
        if (sent && Date.now() - sent.time < 600000 && numberField(packet, 2) === this.node) {
          const routing = fields(bytesField(data, 2));
          // Routing discovery requests/replies are not success ACKs merely
          // because their error_reason field is absent (protobuf default zero).
          // ack_proof (field 4) is an optional firmware receipt extension, not
          // route discovery. The board validates its own PKI proof; Automesh
          // still requires its separate signed application receipt for delivery.
          if (routing.has(1) || routing.has(2) || [...routing.keys()].some(field => field !== 3 && field !== 4) ||
              (routing.has(4) && bytesField(routing,4).length !== 8)) { this.report(); return; }
          const reason = numberField(routing, 3);
          const from = numberField(packet, 1);
          if(sent.to===0xffffffff&&sent.channel!==undefined){
            // Only our own board's correlated ROUTING_APP is the firmware's
            // broadcast/implicit ACK. Remote channel members cannot assert an
            // Automesh application receipt here. Route discovery was excluded above.
            if(from===this.node){
              this.onChannelStatus({id:requestId,channel:sent.channel,status:reason?'failed':'mesh',...(reason?{failure:{source:'routing',code:reason}}:{})});
            }
            this.report();return;
          }
          // A local/implicit routing ACK only proves a relay, not the intended
          // recipient. Never promote it to recipient-board acceptance.
          if (reason && (from === this.node || from === sent.to)) {
            this.stats.routeErrors++; this.stats.lastRouteError = reason;
            // Exhausted firmware retries do not prove the other app missed the
            // text: its signed ACK can still be queued behind other RF traffic.
            // Keep the application grace period and accept a late success.
            if(reason!==3&&reason!==5){
              const callback = sent.receipt; sent.receipt = undefined; callback?.(false);
              this.onError(`radio_route_${reason}`);
            }
          } else if (!reason && from === sent.to) {
            this.onHeard(from,reception?.receivedAt??Date.now());
            const callback = sent.receipt; sent.receipt = undefined; callback?.(true);
          }
        }
      }
      if (port !== PRIVATE_APP_PORT) { this.report(); return; }
      const route = { from: numberField(packet, 1), to: numberField(packet, 2), channel: numberField(packet, 3), pkiEncrypted: !!numberField(packet, 17) };
      this.stats.application++; if (route.pkiEncrypted) this.stats.pki++;
      this.stats.lastApplication = route; this.report();
      this.onPacket({ ...route, payload: bytesField(data, 2), ...(reception?{reception}:{}) });
    }
  }
  async close() {
    this.onConnection(false);
    ++this.generation; if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = null;
    const error = Error('radio_closed');
    if (this.configuration) { clearTimeout(this.configuration.timer); this.configuration.reject(error); this.configuration = null; }
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear();
    const reader = this.reader, writer = this.writer, port = this.port, reading = this.reading;
    this.reader = null; this.writer = null; this.port = null; this.reading = null;
    if (reader) { await reader.cancel().catch(() => {}); await reading; reader.releaseLock(); }
    await this.writeQueue.catch(() => {}); if (writer) writer.releaseLock(); if (port) await port.close().catch(() => {});
    this.writeQueue = Promise.resolve(); this.channels.clear(); this.lora = null; this.node = 0; this.firmware = '';
    this.sentIds.clear();
    this.names.clear();
    this.nodeNames.clear();
  }
}
