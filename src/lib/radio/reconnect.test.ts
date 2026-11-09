import {describe,it,expect} from 'vitest';
import {rememberedPort,rememberedChannel,preferredConnection} from './reconnect';
import {emptyRadioState,normalizeRadioState,rememberBoard,forgetBoard} from './account-state';
import {networkInvite,networkId,type RadioChannel} from './network';
import type {SerialPortLike,RadioSnapshot} from './serial-radio';
const p={region:9,preset:0,slot:2,primary:'LongFast'};
const publicChannel:RadioChannel={index:0,name:'',psk:new Uint8Array([1]),role:1,uplink:false,downlink:false,aead:false};
const privateChannel:RadioChannel={...publicChannel,index:1,name:'MyDevices',psk:new Uint8Array(32).fill(7),role:2};
const snapshot:RadioSnapshot={node:100,firmware:'2.8.0',profile:p,channels:[publicChannel,privateChannel]};
describe('remembered radio hardware',()=>{
 it('selects only a remembered or unambiguous granted port, never guesses between identical boards',()=>{
  const a={} as SerialPortLike,b={} as SerialPortLike;
  expect(rememberedPort([a,b],b)).toBe(b);expect(rememberedPort([a])).toBe(a);
  expect(()=>rememberedPort([a,b])).toThrow('radio_port_ambiguous');expect(()=>rememberedPort([])).toThrow('radio_port_missing');
 });
 it('restores the private network before opening account crypto, even when local channel indices change',async()=>{
  const network=await networkId(networkInvite(p,privateChannel)),state={...emptyRadioState(),connection:{node:100,network,channel:1}};
  expect(await rememberedChannel(snapshot,state,true)).toBe(1);
  expect(await rememberedChannel({...snapshot,channels:[publicChannel,{...privateChannel,index:3}]},state,true)).toBe(3);
  await expect(rememberedChannel({...snapshot,node:101},state,true)).rejects.toThrow('radio_wrong_board');
  await expect(rememberedChannel({...snapshot,channels:[publicChannel]},state,true)).rejects.toThrow('radio_channel_changed');
  expect(state.connection.network).toBe(network);
 });
 it('makes the first board default, preserves its name, changes default explicitly, and forgets without destroying keys or pending data',()=>{
  const board={node:100,network:'a'.repeat(64),channel:1,name:'Home',firmware:'2.8.0',lastSeen:1};
  let state=rememberBoard(emptyRadioState(),board);state=rememberBoard(state,{...board,node:200,name:'Travel'});
  expect(state.defaultNode).toBe(100);expect(preferredConnection(state)?.node).toBe(100);
  state=rememberBoard(state,{...board,name:'Auto-generated',lastSeen:2});expect(state.boards?.[0].name).toBe('Home');
  state={...state,defaultNode:200,reconnect:true,preferredPeers:[]};
  const restored=normalizeRadioState(JSON.parse(JSON.stringify(state)));expect(preferredConnection(restored)?.node).toBe(200);expect(restored.reconnect).toBe(true);
  const forgotten=forgetBoard(restored,200);expect(forgotten.defaultNode).toBe(100);expect(forgotten.pending).toEqual(restored.pending);
 });
});
