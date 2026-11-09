import { describe, expect, it } from 'vitest';
import { receiveRouting, receptionChannel, receptionFailure } from './receive-routing';
import { emptyCourierState } from './courier-state';
const base=[{url:'wss://chat.example/signal',kind:'internet' as const}];
const state={...emptyCourierState(),enabled:true,node:{url:'https://node.example',nodeId:'a'.repeat(32),address:'courier'}};
describe('delivery receive route policy',()=>{
  it('pins a configured delivery node independently of reserve and peer availability',()=>{
    const r=receiveRouting(base,{quickReserve:false,nodes:[]},'https://automesh.space/',state);
    expect(r.required).toEqual(['wss://node.example/signal']);expect(r.endpoints.map(e=>e.url)).toEqual([...r.required,base[0].url]);
    expect(receptionChannel(r.required,[{url:base[0].url,kind:'internet',status:'connected',error:'',alias:false}])).toBe('Восстанавливаем подключение');
    expect(receptionChannel(r.required,[{url:r.required[0],kind:'internet',status:'connected',error:'',alias:false}])).toBe('Подключён');
  });
  it('never bypasses disabled signaling, LAN-only or an explicitly disabled endpoint',()=>{
    for(const policy of [{signalingEnabled:false as const},{internetEnabled:false as const},{internetNodes:[{url:'wss://node.example/signal',name:'Node',enabled:false}]}]){
      const r=receiveRouting(base,{quickReserve:false,nodes:[],...policy},'https://automesh.space/',state);expect(r.required).toEqual([]);
    }
  });
  it('keeps reception for outstanding keys when new outgoing work is disabled',()=>{
    const r=receiveRouting(base,{quickReserve:false,nodes:[]},'https://automesh.space/',{...state,enabled:false,keys:[{} as never]});expect(r.required).toHaveLength(1);
    expect(receiveRouting(base,{quickReserve:false,nodes:[]},'https://automesh.space/',emptyCourierState()).required).toEqual([]);
  });
  it('only considers an aliased endpoint connected while that same registry has a live registration',()=>{
    const alias={url:'wss://node.example/signal',kind:'internet' as const,status:'idle' as const,error:'',alias:true,registryId:'a'.repeat(32)};
    expect(receptionChannel([alias.url],[alias])).toBe('Восстанавливаем подключение');
    expect(receptionChannel([alias.url],[alias,{url:base[0].url,kind:'internet',status:'connected',error:'',alias:false,registryId:alias.registryId}])).toBe('Подключён');
  });
  it('orders server delivery first, application second and home LAN last, without duplicates',()=>{
    const settings={quickReserve:true,nodes:[{url:'wss://192.168.1.10/signal',name:'Home',enabled:true}],
      internetNodes:[{url:'wss://other.example/signal',name:'Other',enabled:true},{url:'wss://node.example/signal',name:'Node',enabled:true}]};
    const r=receiveRouting(base,settings,'https://automesh.space/',state);
    expect(r.endpoints.map(n=>n.url)).toEqual(['wss://node.example/signal',base[0].url,'wss://other.example/signal','wss://192.168.1.10/signal']);
    expect(settings.internetNodes[0].url).toBe('wss://other.example/signal');
    expect(receiveRouting(base,{...settings,quickReserve:false},'https://automesh.space/',state)).toEqual(r);
    expect(receiveRouting([{url:'wss://node.example/signal',kind:'internet'}],settings,'https://automesh.space/',state).endpoints.filter(n=>n.url===r.required[0])).toHaveLength(1);
  });
  it('pins a home node for reception but does not prioritize it over the application internet route',()=>{
    const r=receiveRouting(base,{quickReserve:false,nodes:[]},'https://automesh.space/',{...state,node:{...state.node,url:'https://192.168.1.10'}});
    expect(r.endpoints.map(n=>n.url)).toEqual([base[0].url,'wss://192.168.1.10/signal']);
    expect(r.required).toEqual(['wss://192.168.1.10/signal']);
  });
  it('sanitizes channel refusals and clears them when the same registry is connected',()=>{
    const url='wss://node.example/signal';
    const offline={url,kind:'internet' as const,status:'offline' as const,alias:false,error:'secret-text-token'};
    expect(receptionFailure([url],[offline])).not.toContain(offline.error);
    expect(receptionFailure([url],[{...offline,status:'error',error:'signaling_registration_rejected'}])).toContain('отказал');
    expect(receptionFailure([url],[{...offline,status:'connected'}])).toBe('');
    expect(receptionFailure([url],[{...offline,status:'connecting'}])).toBe('');
    expect(receptionFailure([url],[{...offline,alias:true,registryId:'same'},
      {url:base[0].url,kind:'internet',status:'connected',error:'',alias:false,registryId:'same'}])).toBe('');
  });
});
