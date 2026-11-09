import { afterEach, describe, expect, it, vi } from 'vitest';
import { BluetoothRadioPort, MESHTASTIC_BLE, type BleCharacteristic, type BleDevice } from './bluetooth-port';
import { SerialRadio } from './serial-radio';
import { binary, bytesField, concat, fields, fixed, numberField, uint } from './meshtastic-wire';
const wait=async(check:()=>boolean)=>{for(let i=0;i<1000;i++){if(check())return;await new Promise(r=>setTimeout(r,1));}throw Error('timeout');};
function fixture(id='ble-100',node=100){
  const replies:Uint8Array[]=[],writes:Uint8Array[]=[],listeners=new Map<string,Set<()=>void>>();let inProgress=false,maxInProgress=0,active=0;
  const delay=async()=>{active++;maxInProgress=Math.max(maxInProgress,active);if(inProgress)throw Error('Concurrent GATT');inProgress=true;await new Promise(r=>setTimeout(r,1));inProgress=false;active--;};
  const notify=()=>listeners.get('characteristicvaluechanged')?.forEach(fn=>fn());
  const base=():BleCharacteristic=>({readValue:async()=>new DataView(new ArrayBuffer(0)),startNotifications:async()=>{},addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type)!.add(fn);},removeEventListener:(type,fn)=>{listeners.get(type)?.delete(fn);}});
  const num=base(),from=base(),to=base();
  from.readValue=async()=>{await delay();const bytes=replies.shift()??new Uint8Array();return new DataView(bytes.buffer,bytes.byteOffset,bytes.length);};
  to.writeValueWithResponse=async bytes=>{await delay();writes.push(bytes.slice());const request=fields(bytes);
    if(request.has(3)){
      const channelSettings=binary(2,new Uint8Array([1]));
      replies.push(binary(3,uint(1,node)),binary(4,concat(uint(1,node),binary(2,concat(binary(2,new TextEncoder().encode('🐰 Radio')),binary(3,new TextEncoder().encode('🐰')))))),binary(13,binary(1,new TextEncoder().encode('ble-fixture'))),
        binary(5,binary(6,concat(uint(1,1),uint(7,9),uint(9,1),uint(11,2)))),
        binary(10,concat(uint(1,0),uint(3,1),binary(2,channelSettings))),uint(7,numberField(request,3)));
    }else if(request.has(1)){const packet=fields(bytesField(request,1));replies.push(binary(11,concat(uint(1,0),uint(4,numberField(packet,6)))));}
    notify();
  };
  const chars:Record<string,BleCharacteristic>={[MESHTASTIC_BLE.toRadio]:to,[MESHTASTIC_BLE.fromRadio]:from,[MESHTASTIC_BLE.fromNum]:num};
  const device:BleDevice={id,gatt:{connected:false,connect:async()=>{device.gatt!.connected=true;return{getPrimaryService:async uuid=>{expect(uuid).toBe(MESHTASTIC_BLE.service);return{getCharacteristic:async uuid=>chars[uuid]};}};},disconnect:()=>{device.gatt!.connected=false;listeners.get('gattserverdisconnected')?.forEach(fn=>fn());}},
    addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type)!.add(fn);},removeEventListener:(type,fn)=>{listeners.get(type)?.delete(fn);}};
  return{device,writes,replies,notify,listeners,from,num,to,get maxInProgress(){return maxInProgress;},disconnect(){device.gatt!.connected=false;listeners.get('gattserverdisconnected')?.forEach(fn=>fn());}};
}
afterEach(()=>vi.unstubAllGlobals());
describe('Meshtastic Bluetooth PhoneAPI',()=>{
  it('reports native broadcast firmware ACK/NAK, ignores remote ACK claims and handles queue result 35 without calling it delivery',async()=>{
    const f=fixture(),radio=new SerialRadio(),statuses:unknown[]=[];
    radio.onChannelStatus=s=>statuses.push(s);
    const ack=(from:number,id:number,reason=0,discovery=false)=>binary(2,concat(fixed(1,from),fixed(2,100),binary(4,concat(uint(1,5),fixed(6,id),binary(2,discovery?binary(1,new Uint8Array()):uint(3,reason))))));
    try{
      await radio.open(new BluetoothRadioPort(f.device));await radio.sendChannelText(0,123,'native');
      expect(statuses).toEqual([{id:123,channel:0,status:'accepted'}]);
      f.replies.push(ack(200,123),ack(100,999),ack(100,123,0,true),ack(100,123,5),ack(100,123));f.notify();
      await wait(()=>statuses.length===3);
      expect(statuses.slice(1)).toEqual([{id:123,channel:0,status:'failed',failure:{source:'routing',code:5}},{id:123,channel:0,status:'mesh'}]);
      f.to.writeValueWithResponse=async bytes=>{const request=fields(bytes),p=fields(bytesField(request,1));f.replies.push(binary(11,concat(uint(1,35),uint(4,numberField(p,6)))));f.notify();};
      await radio.sendChannelText(0,124,'local only');expect(statuses.at(-1)).toEqual({id:124,channel:0,status:'accepted'});
    }finally{await radio.close();}
  });
  it('sends native text through the local board and separates broadcasts from private messages, MQTT and malformed text',async()=>{
    const f=fixture(),radio=new SerialRadio(),channelTexts:unknown[]=[],privatePackets:unknown[]=[];
    radio.onChannelText=p=>channelTexts.push(p);radio.onPacket=p=>privatePackets.push(p);
    const incoming=(to:number,payload:Uint8Array,extra=new Uint8Array())=>binary(2,concat(fixed(1,200),fixed(2,to),fixed(6,55),extra,binary(4,concat(uint(1,1),binary(2,payload)))));
    try{
      await radio.open(new BluetoothRadioPort(f.device));await radio.sendChannelText(0,123,'hello city');
      const request=f.writes.map(b=>fields(b)).find(v=>v.has(1))!,packet=fields(bytesField(request,1));
      expect(numberField(packet,2)).toBe(0xffffffff);expect(numberField(packet,6)).toBe(123);
      const text=new TextEncoder().encode('Город');
      f.replies.push(binary(4,concat(uint(1,200),binary(2,binary(2,new TextEncoder().encode('🌲'))))),
        incoming(100,text),incoming(0xffffffff,text,uint(14,1)),incoming(0xffffffff,new Uint8Array([0xff])),incoming(0xffffffff,text));f.notify();
      await wait(()=>channelTexts.length===1);
      expect(channelTexts[0]).toMatchObject({id:55,from:200,channel:0,name:'🌲',text:'Город'});expect(privatePackets).toEqual([]);expect(radio.ready).toBe(true);
      await expect(radio.sendChannelText(7,124,'wrong slot')).rejects.toThrow('radio_not_ready');
    }finally{await radio.close();}
  });
  it('does not reuse an old configuration when a new check receives only its completion marker',async()=>{
    const f=fixture(),radio=new SerialRadio();
    try{
      await radio.open(new BluetoothRadioPort(f.device));
      f.to.writeValueWithResponse=async bytes=>{const request=fields(bytes);if(request.has(3)){f.replies.push(uint(7,numberField(request,3)));f.notify();}};
      await expect(radio.check()).rejects.toThrow('radio_incomplete_config');
    }finally{await radio.close();}
  });
  it('does not read an empty device queue before requesting configuration',async()=>{
    const f=fixture(),read=f.from.readValue,radio=new SerialRadio();let earlyReads=0;
    f.from.readValue=async()=>{if(!f.writes.length)earlyReads++;return read();};
    // Some browsers fire an initial notification as soon as subscribing.
    f.num.startNotifications=async()=>{f.notify();};
    try{await radio.open(new BluetoothRadioPort(f.device));expect(earlyReads).toBe(0);}finally{await radio.close();}
  });
  it('renews suspended notifications and checks local GATT on wake without transmitting RF or configuration',async()=>{
    const f=fixture(),radio=new SerialRadio(),notifications=vi.spyOn(f.num,'startNotifications');
    const health=vi.spyOn(f.num,'readValue');const state:boolean[]=[];radio.onConnection=value=>state.push(value);
    try {
      await radio.open(new BluetoothRadioPort(f.device));const before=f.writes.length;
      await radio.resume();expect(health).toHaveBeenCalledTimes(1);expect(notifications).toHaveBeenCalledTimes(2);
      expect(f.writes).toHaveLength(before);expect(radio.ready).toBe(true);
      f.num.readValue=async()=>{throw Error('stale iOS characteristic');};
      await expect(radio.resume()).rejects.toThrow();await wait(()=>state.at(-1)===false);
      expect(radio.ready).toBe(false);
    }finally{await radio.close();}
  });
  it('keeps two Bluetooth boards independent and restores the same named board after disconnection',async()=>{
    const a=fixture('a',100),b=fixture('b',200),ar=new SerialRadio(),br=new SerialRadio();a.device.name='🐰';b.device.name='🌲';
    try{
      const ap=new BluetoothRadioPort(a.device),bp=new BluetoothRadioPort(b.device);
      await Promise.all([ar.open(ap),br.open(bp)]);expect(ap.deviceName).toBe('🐰');expect(bp.deviceName).toBe('🌲');
      await Promise.all([ar.send(200,0,new Uint8Array([1])),br.send(100,0,new Uint8Array([2]))]);
      a.disconnect();await wait(()=>!ar.ready);expect(br.ready).toBe(true);await ar.close();
      await ar.open(new BluetoothRadioPort(a.device));expect(ar.ready).toBe(true);expect(br.ready).toBe(true);
      expect(a.maxInProgress).toBe(1);expect(b.maxInProgress).toBe(1);
    }finally{await Promise.all([ar.close(),br.close()]);}
  });
  it('uses the same config, sending and receive codec as USB, with whole GATT protobufs and serialised operations',async()=>{
    const f=fixture(),port=new BluetoothRadioPort(f.device),radio=new SerialRadio();const packets:unknown[]=[],heard:unknown[]=[];
    radio.onPacket=p=>packets.push(p);radio.onHeard=(node,at)=>heard.push([node,at]);
    try{const snapshot=await radio.open(port);expect(snapshot.node).toBe(100);expect(snapshot.name).toBe('🐰 Radio');expect(snapshot.shortName).toBe('🐰');expect(snapshot.firmware).toBe('ble-fixture');expect(port.transport).toBe('bluetooth');
      await radio.send(200,0,new Uint8Array([1]));expect(fields(f.writes[0]).has(3)).toBe(true);expect(f.writes[0][0]).not.toBe(0x94);
      const rssi=new Uint8Array([0x60,0xa6,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x01]);
      f.replies.push(binary(2,concat(fixed(1,200),fixed(2,100),rssi,uint(15,2),uint(9,1),binary(4,concat(uint(1,256),binary(2,new Uint8Array([3])))))));f.notify();
      await wait(()=>packets.length===1);expect(packets[0]).toMatchObject({from:200,reception:{rssi:-90,hops:1}});expect(heard).toHaveLength(1);
      expect(f.maxInProgress).toBe(1);await radio.check();expect(f.maxInProgress).toBe(1);
    }finally{await radio.close();}expect(f.device.gatt!.connected).toBe(false);expect(f.listeners.get('characteristicvaluechanged')?.size).toBe(0);
  });
  it('recovers a missed notification by reading only the local GATT queue, and reports disconnection',async()=>{
    const f=fixture(),port=new BluetoothRadioPort(f.device),radio=new SerialRadio(),errors:string[]=[],packets:unknown[]=[];
    radio.onError=e=>errors.push(e);radio.onPacket=p=>packets.push(p);
    try{await radio.open(port);await new Promise(r=>setTimeout(r,20));const count=f.writes.length;
      f.replies.push(binary(2,concat(fixed(1,200),fixed(2,100),binary(4,concat(uint(1,256),binary(2,new Uint8Array([3])))))));
      await wait(()=>packets.length===1);expect(f.writes).toHaveLength(count);
      f.disconnect();await wait(()=>errors.includes('radio_bluetooth_disconnected'));
    }finally{await radio.close();}
  });
  it('reselects only the exact saved permitted device and never opens a picker during recovery',async()=>{
    const a=fixture('a'),b=fixture('b');const requestDevice=vi.fn(async()=>a.device);
    vi.stubGlobal('navigator',{bluetooth:{requestDevice,getDevices:async()=>[a.device,b.device]}});
    expect(BluetoothRadioPort.supported()).toBe(true);expect((await BluetoothRadioPort.remembered('b')).deviceId).toBe('b');expect(requestDevice).not.toHaveBeenCalled();
    await expect(BluetoothRadioPort.remembered('missing')).rejects.toThrow('radio_bluetooth_permission');
    await BluetoothRadioPort.requestPort();expect(requestDevice).toHaveBeenCalledWith({filters:[{services:[MESHTASTIC_BLE.service]}]});
    vi.stubGlobal('navigator',{});expect(BluetoothRadioPort.supported()).toBe(false);await expect(BluetoothRadioPort.requestPort()).rejects.toThrow('radio_bluetooth_unsupported');
  });
  it('closes a disconnected adapter and reacquires fresh GATT objects on the next connection',async()=>{
    const f=fixture(),port=new BluetoothRadioPort(f.device),radio=new SerialRadio();
    try {await radio.open(port);await radio.close();await radio.open(port);expect((await radio.check()).node).toBe(100);}finally{await radio.close();}
  });
});

it('does not let closing an old Bluetooth session disconnect a newer session using the same board',async()=>{
  const f=fixture(),old=new BluetoothRadioPort(f.device),current=new BluetoothRadioPort(f.device),a=new SerialRadio(),b=new SerialRadio();
  try {await a.open(old);await a.close();await b.open(current);await old.close();expect(f.device.gatt!.connected).toBe(true);expect((await b.check()).node).toBe(100);}
  finally{await a.close();await b.close();}
});
it('cancels a delayed Bluetooth connection on lock before discovering or writing configuration',async()=>{
  const f=fixture();let release!:(value:Awaited<ReturnType<NonNullable<BleDevice['gatt']>['connect']>>)=>void;
  let connecting=false;const original=f.device.gatt!.connect;
  f.device.gatt!.connect=()=>{connecting=true;return new Promise(resolve=>release=resolve);};
  const port=new BluetoothRadioPort(f.device),radio=new SerialRadio(),opening=radio.open(port);const rejected=expect(opening).rejects.toThrow('radio_closed');
  await wait(()=>connecting);await radio.close();release(await original());await rejected;
  expect(f.writes).toEqual([]);expect(f.device.gatt!.connected).toBe(false);
});
