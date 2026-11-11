import {describe,expect,it} from 'vitest';
import {appendChannelMessage,channelMessageStatus,channelText,channelSignature,emptyNativeChannels,normalizeNativeChannels,syncNativeChannels,channelEncryption,visibleNativeChannels,nativeChannelToken,removeNativeMessages,nativeMessageKey,mergeNativeHistory,nativeHistoryLimit,type ChannelMessage} from './native-channels';
import {inlineMessageLinks} from '$lib/chat/message-links';
import {bytesField,fields,numberField,TEXT_MESSAGE_APP,toChannelTextPacket,toRadioPacket} from './meshtastic-wire';
import type {RadioSnapshot} from './serial-radio';
const snapshot=(node=100,index=0,key=1):RadioSnapshot=>({node,firmware:'test',profile:{region:9,preset:0,slot:2,primary:''},channels:[{index,name:'City',psk:new Uint8Array([key]),role:1,uplink:false,downlink:false,aead:false}]});
const message=(id=1,from=200,timestamp=id):ChannelMessage=>({id,from,name:'🐰',text:'hello',timestamp,outgoing:false,status:'accepted'});

describe('native Meshtastic channel isolation',()=>{
  it('uses standard text broadcasts without changing directed private messages or requesting MQTT upload',()=>{
    const packet=fields(bytesField(fields(toChannelTextPacket(1,0xfffffffe,'Привет')),1)),data=fields(bytesField(packet,4));
    expect(numberField(packet,2)).toBe(0xffffffff);expect(numberField(packet,3)).toBe(1);expect(numberField(packet,6)).toBe(0xfffffffe);
    expect(numberField(data,1)).toBe(TEXT_MESSAGE_APP);expect(new TextDecoder().decode(bytesField(data,2))).toBe('Привет');
    expect(data.has(9)).toBe(true);expect(numberField(data,9)).toBe(0);expect(numberField(packet,10)).toBe(1);expect(packet.has(9)).toBe(false);
    expect(()=>toRadioPacket(0xffffffff,1,7,new Uint8Array([1]))).toThrow();
    expect(()=>toChannelTextPacket(8,1,'hello')).toThrow();expect(()=>toChannelTextPacket(1,0,'hello')).toThrow();
  });
  it('counts UTF-8 including the optional signature and uses the supplied current-origin link',()=>{
    expect(channelText(' Привет ',false,'https://current.test/contact')).toBe('Привет');
    expect(channelText('Привет',true,'https://current.test/contact')).toBe('Привет\n[Automesh](https://current.test/contact)');
    const link='http://[::1]:5174/#/contact/mesh-test';
    expect(inlineMessageLinks(channelSignature(link))).toEqual([{text:'Automesh',href:link,secure:false}]);
    expect(channelSignature('https://current.test/a(b)')).toBe('[Automesh](https://current.test/a%28b%29)');
    const suffix='\n'+channelSignature('https://current.test/contact'),remaining=200-new TextEncoder().encode(suffix).length;
    expect(new TextEncoder().encode(channelText('a'.repeat(remaining),true,'https://current.test/contact'))).toHaveLength(200);
    expect(()=>channelText('a'.repeat(remaining+1),true,'https://current.test/contact')).toThrow('meshtastic_text_too_large');
    expect(channelText('я'.repeat(100),false,'')).toHaveLength(100);
    expect(()=>channelText('я'.repeat(101),false,'')).toThrow('meshtastic_text_too_large');
    expect(()=>channelText('я'.repeat(100),true,'https://current.test/contact')).toThrow();
    expect(()=>channelText(' ',true,'https://current.test/contact')).toThrow('meshtastic_empty_text');
  });
  it('keeps history by board and channel fingerprint, not local slot, and never stores the channel PSK',async()=>{
    let data=await syncNativeChannels(emptyNativeChannels(),snapshot());const key=data.channels[0].key;
    expect(data.enabled).toBe(true);expect(data.channels[0].signature).toBe(false);
    data=appendChannelMessage(data,key,100,message());
    data=await syncNativeChannels(data,snapshot(100,2));expect(data.channels).toHaveLength(1);expect(data.channels[0]).toMatchObject({index:2,unread:1});
    data=await syncNativeChannels(data,snapshot(300,2));expect(data.channels).toHaveLength(2);expect(data.channels[1].messages).toEqual([]);
    data=await syncNativeChannels(data,snapshot(100,2,2));expect(data.channels).toHaveLength(3);expect(data.channels.at(-1)?.messages).toEqual([]);
    expect(JSON.stringify(data)).not.toContain('psk');
  });
  it('deduplicates radio echoes, keeps chronological history and bounds unread/history',async()=>{
    let data=await syncNativeChannels(emptyNativeChannels(),snapshot());const key=data.channels[0].key;
    data=appendChannelMessage(data,key,100,message(3));data=appendChannelMessage(data,key,100,message(1));data=appendChannelMessage(data,key,100,message(3));
    expect(data.channels[0].messages.map(m=>m.id)).toEqual([1,3]);expect(data.channels[0].unread).toBe(2);
    data=appendChannelMessage(data,key,100,message(4),true);expect(data.channels[0].unread).toBe(0);
    for(let i=5;i<120;i++)data=appendChannelMessage(data,key,100,message(i));
    expect(data.channels[0].messages).toHaveLength(100);expect(data.channels[0].unread).toBe(100);
  });
  it('does not resume a broadcast after reload or downgrade an accepted local echo on a late timeout',async()=>{
    let data=await syncNativeChannels(emptyNativeChannels(),snapshot());const key=data.channels[0].key;
    data=appendChannelMessage(data,key,100,{...message(1,100),outgoing:true,status:'queued'});
    expect(normalizeNativeChannels(data).channels[0].messages[0].status).toBe('unknown');
    data=channelMessageStatus(data,key,100,1,'accepted');data=channelMessageStatus(data,key,100,1,'failed');
    expect(data.channels[0].messages[0].status).toBe('accepted');
    data=channelMessageStatus(data,key,100,1,'failed',{source:'routing',code:5});expect(data.channels[0].messages[0].failure?.code).toBe(5);
    data=channelMessageStatus(data,key,100,1,'accepted');expect(data.channels[0].messages[0].status).toBe('failed');
    data=channelMessageStatus(data,key,100,1,'mesh');data=channelMessageStatus(data,key,100,1,'failed',{source:'routing',code:3});
    expect(data.channels[0].messages[0].status).toBe('mesh');expect(data.channels[0].messages[0].failure).toBeUndefined();
    expect(normalizeNativeChannels(data).channels[0].messages[0].status).toBe('mesh');
    const malformed=structuredClone(data);malformed.channels[0].messages.push({...message(2),text:'a'.repeat(513)});
    expect(normalizeNativeChannels(malformed).channels[0].messages).toHaveLength(1);
  });
});


