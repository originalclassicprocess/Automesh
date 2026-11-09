import { describe, it, expect } from 'vitest';
import { RadioAccountController, radioEligible, radioFallbackReady } from './account-controller';
import { RadioCrypto } from './crypto';
import { emptyRadioState, normalizeRadioState } from './account-state';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id';
import { emptySessionChats, ensureConversation, setContactState, recordSentMessage, receiveMessage, type ChatEntry } from '$lib/chat/session-chats';
import { normalizeLocalChatData, deriveChatStoreKey, sealChatData, openSealedChatData } from '$lib/chat/local-store';
import { portableChatData } from '$lib/backup/full-backup';
import { selectHistoryData } from '$lib/devices/history-data';
import { OutboxController } from '$lib/application/outbox';
import type { RadioPacket } from './serial-radio';

const network = 'a'.repeat(64);
const pause = () => new Promise(resolve => setTimeout(resolve, 2));
async function until(check:()=>boolean) { for(let i=0;i<500;i++){if(check())return;await pause();} throw Error('test_timeout'); }
async function account(node:number) {
  const signer = new WebCryptoIdentity(); await signer.create(); const address = await accountIdFromPublicKey(await signer.getPublicKeyBytes());
  let state=emptyRadioState(), chats=emptySessionChats(), current=true, write=true, blockedSave:Promise<void>|null=null;
  let receiver: ((p:RadioPacket)=>void)|undefined; const frames:RadioPacket[]=[], errors:string[]=[]; let writes=0;
  const port = {signer,account:address,state:()=>state,setState:(value:typeof state)=>{state=value;},chats:()=>chats,setChats:(value:typeof chats)=>{chats=value;},
    persist:async()=>{writes++;if(blockedSave)await blockedSave;return write;},current:()=>current,nodeReserved:()=>false,error:(code:string)=>errors.push(code),delivered:()=>{}};
  const link={send:async(to:number,channel:number,payload:Uint8Array)=>{const p={from:node,to,channel,payload};frames.push(p);receiver?.(p);}};
  return {signer,address,port,link,frames,errors,node,
    get state(){return state;},get chats(){return chats;},get writes(){return writes;},
    accept(peer:string){chats=setContactState(ensureConversation(chats,peer),peer,'accepted');},
    outgoing(peer:string,text='hello',id:string=crypto.randomUUID()){const message:ChatEntry={id,text,from:address,timestamp:Date.now(),direction:'outgoing',delivery:'queued',radioDelivery:'queued',details:{allowForwardAttribution:true}};chats=recordSentMessage(chats,peer,message);return message;},
    pipe(fn:(p:RadioPacket)=>void){receiver=fn;},failSave(value:boolean){write=!value;},holdSave(value:Promise<void>|null){blockedSave=value;},stop(){current=false;},
    data(){return normalizeLocalChatData({radioState:state,chats:{order:chats.order,byPeer:chats.byPeer}});},
    restore(data:ReturnType<typeof normalizeLocalChatData>){state=normalizeRadioState(data.radioState);},
  };
}
async function pair(gap=0) {
  const a=await account(100), b=await account(200);a.accept(b.address);b.accept(a.address);
  const ac=await RadioAccountController.open(a.port,network,a.node,a.link,0,gap),bc=await RadioAccountController.open(b.port,network,b.node,b.link,0,gap);
  await ac.addRoute(bc.contact);await bc.addRoute(ac.contact);a.pipe(p=>bc.receivePacket(p));b.pipe(p=>ac.receivePacket(p));
  return {a,b,ac,bc,close(){ac.close();bc.close();a.signer.dispose();b.signer.dispose();}};
}
describe('radio account integration',()=>{
  it('serializes native channel broadcasts with personal radio frames and cancels queued work on lock',async()=>{
    const p=await pair();let release!:()=>void;const blocked=new Promise<void>(resolve=>release=resolve),order:string[]=[];
    try{
      const native=p.ac.scheduleChannelSend(async()=>{order.push('native');await blocked;});
      await until(()=>order.length===1);
      const row=p.a.outgoing(p.b.address,'personal beside broadcast'),personal=p.ac.send(p.b.address,row.id);
      await pause();expect(p.a.frames).toHaveLength(0);release();await native;await personal;
      await until(()=>p.a.chats.byPeer[p.b.address].messages.find(m=>m.id===row.id)?.delivery==='delivered');
      p.a.stop();await expect(p.ac.scheduleChannelSend(async()=>{order.push('unexpected');})).rejects.toThrow();
      expect(order).toEqual(['native']);
    }finally{release?.();p.close();}
  });
  it('replaces an old peer key with an accepted fresh contact, including simultaneous acceptance',async()=>{
    const p=await pair();let replacement:RadioAccountController|undefined;
    try{
      p.bc.close();p.b.port.setState({...p.b.state,own:undefined,keys:[]});
      replacement=await RadioAccountController.open(p.b.port,network,p.b.node,p.b.link,0,0);
      expect(replacement.contact).not.toBe(p.bc.contact);
      p.a.pipe(packet=>replacement!.receivePacket(packet));
      await Promise.all([p.ac.addRoute(replacement.contact,true,p.b.address),p.ac.addRoute(replacement.contact,true,p.b.address)]);
      const m=p.a.outgoing(p.b.address,'fresh route');await p.ac.send(p.b.address,m.id);
      await until(()=>p.a.chats.byPeer[p.b.address].messages.find(v=>v.id===m.id)?.delivery==='delivered');
      expect(p.b.chats.byPeer[p.a.address].messages).toHaveLength(1);expect(p.a.errors).toEqual([]);expect(p.b.errors).toEqual([]);
    }finally{replacement?.close();p.close();}
  });
  it('keeps all six chat directions separate across three boards and restores every route after a lock',async()=>{
    const accounts=await Promise.all([account(100),account(200),account(300)]);
    const controllers=new Map<number,RadioAccountController>();
    try {
      for(const a of accounts)for(const b of accounts)if(a!==b)a.accept(b.address);
      for(const a of accounts) {
        controllers.set(a.node,await RadioAccountController.open(a.port,network,a.node,a.link,1,0));
        a.pipe(packet=>controllers.get(packet.to)?.receivePacket(packet));
      }
      for(const a of accounts)for(const b of accounts)if(a!==b)await controllers.get(a.node)!.addRoute(controllers.get(b.node)!.contact);
      const contact=controllers.get(100)!.contact;
      controllers.get(100)!.close();controllers.delete(100);
      // The other two peers both queue work while 100 is unavailable.
      const pending=accounts.slice(1).map(a=>({a,m:a.outgoing(accounts[0].address,`to 100 from ${a.node}`)}));
      for(const {a,m} of pending)await controllers.get(a.node)!.send(accounts[0].address,m.id);
      await until(()=>pending.every(({a,m})=>a.chats.byPeer[accounts[0].address].messages.find(v=>v.id===m.id)?.radioDelivery==='awaiting'));
      controllers.set(100,await RadioAccountController.open(accounts[0].port,network,100,accounts[0].link,1,0));
      expect(controllers.get(100)!.contact).toBe(contact);
      for(const {a,m} of pending)await controllers.get(a.node)!.send(accounts[0].address,m.id);
      const sent:{a:typeof accounts[number];b:typeof accounts[number];m:ChatEntry}[]=[];
      for(const a of accounts)for(const b of accounts)if(a!==b) {
        const m=a.outgoing(b.address,`${a.node} -> ${b.node}`);sent.push({a,b,m});
        await controllers.get(a.node)!.send(b.address,m.id);
      }
      await until(()=>sent.every(({a,b,m})=>a.chats.byPeer[b.address].messages.find(v=>v.id===m.id)?.delivery==='delivered'));
      for(const {a,b,m} of sent)expect(b.chats.byPeer[a.address].messages.find(v=>v.id===m.id)?.text).toBe(m.text);
      for(const a of accounts){expect(a.errors).toEqual([]);expect(a.state.pending).toHaveLength(0);}
    }finally{for(const c of controllers.values())c.close();for(const a of accounts)a.signer.dispose();}
  });
  it('does not allow a chat card to install another account’s route, and repeated acceptance preserves pending transfers',async()=>{
    const p=await pair();try{
      p.a.pipe(()=>{});const message=p.a.outgoing(p.b.address);await p.ac.send(p.b.address,message.id);await until(()=>p.a.frames.length>0);
      const before=p.a.frames.length;await p.ac.addRoute(p.bc.contact,true,p.b.address);
      expect(p.a.state.pending).toHaveLength(1);expect(p.a.frames).toHaveLength(before);
      await expect(p.ac.addRoute(p.bc.contact,true,p.a.address)).rejects.toThrow('radio_wrong_or_expired_peer');
      expect(p.a.state.routes[p.b.address]).toBe(p.bc.contact);
    }finally{p.close();}
  });
  it('uses the real account, common history ID and commit-before-ACK; durable keys reopen the same contact',async()=>{
    const p=await pair();let release!:()=>void;
    try {
      const message=p.a.outgoing(p.b.address);p.b.holdSave(new Promise(resolve=>release=resolve));
      await p.ac.send(p.b.address,message.id);
      await until(()=>p.b.chats.byPeer[p.a.address].messages.length===1);
      expect(p.b.frames).toHaveLength(0);expect(p.a.chats.byPeer[p.b.address].messages[0].delivery).toBe('queued');
      release();p.b.holdSave(null);await until(()=>p.a.chats.byPeer[p.b.address].messages[0].delivery==='delivered');
      expect(p.b.chats.byPeer[p.a.address].messages[0]).toMatchObject({id:message.id,text:'hello',from:p.a.address});
      expect(p.a.state.pending).toHaveLength(0);
      const saved=await p.ac.crypto.save(), restored=await RadioCrypto.restore(p.a.signer,saved);
      expect(restored.contact).toEqual(p.ac.crypto.contact);restored.dispose();
      await expect(RadioCrypto.restore(p.b.signer,saved)).rejects.toThrow('radio_wrong_saved_key');
      await expect(RadioCrypto.restore(p.a.signer,{...saved,privateKey:'1'.repeat(64)})).rejects.toThrow();
    } finally {release?.();p.close();}
  });
  it('keeps ciphertext/keys inside encrypted local data and never transfers them as history or portable backups',async()=>{
    const p=await pair();
    try {
      p.a.pipe(()=>{}); const message=p.a.outgoing(p.b.address);await p.ac.send(p.b.address,message.id);await until(()=>p.a.frames.length>0);
      const data=p.a.data(), key=await deriveChatStoreKey(new Uint8Array(32).fill(2),p.a.address);
      const sealed=await sealChatData(key,p.a.address,data),reopened=await openSealedChatData(key,p.a.address,sealed);
      expect(reopened.radioState?.own?.privateKey).toBe(p.a.state.own?.privateKey);expect(reopened.radioState?.pending[0].id).toBe(message.id);
      expect(reopened.chats.byPeer[p.b.address].messages[0].radioDelivery).toBe('retry');
      expect(portableChatData(data).radioState).toBeUndefined();expect(selectHistoryData(data,[p.b.address]).radioState).toBeUndefined();
      const before=p.a.frames.length;p.ac.close();
      const again=await RadioAccountController.open(p.a.port,network,p.a.node,p.a.link,0,0);
      try {await pause();expect(p.a.frames).toHaveLength(before);await again.resumePending();await until(()=>p.a.frames.length>before);
        // Fragment transfer IDs are fresh; the persisted signed ciphertext is identical.
        expect([...p.a.frames[0].payload.slice(24)]).toEqual([...p.a.frames[before].payload.slice(24)]);
      } finally {again.close();}
    } finally {p.close();}
  });
  it('retries a failed durable receive and acknowledges a persisted duplicate after restart without adding another row',async()=>{
    const p=await pair();
    try {
      p.b.failSave(true);const message=p.a.outgoing(p.b.address);await p.ac.send(p.b.address,message.id);
      await until(()=>p.b.errors.includes('radio_history_not_saved'));expect(p.b.frames).toHaveLength(0);
      p.b.failSave(false);const delivered=p.a.frames.slice();p.bc.close();
      const again=await RadioAccountController.open(p.b.port,network,p.b.node,p.b.link,0,0);
      try {for(const frame of delivered)again.receivePacket(frame);await until(()=>p.b.frames.length>0);
        expect(p.b.chats.byPeer[p.a.address].messages).toHaveLength(1);
        expect(p.b.chats.byPeer[p.a.address].messages[0].id).toBe(message.id);
      } finally {again.close();}
    } finally {p.close();}
  });
  it('refuses conflicting IDs, blocked contacts and node-reserved messages',async()=>{
    const p=await pair();
    try {
      const message=p.a.outgoing(p.b.address);
      p.b.port.setChats(receiveMessage(p.b.chats,{id:message.id,text:'different IP content',from:p.a.address,timestamp:message.timestamp,direction:'incoming'}));
      await p.ac.send(p.b.address,message.id);await until(()=>p.b.errors.includes('radio_message_id_conflict'));expect(p.b.frames).toHaveLength(0);
      p.a.accept(p.b.address);p.a.port.setChats(setContactState(p.a.chats,p.b.address,'blocked'));
      await expect(p.ac.addRoute(p.bc.contact)).rejects.toThrow('radio_contact_not_accepted');
      await expect(p.ac.send(p.b.address,message.id)).rejects.toThrow('radio_message_unavailable');
      p.a.accept(p.b.address);p.a.port.nodeReserved=()=>true;
      await expect(p.ac.send(p.b.address,message.id)).rejects.toThrow('radio_message_unavailable');
    } finally {p.close();}
  });
  it('does not transmit after account closure or a failed outgoing commit; old IP outbox ignores radio-owned work',async()=>{
    const p=await pair();
    try {
      const message=p.a.outgoing(p.b.address);const sent:string[]=[];
      const sender={send:async(text:string)=>{sent.push(text);}};
      p.a.port.setChats({...p.a.chats,byPeer:{...p.a.chats.byPeer,[p.b.address]:{...p.a.chats.byPeer[p.b.address],connection:'connected'}}});
      const outbox=new OutboxController({...p.a.port,state:p.a.port.chats,setState:p.a.port.setChats,sender:()=>sender});
      await outbox.flush(p.b.address,sender);outbox.reset();expect(sent).toHaveLength(0);
      p.a.failSave(true);await expect(p.ac.send(p.b.address,message.id)).rejects.toThrow('radio_history_not_saved');expect(p.a.frames).toHaveLength(0);expect(p.a.state.pending).toHaveLength(0);
      p.a.failSave(false);p.a.stop();await expect(p.ac.send(p.b.address,message.id)).rejects.toThrow('radio_closed');expect(p.a.frames).toHaveLength(0);
    } finally {p.close();}
  });
  it('does not silently strip unsupported message semantics or exceed the radio text budget',()=>{
    const base:ChatEntry={id:crypto.randomUUID(),text:'short',from:'',timestamp:Date.now(),direction:'outgoing',delivery:'queued'};
    expect(radioEligible(base)).toBe(true);
    for(const extra of [{text:'я'.repeat(161)},{details:{ephemeral:{seconds:10,allowDownload:false}}},{deviceMessage:true},{delivery:'stored'},{nodeQueue:'canceled'},{radioSuppressed:true}]) expect(radioEligible({...base,...extra} as ChatEntry)).toBe(false);
  });
  it('keeps each board key so switching back restores the same signed radio contact',async()=>{
    const a=await account(100),first=await RadioAccountController.open(a.port,network,100,a.link,0,0),contact=first.contact;
    first.close();const second=await RadioAccountController.open(a.port,network,200,a.link,0,0);expect(second.contact).not.toBe(contact);second.close();
    const restored=await RadioAccountController.open(a.port,network,100,a.link,0,0);
    try{expect(restored.contact).toBe(contact);expect(a.state.keys).toHaveLength(2);}finally{restored.close();a.signer.dispose();}
  });
  it('resumes unsent radio-owned history even when no ciphertext was prepared before disconnection',async()=>{
    const p=await pair();try{
      const message=p.a.outgoing(p.b.address);expect(p.a.state.pending).toHaveLength(0);
      await p.ac.resumePending();await until(()=>p.a.chats.byPeer[p.b.address].messages.find(m=>m.id===message.id)?.delivery==='delivered');
      expect(p.b.chats.byPeer[p.a.address].messages).toHaveLength(1);
    }finally{p.close();}
  });
  it('keeps direct LAN/IP and node delivery ahead of radio without relying on browser online status',()=>{
    const m:ChatEntry={id:crypto.randomUUID(),text:'hello',from:'',timestamp:1000,direction:'outgoing',delivery:'queued'};
    const ready={accepted:true,directConnected:false,nodeReady:false,nodeReserved:false,hasRoute:true,now:16000};
    expect(radioFallbackReady(m,ready)).toBe(true);
    for(const unavailable of [{directConnected:true},{nodeReady:true},{nodeReserved:true},{hasRoute:false},{accepted:false},{now:15999}]) expect(radioFallbackReady(m,{...ready,...unavailable})).toBe(false);
    expect(radioFallbackReady({...m,radioDelivery:'awaiting'},ready)).toBe(false);
    expect(radioFallbackReady({...m,radioSuppressed:true},ready)).toBe(false);
  });
  it('cancels frames waiting in the shared airtime queue when another path confirms or the user switches delivery',async()=>{
    const p=await pair(40);
    try {const message=p.a.outgoing(p.b.address,'x'.repeat(200));await p.ac.send(p.b.address,message.id);await until(()=>p.a.frames.length===1);
      p.ac.acknowledge(p.b.address,message.id);await new Promise(resolve=>setTimeout(resolve,100));
      expect(p.a.frames).toHaveLength(1);expect(p.b.chats.byPeer[p.a.address].messages).toHaveLength(0);
    } finally {p.close();}
  });
  it('does not transmit after a lock while an outgoing durable write is in progress',async()=>{
    const p=await pair();let release!:()=>void;
    try {const message=p.a.outgoing(p.b.address);p.a.holdSave(new Promise(resolve=>release=resolve));
      const send=p.ac.send(p.b.address,message.id);const rejected=expect(send).rejects.toThrow('radio_closed');
      await until(()=>p.a.state.pending.length===1);p.ac.close();p.a.stop();release();await rejected;expect(p.a.frames).toHaveLength(0);
    } finally {release?.();p.close();}
  });
});

