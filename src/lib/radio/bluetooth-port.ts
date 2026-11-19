import type { SerialPortLike } from './serial-radio';

// Published Meshtastic PhoneAPI. GATT carries whole protobufs, without serial framing.
export const MESHTASTIC_BLE = {
  service: '6ba1b218-15a8-461f-9fa8-5dcae273eafd',
  toRadio: 'f75c76d2-129e-4dad-a1dd-7866124401e7',
  fromRadio: '2c55e69e-4993-11ed-b878-0242ac120002',
  fromNum: 'ed9da18c-a800-4f66-a670-aa7547e34453',
};
export type BleCharacteristic = {
  readValue(): Promise<DataView>;
  writeValueWithResponse?(value: Uint8Array<ArrayBuffer>): Promise<void>;
  writeValue?(value: Uint8Array<ArrayBuffer>): Promise<void>;
  startNotifications(): Promise<unknown>;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
export type BleDevice = {
  id: string; name?: string;
  gatt?: { connected: boolean; connect(): Promise<{getPrimaryService(uuid:string):Promise<{getCharacteristic(uuid:string):Promise<BleCharacteristic>}>}>; disconnect():void };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
type BluetoothApi = { requestDevice(options: {filters:{services:string[]}[]}):Promise<BleDevice>; getDevices?():Promise<BleDevice[]> };
const api = () => typeof navigator === 'undefined' ? undefined : (navigator as unknown as {bluetooth?:BluetoothApi}).bluetooth;
const owners = new WeakMap<BleDevice,BluetoothRadioPort>();
const operations = new WeakMap<BleDevice,Promise<unknown>>();
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('radio_bluetooth_timeout')),20000);})]); }
  finally { clearTimeout(timer!); }
}
async function interruptible<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  let cancel=()=>{};
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{
    cancel=()=>reject(Error('radio_closed'));
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted)cancel();
  })]); }
  finally { signal.removeEventListener('abort',cancel); }
}
// Native Web Bluetooth bridges may reject with a DOMException or a plain object.
// Keep only our bounded error vocabulary; never display arbitrary bridge text.
function bluetoothError(error:unknown,fallback:string):Error {
  const value=error&&typeof error==='object'?error as {message?:unknown;name?:unknown}:undefined;
  const code=typeof value?.message==='string'?value.message:typeof error==='string'?error:'';
  if(/^radio_[a-z0-9_]+$/.test(code))return Error(code);
  if(value?.name==='NotAllowedError'||value?.name==='SecurityError')return Error('radio_bluetooth_permission');
  return Error(fallback);
}
export class BluetoothRadioPort implements SerialPortLike {
  readonly framing = 'protobuf' as const;
  readonly transport = 'bluetooth' as const;
  get deviceId() { return this.device.id; }
  get deviceName() { return this.device.name; }
  get connected() { return !this.closed && this.device.gatt?.connected === true; }
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  private input: ReadableStreamDefaultController<Uint8Array> | null = null;
  private fromRadio: BleCharacteristic | null = null;
  private fromNum: BleCharacteristic | null = null;
  private generation = 0;
  private cancellation = new AbortController();
  private closed = true;
  private draining = false;
  private wanted = false;
  private readyToRead = false;
  private poll: ReturnType<typeof setInterval> | null = null;
  constructor(readonly device: BleDevice) {}
  static supported() { return !!api()?.requestDevice; }
  static async requestPort() {
    const bluetooth = api(); if (!bluetooth) throw Error('radio_bluetooth_unsupported');
    // Called directly by a user gesture. Never open a picker automatically.
    return new BluetoothRadioPort(await bluetooth.requestDevice({filters:[{services:[MESHTASTIC_BLE.service]}]}));
  }
  static async remembered(deviceId: string): Promise<BluetoothRadioPort> {
    const bluetooth = api(); if (!bluetooth) throw Error('radio_bluetooth_unsupported');
    const device = (await bluetooth.getDevices?.() ?? []).find(d=>d.id===deviceId);
    if (!device) throw Error('radio_bluetooth_permission');
    return new BluetoothRadioPort(device);
  }
  private operation<T>(work:()=>Promise<T>,generation=this.generation):Promise<T> {
    const next=(operations.get(this.device)??Promise.resolve()).catch(()=>{}).then(()=>{
      if(this.closed||generation!==this.generation||owners.get(this.device)!==this)throw Error('radio_closed');
      // Keep the native operation in the device queue until it settles (or
      // times out), even when its caller cancels. A new session must not overlap
      // a still-completing read/write from the previous session.
      return bounded(work());
    });operations.set(this.device,next);return interruptible(next,this.cancellation.signal);
  }
  private notify=()=>{void this.drain();};
  private disconnected=()=>this.fail();
  private fail(code='radio_bluetooth_disconnected') {
    if(this.closed)return;
    const input=this.input;this.input=null;
    input?.error(Error(code));
    void this.close();
  }
  async open(_options: {baudRate:number}) {
    await this.close();const generation=++this.generation;this.closed=false;this.cancellation=new AbortController();
    owners.set(this.device,this);
    const active=()=>{if(generation!==this.generation||this.closed||owners.get(this.device)!==this)throw Error('radio_closed');};
    try {
      const gatt=this.device.gatt;if(!gatt)throw Error('radio_bluetooth_unsupported');
      this.device.addEventListener('gattserverdisconnected',this.disconnected);
      const server=await this.operation(()=>{
        const connecting=gatt.connect();
        // Cancellation cannot cancel a native promise. Release a late connection
        // only if nobody has since claimed this device for a newer session.
        void connecting.then(()=>{if((this.closed||generation!==this.generation)&&!owners.has(this.device))gatt.disconnect();},()=>{});
        return connecting;
      },generation);
      active();
      const service=await this.operation(()=>server.getPrimaryService(MESHTASTIC_BLE.service),generation);
      active();
      const to=await this.operation(()=>service.getCharacteristic(MESHTASTIC_BLE.toRadio),generation);
      active();
      const from=await this.operation(()=>service.getCharacteristic(MESHTASTIC_BLE.fromRadio),generation);
      active();
      const num=await this.operation(()=>service.getCharacteristic(MESHTASTIC_BLE.fromNum),generation);
      if(generation!==this.generation||this.closed)throw Error('radio_closed');
      this.fromRadio=from;this.fromNum=num;
      this.readable=new ReadableStream({start:controller=>{this.input=controller;},cancel:()=>this.close()},{highWaterMark:64});
      this.writable=new WritableStream({write:async bytes=>{
        if(!bytes.length||bytes.length>512)throw Error('radio_usb_frame_too_large');
        try {
          await this.operation(async()=>{
            if(!this.connected)throw Error('radio_bluetooth_disconnected');
            if(to.writeValueWithResponse)await to.writeValueWithResponse(bytes.slice());
            else if(to.writeValue)await to.writeValue(bytes.slice());
            else throw Error('radio_bluetooth_write_unsupported');
          },generation);
        } catch(error) {
          const failure=bluetoothError(error,'radio_bluetooth_write_failed');
          if(generation===this.generation)this.fail(failure.message);
          throw failure;
        }
        this.readyToRead=true;
        void this.drain();
      }});
      num.addEventListener('characteristicvaluechanged',this.notify);
      await this.operation(()=>num.startNotifications(),generation);
      if(generation!==this.generation||this.closed)throw Error('radio_closed');
      // Local GATT reads only: recover missed notifications without any RF probes.
      // An empty FromRadio read can block during setup on some firmware.
      // Let SerialRadio write want_config first, before draining its replies.
      this.poll=setInterval(()=>void this.drain(),1000);
    } catch(error) {if(generation===this.generation)await this.close();else if(this.closed&&(!owners.has(this.device)||owners.get(this.device)===this))this.device.gatt?.disconnect();throw bluetoothError(error,'radio_bluetooth_connect_failed');}
  }
  async resume():Promise<void> {
    const generation=this.generation;
    if(!this.connected||!this.fromNum)throw Error('radio_bluetooth_disconnected');
    try {
      // iOS can suspend GATT without a disconnect event. Verify the local link
      // and renew notifications; this never sends a packet over the radio.
      await this.operation(()=>this.fromNum!.startNotifications(),generation);
      await this.operation(()=>this.fromNum!.readValue(),generation);
      if(!this.connected||generation!==this.generation)throw Error('radio_bluetooth_disconnected');
      void this.drain();
    } catch(error) {
      const failure=bluetoothError(error,'radio_bluetooth_disconnected');
      if(generation===this.generation)this.fail(failure.message);
      throw failure;
    }
  }
  private async drain() {
    if(this.closed||!this.readyToRead)return;
    if(!this.connected){this.fail();return;}
    this.wanted=true;if(this.draining)return;this.draining=true;
    const generation=this.generation;
    try {
      while(this.wanted&&!this.closed&&generation===this.generation){
        this.wanted=false;
        for(let i=0;i<64;i++){
          if(this.closed||generation!==this.generation)return;
          // Do not consume/discard a board packet when our reader is busy.
          if((this.input?.desiredSize??0)<=0)break;
          const value=await this.operation(()=>this.fromRadio!.readValue(),generation);
          if(this.closed||generation!==this.generation)return;
          if(!value.byteLength)break;
          if(value.byteLength>512)throw Error('radio_usb_frame_too_large');
          this.input?.enqueue(new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice());
        }
      }
    } catch(error) {if(generation===this.generation)this.fail(bluetoothError(error,'radio_bluetooth_read_failed').message);}
    finally {this.draining=false;}
  }
  async close() {
    this.closed=true;++this.generation;this.cancellation.abort();this.wanted=false;this.readyToRead=false;
    if(this.poll)clearInterval(this.poll);this.poll=null;
    this.fromNum?.removeEventListener('characteristicvaluechanged',this.notify);
    this.device.removeEventListener('gattserverdisconnected',this.disconnected);
    if(owners.get(this.device)===this){this.device.gatt?.disconnect();owners.delete(this.device);} // Never disconnect a newer session using this device.
    try{this.input?.close();}catch{}this.input=null;
    this.fromRadio=null;this.fromNum=null;this.readable=null;this.writable=null;
  }
}