describe('Meshtastic chat usability boundaries',()=>{
  it('opts in on a fresh board, but remembers an explicit opt out across reloads',()=>{
    expect(emptyNativeChannels().enabled).toBe(true);
    expect(normalizeNativeChannels({enabled:false,channels:[]}).enabled).toBe(true);
    expect(normalizeNativeChannels({enabled:false,configured:true,channels:[]}).enabled).toBe(false);
  });
  it('filters by the live board and hides empty saved channels from other boards',async()=>{
    let state=await syncNativeChannels(emptyNativeChannels(),snapshot(100));
    state=appendChannelMessage(state,state.channels[0].key,100,message());
    state=await syncNativeChannels(state,snapshot(200));
    state=await syncNativeChannels(state,snapshot(300));
    const live=[nativeChannelToken(state.channels[1])];
    expect(visibleNativeChannels(state,200,live).map(c=>c.node)).toEqual([200]);
    expect(visibleNativeChannels({...state,showAll:true},200,live).map(c=>c.node)).toEqual([100,200]);
    expect(visibleNativeChannels({...state,enabled:false},200,live)).toEqual([]);
    expect(visibleNativeChannels(state,undefined,[]).map(c=>c.node)).toEqual([100]);
    expect(visibleNativeChannels(state,200,live,'missing')).toEqual([]);
  });
  it('distinguishes no crypto, public default variants, expanded default keys and custom keys without persisting secrets',()=>{
    expect(channelEncryption({psk:new Uint8Array()})).toBe('none');
    expect(channelEncryption({psk:new Uint8Array([0])})).toBe('none');
    expect(channelEncryption({psk:new Uint8Array([1])})).toBe('default');
    expect(channelEncryption({psk:new Uint8Array([10])})).toBe('default');
    const expanded=Uint8Array.from([0xd4,0xf1,0xbb,0x3a,0x20,0x29,0x07,0x59,0xf0,0xbc,0xff,0xab,0xcf,0x4e,0x69,0x01]);
    expect(channelEncryption({psk:expanded})).toBe('default');expanded[15]=10;expect(channelEncryption({psk:expanded})).toBe('default');
    expect(channelEncryption({psk:new Uint8Array(32).fill(5)})).toBe('custom');
  });
  it('encodes native reply IDs in Data field 7 without transmitting a quoted body',()=>{
    const packet=fields(bytesField(fields(toChannelTextPacket(1,123,'answer',0xffffffff)),1)),data=fields(bytesField(packet,4));
    expect(numberField(data,7)).toBe(0xffffffff);expect(new TextDecoder().decode(bytesField(data,2))).toBe('answer');
    expect(numberField(data,9)).toBe(0);expect(()=>toChannelTextPacket(1,123,'answer',-1)).toThrow();
  });
  it('persists per-channel drafts, replies and retention, never restoring an in-flight send',async()=>{
    let state=await syncNativeChannels(emptyNativeChannels(),snapshot());state.historyLimit=500;
    state.channels[0]={...state.channels[0],draft:'unfinished',replyId:0xffffffff};
    for(let i=1;i<=150;i++)state=appendChannelMessage(state,state.channels[0].key,100,{...message(i),replyId:5,retryOf:2});
    const restored=normalizeNativeChannels(state);expect(restored.channels[0].draft).toBe('unfinished');expect(restored.channels[0].replyId).toBe(0xffffffff);
    expect(restored.channels[0].messages).toHaveLength(150);expect(restored.channels[0].messages[0]).toMatchObject({replyId:5,retryOf:2});
    expect(nativeHistoryLimit(999999)).toBe(100);
  });
  it('local deletion does not resurrect on replay and a failed write merges concurrent arrivals',async()=>{
    let state=await syncNativeChannels(emptyNativeChannels(),snapshot());const key=state.channels[0].key;
    state=appendChannelMessage(state,key,100,message(1));state=appendChannelMessage(state,key,100,message(2));
    const before=state.channels[0];state=removeNativeMessages(state,before,[nativeMessageKey(message(1))]);
    expect(state.channels[0].unread).toBe(1);
    state=appendChannelMessage(state,key,100,message(1));expect(state.channels[0].messages.map(m=>m.id)).toEqual([2]);
    expect(normalizeNativeChannels(state).channels[0].deleted).toEqual(['200:1']);
    state=appendChannelMessage(state,key,100,message(3));
    const rollback={...state.channels[0],deleted:[]};
    expect(mergeNativeHistory(before,rollback,100).map(m=>m.id)).toEqual([1,2,3]);
  });
});
