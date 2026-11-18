import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { FileReceiver } from '../src/lib/application/file-receiver';
import { FileReceiveSlots } from '../src/lib/application/file-receive-slots';
import { SessionTasks, clearUnownedFileBytes } from '../src/lib/application/session-lock';
import { emptySessionChats, ensureConversation, restoreChats, saveChats, updateConversation, setDeliveryStatus } from '../src/lib/chat/session-chats';
import { automaticFileOffers, MAX_AUTO_FILE_BYTES } from '../src/lib/chat/attachment-policy';
import { fileEntryUpdate, peerDisconnectedMessage } from '../src/lib/chat/node-transfer';
import { pendingFile } from '../src/lib/application/delivery-work';
import { sha256Hex, FILE_CHUNK_BYTES } from '../src/lib/chat/file-transfer';

// Exercise the actual host functions, with only browser/transport/storage ports
// substituted. This catches integration races that isolated policy tests miss.
const source = readFileSync(new URL('../src/routes/+page.svelte',import.meta.url),'utf8').split('</script>')[0].replace(/^<script[^>]*>/,'');
const tree = ts.createSourceFile('host.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const names = new Set(['receivingCourierFiles','releaseReceiveSlot','clearPeerFileWork','receiveWaitingFiles','pumpReceiveFiles','recoverFileReceives',
  'acceptFile','acceptFileNow','receiveFileChunk','sendFileData','sendFileDataNow','releaseFileScratch','updateFileEntry']);
