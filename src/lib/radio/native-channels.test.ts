import {describe,expect,it} from 'vitest';
import {appendChannelMessage,channelMessageStatus,channelText,channelSignature,emptyNativeChannels,normalizeNativeChannels,syncNativeChannels,type ChannelMessage} from './native-channels';
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
    expect(data.enabled).toBe(false);expect(data.channels[0].signature).toBe(false);
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
