import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { packetReception, weakestReception, normalizeRadioReception, radioQuality, radioRecentlyHeard, recordRadioHeard } from './reception';
import { fields, concat, fixed, uint } from './meshtastic-wire';
import { emptyRadioState, normalizeRadioState, rememberBoard } from './account-state';
import RadioReception from './RadioReception.svelte';
import RadioPresence from './RadioPresence.svelte';
const float=(field:number,value:number)=>{const raw=new Uint8Array(5);raw[0]=field*8+5;new DataView(raw.buffer).setFloat32(1,value,true);return raw;};
const rssi=new Uint8Array([0x60,0xa6,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x01]);
describe('passive radio observations',()=>{
  it('decodes real wire metrics, computes retransmissions and preserves old reception time instead of inventing presence',()=>{
    const now=1000000,packet=fields(concat(rssi,float(8,-8.25),uint(15,3),uint(9,1),fixed(7,700)));
    expect(packetReception(packet,now)).toEqual({rssi:-90,snr:-8.25,hops:2,receivedAt:700000});
    expect(packetReception(fields(concat(rssi,uint(9,0))),now)?.hops).toBeUndefined();
    expect(packetReception(fields(concat(rssi,uint(14,1))),now)).toBeUndefined();
    expect(packetReception(fields(uint(15,1)),now)).toBeUndefined();
    expect(packetReception(fields(concat(rssi,uint(15,1),uint(9,1))),now)?.hops).toBe(0);
  });
  it('uses a conservative reception summary for fragmented messages and validates persisted metrics',()=>{
    const a={rssi:-70,snr:8,hops:0,receivedAt:100},b={rssi:-115,snr:-12,hops:2,receivedAt:120};
    expect(weakestReception(a,b)).toEqual({rssi:-115,snr:-12,hops:2,receivedAt:100});
    expect(normalizeRadioReception({...b,secret:'hidden'})).toEqual(b);
    expect(normalizeRadioReception({...b,rssi:Infinity,snr:1000,hops:99})).toEqual({receivedAt:120});
    expect(normalizeRadioReception({receivedAt:-1})).toBeUndefined();
  });
  it('maps received signal to five approximate labels and never fabricates missing measurements',()=>{
    expect([-20,-10,-3,2,8].map(snr=>radioQuality({receivedAt:1,snr})?.level)).toEqual([1,2,3,4,5]);
    expect(radioQuality({receivedAt:1})).toBeUndefined();
    expect(radioQuality({receivedAt:1,rssi:-90})?.label).toBe('Хорошо');
  });
  it('shows no rabbit for direct/unknown hops, and provides raw metrics in expandable details',()=>{
    const direct=render(RadioReception,{props:{reception:{receivedAt:1,rssi:-90,snr:2,hops:0}}}).body;
    expect(direct).not.toContain('🐇');expect(direct).toContain('RSSI: -90');expect(direct).toContain('SNR: 2.0');
    expect(render(RadioReception,{props:{reception:{receivedAt:1,rssi:-90,hops:2}}}).body).toContain('🐇 2');
  });
  it('ages passive presence without probes and bounds the observation table',()=>{
    expect(radioRecentlyHeard(100,100+15*60000-1)).toBe(true);expect(radioRecentlyHeard(100,100+15*60000)).toBe(false);
    expect(radioRecentlyHeard(101,100)).toBe(false);
    const offline=render(RadioPresence,{props:{connected:false,heard:100,now:101}}).body;
    expect(offline).toContain('LoRa отключена');expect(offline).not.toContain('Недавно по LoRa');
    let seen:Record<string,number>={};for(let i=1;i<=300;i++)seen=recordRadioHeard(seen,i,i);
    expect(Object.keys(seen)).toHaveLength(256);expect(seen[1]).toBeUndefined();expect(seen[300]).toBe(300);
    expect(recordRadioHeard(seen,300,1)).toBe(seen);
  });
  it('remembers the Bluetooth choice per board without exporting arbitrary device properties',()=>{
    const board={node:100,network:'a'.repeat(64),channel:1,transport:'bluetooth' as const,deviceId:'chosen-ble',name:'Phone radio',firmware:'fixture',lastSeen:100};
    const state=rememberBoard({...emptyRadioState(),connection:board,reconnect:true},board),normalized=normalizeRadioState({...state,boards:[{...board,secret:'no'}]});
    expect(normalized.connection).toMatchObject({deviceId:'chosen-ble',transport:'bluetooth'});
    expect(normalized.boards?.[0]).toEqual(board);
    expect(normalizeRadioState({...state,connection:{...board,deviceId:'x'.repeat(300)}}).connection?.deviceId).toBeUndefined();
  });
});