const bodies = tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text));
if (bodies.length !== names.size) throw Error('host_recovery_functions_missing');
const host = ts.transpileModule(bodies.map(n=>n.getText(tree)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const deferred = () => { let release; const promise = new Promise(resolve=>{release=resolve;}); return {promise,release}; };
async function fixture(count=8) {
  const bytes = Array.from({length:count},(_,i)=>new Uint8Array(FILE_CHUNK_BYTES*3+17).fill(i+1));
  const messages = await Promise.all(bytes.map(async(data,i)=>{const id=crypto.randomUUID();return {id,from:'sender',direction:'incoming',timestamp:i+1,text:'',fileStatus:'offered',
    file:{id,name:`${i}.bin`,mime:'application/octet-stream',size:data.length,sha256:await sha256Hex(data)}};}));
  function context(direction) {
    const sessionChats=ensureConversation(emptySessionChats(),'peer');
    Object.assign(sessionChats.byPeer.peer,{contact:'accepted',connection:'connected',messages:structuredClone(messages).map(m=>({...m,direction,...direction==='outgoing'?{delivery:'queued',fileStatus:'queued'}:{}}))});
    const c={SessionTasks,FileReceiver,FileReceiveSlots,clearUnownedFileBytes,updateConversation,fileEntryUpdate,automaticFileOffers,MAX_AUTO_FILE_BYTES,FILE_CHUNK_BYTES,sha256Hex,pendingFile,
      sessionChats,sessionFiles:new Map(),sessionTasks:new SessionTasks(),receiveSlots:new FileReceiveSlots(),receiveRetryAfter:new Map(),automaticFileIds:new Set(),filePeerEpoch:new Map(),
      incomingFiles:new Map(),sendingFiles:new Map(),automaticFileBytes:0,receivePump:null,authGeneration:1,profileSwitchBusy:false,endingSession:false,switchingTrust:false,memoryBusy:false,panicBusy:false,
      autoReceiveFilesEnabled:true,trustedSession:false,chatStoreKey:null,courierState:{incomingFiles:[]},courierDelivery:{wake:vi.fn()},status:'',
      navigationBusy:()=>false,persistLocalChats:vi.fn(async()=>true),useCachedSticker:vi.fn(async()=>false),incomingNotification:vi.fn(),
      scheduleFileRetry:vi.fn(),offerFile:vi.fn(),setDeliveryStatus,Date,Symbol,Map,Set,Promise,
      fileTransferKey:(peer,id)=>`${peer}:${id}`,
    };
    c.getFileBytes=async(_peer,id)=>c.sessionFiles.get(id);
    c.storeFileBytes=vi.fn(async(_peer,id,data)=>{c.sessionFiles.set(`peer:${id}`,data);});
    vm.createContext(c);vm.runInContext(host,c);return c;
  }
  const sender=context('outgoing'),receiver=context('incoming'),jobs=new Set();
  let maxReceiving=0,slow=2;
  messages.forEach((m,i)=>sender.sessionFiles.set(m.id,bytes[i]));
  function track(p){jobs.add(p);void p.finally(()=>jobs.delete(p));}
  function connect(){
    const senderChat={sendFileChunk:async(id,index,chunk,_peer)=>{
      await new Promise(resolve=>setTimeout(resolve,slow));
      if(sender.chat!==senderChat||receiver.chat!==receiverChat)throw Error('disconnected');
      await receiver.receiveFileChunk('peer',id,index,chunk,receiverChat);
    }};
    const receiverChat={sendFileControl:async(action,id)=>{
      if(receiver.chat!==receiverChat)return;
      if(action==='accept')track(sender.sendFileData('peer',id,senderChat));
      if(action==='received')sender.sessionChats=setDeliveryStatus(sender.sessionChats,'peer',id,'delivered');
    }};
    sender.chat=senderChat;receiver.chat=receiverChat;
    sender.sessionChats.byPeer.peer.connection=receiver.sessionChats.byPeer.peer.connection='connected';
  }
  connect();
  const pulse=async()=>{receiver.receiveWaitingFiles();await new Promise(resolve=>setTimeout(resolve,4));maxReceiving=Math.max(maxReceiving,receiver.receiveSlots.size);};
  return {messages,bytes,sender,receiver,jobs,pulse,connect,setSlow:value=>{slow=value;},maxReceiving:()=>maxReceiving};
}

describe('direct file queue recovery in the application host',()=>{
  it('reserves before a delayed cache lookup and never resets the same active buffer',async()=>{
    const f=await fixture(1),gate=deferred(),r=f.receiver;
    r.useCachedSticker=vi.fn(async()=>{await gate.promise;return false;});
    const a=r.acceptFile('peer',f.messages[0].id),b=r.acceptFile('peer',f.messages[0].id);
    expect(r.receiveSlots.size).toBe(1);expect(r.useCachedSticker).toHaveBeenCalledTimes(1);
    gate.release();await Promise.all([a,b]);
    const buffer=r.incomingFiles.get(`peer:${f.messages[0].id}`);
    await r.acceptFile('peer',f.messages[0].id);expect(r.incomingFiles.get(`peer:${f.messages[0].id}`)).toBe(buffer);
    await Promise.allSettled([...f.jobs]);
  });
  it('holds a slot through the final hash/storage commit and cannot start a third file',async()=>{
    const f=await fixture(3),gate=deferred(),r=f.receiver;
    const write=r.storeFileBytes;r.storeFileBytes=vi.fn(async(...args)=>{await gate.promise;return write(...args);});
    await r.acceptFile('peer',f.messages[0].id);await r.acceptFile('peer',f.messages[1].id);
    await vi.waitFor(()=>expect(r.storeFileBytes).toHaveBeenCalledTimes(2));
    expect(r.receiveSlots.size).toBe(2);await r.acceptFile('peer',f.messages[2].id);
    expect(r.incomingFiles.has(`peer:${f.messages[2].id}`)).toBe(false);
    gate.release();await Promise.allSettled([...f.jobs]);expect(r.receiveSlots.size).toBe(0);
  });
  it('finishes a slow 12-file queue after repeated disconnections/lock restores without manual accepts or duplicates',async()=>{
    const f=await fixture(12);f.setSlow(5);
    for(let cycle=0;cycle<5;cycle++){
      await f.pulse();await f.pulse();
      for(const c of [f.sender,f.receiver]){
        c.chat=null;c.clearPeerFileWork('peer');c.authGeneration++;
        c.sessionChats.byPeer.peer.messages=c.sessionChats.byPeer.peer.messages.map(peerDisconnectedMessage);
        c.sessionChats=restoreChats(saveChats(c.sessionChats));
      }
      await Promise.allSettled([...f.jobs]);f.connect();
    }
    for(let n=0;n<300&&!f.receiver.sessionChats.byPeer.peer.messages.every(m=>m.fileStatus==='ready');n++)await f.pulse();
    await Promise.allSettled([...f.jobs]);
    expect(f.maxReceiving()).toBeLessThanOrEqual(2);
    expect(f.receiver.sessionChats.byPeer.peer.messages).toHaveLength(12);
    expect(f.receiver.sessionChats.byPeer.peer.messages.every(m=>m.fileStatus==='ready')).toBe(true);
    for(const [i,m]of f.messages.entries())expect(await sha256Hex(f.receiver.sessionFiles.get(`peer:${m.id}`))).toBe(await sha256Hex(f.bytes[i]));
    expect(f.receiver.automaticFileBytes).toBe(f.bytes.reduce((sum,b)=>sum+b.length,0));
  },15000);
  it('makes an old lease unable to release a newer job after reconnect',()=>{
    const slots=new FileReceiveSlots(),owner={},a=slots.reserve('a',owner);
    slots.cancel('a');const b=slots.reserve('a',owner);slots.release(a);
    expect(slots.current(b)).toBe(true);expect(slots.reserve('b',owner,1)).toBeUndefined();
  });
  it('admits only two restored node files instead of treating every saved consent as active work',async()=>{
    const f=await fixture(8),r=f.receiver;
    r.courierState.incomingFiles=f.messages.map(m=>({job:{body:{id:m.id,from:'peer'}}}));
    for(const m of r.sessionChats.byPeer.peer.messages){m.fileAccepted=true;m.fileStatus='offered';m.courierVia='node';}
    await r.pumpReceiveFiles();
    expect(r.receivingCourierFiles()).toBe(2);expect(r.courierDelivery.wake).toHaveBeenCalledTimes(2);
    expect(r.receiveSlots.size).toBe(0);
    for(let n=0;n<8;n++){
      const active=r.sessionChats.byPeer.peer.messages.find(m=>m.fileStatus==='receiving');if(!active)break;
      active.fileStatus='ready';await r.pumpReceiveFiles();expect(r.receivingCourierFiles()).toBeLessThanOrEqual(2);
    }
    expect(r.sessionChats.byPeer.peer.messages.every(m=>m.fileStatus==='ready')).toBe(true);
  });
});