it('releases completed work and supports 64 pending messages consistently across persistence and manual retry',async()=>{
  const p=await pair();
  try {
    for(let i=0;i<20;i++) {const m=p.a.outgoing(p.b.address,`done ${i}`);await p.ac.send(p.b.address,m.id);await until(()=>!p.a.state.pending.some(e=>e.id===m.id));}
    expect(p.a.state.pending).toHaveLength(0);
    p.a.pipe(()=>{});
    for(let i=0;i<64;i++){const m=p.a.outgoing(p.b.address,`pending ${i}`);await p.ac.send(p.b.address,m.id);}
    expect(p.a.state.pending).toHaveLength(64);expect(normalizeRadioState(p.a.state).pending).toHaveLength(64);
    const overflow=p.a.outgoing(p.b.address,'overflow');await expect(p.ac.send(p.b.address,overflow.id)).rejects.toThrow('radio_outbox_limit');
    expect(p.a.state.pending).toHaveLength(64);
    const first=p.a.state.pending[0];p.ac.acknowledge(first.peer,first.id);await p.ac.send(p.b.address,overflow.id);
    expect(p.a.state.pending).toHaveLength(64);
  }finally{p.close();}
},15000);

it('persists recipient-board acceptance separately, does not mark delivered or automatically retransmit it after unlock',async()=>{
  const a=await account(100),b=await account(200);a.accept(b.address);b.accept(a.address);
  const callbacks:((ok:boolean)=>void)[]=[];
  const link={send:async(_to:number,_ch:number,_payload:Uint8Array,_allowed?:()=>boolean,receipt?:(ok:boolean)=>void)=>{if(receipt)callbacks.push(receipt);}};
  const ac=await RadioAccountController.open(a.port,network,100,link,0,0),bc=await RadioAccountController.open(b.port,network,200,b.link,0,0);
  let reopened:RadioAccountController|undefined;
  try {await ac.addRoute(bc.contact);const m=a.outgoing(b.address);await ac.send(b.address,m.id);
    await until(()=>callbacks.length>0);for(const cb of callbacks)cb(true);
    await until(()=>a.chats.byPeer[b.address].messages[0].radioDelivery==='board');
    expect(a.chats.byPeer[b.address].messages[0].delivery).toBe('queued');expect(a.state.pending).toHaveLength(1);
    ac.close();await pause();const saved=a.data();a.restore(saved);
    expect(saved.chats.byPeer[b.address].messages[0].radioDelivery).toBe('board');
    reopened=await RadioAccountController.open(a.port,network,100,link,0,0);const count=callbacks.length;
    await reopened.resumePending();await pause();expect(callbacks).toHaveLength(count);
    await reopened.send(b.address,m.id);await until(()=>callbacks.length>count);
  }finally{ac.close();reopened?.close();bc.close();a.signer.dispose();b.signer.dispose();}
});

it('preserves receive quality in durable history without changing message content or signed delivery',async()=>{
  const p=await pair();
  try{
    p.a.pipe(packet=>p.bc.receivePacket({...packet,reception:{receivedAt:Date.now(),rssi:-103,snr:-3,hops:1}}));
    const message=p.a.outgoing(p.b.address);await p.ac.send(p.b.address,message.id);
    await until(()=>p.a.chats.byPeer[p.b.address].messages[0].delivery==='delivered');
    const incoming=p.b.chats.byPeer[p.a.address].messages[0];expect(incoming).toMatchObject({text:'hello',radioReception:{rssi:-103,snr:-3,hops:1}});
    expect(p.b.data().chats.byPeer[p.a.address].messages[0].radioReception).toMatchObject({rssi:-103,snr:-3,hops:1});
  }finally{p.close();}
});
