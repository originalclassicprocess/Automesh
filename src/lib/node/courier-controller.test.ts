import { describe, it, expect, vi } from 'vitest';
import { CourierController } from './courier-controller';
import { emptyCourierState, restoreCourierState } from './courier-state';
import { createCourierJob, generateCourierKey, signCourier, verifyCourier } from './courier-crypto';
import { cipherDigest } from './offline-crypto';
import { encodeChatContent } from '$lib/chat/message-details';
import { COURIER_PROTOCOL } from './courier-protocol.js';
import { ATTACHMENT_PROTOCOL, FILE_POLICY_BYTES } from './attachment-protocol.js';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { emptySessionChats, ensureConversation, recordSentMessage, setContactState, setDeliveryStatus } from '$lib/chat/session-chats';
async function account() { const identity = new WebCryptoIdentity(); await identity.create();
  return { identity, address: await accountIdFromPublicKey(await identity.getPublicKeyBytes()) }; }
describe('courier durable actor', () => {
  it('does not acknowledge an invalid envelope or let it trap later local inbox pages',async()=>{
    const [b,n]=await Promise.all([account(),account()]);const cursors:string[]=[],receive=vi.fn(),ack=vi.fn();
    let state={...emptyCourierState(),node:{url:'https://node.example',nodeId:'a'.repeat(32),address:n.address}};
    const worker=new CourierController({...b,state:()=>state,update:s=>{state=s as typeof state;},chats:emptySessionChats,
      persist:async()=>true,receive,delivery:()=>{},publish:async()=>{},error:()=>{},
      request:async(_url,_node,_identity,_address,path,body:any)=>{
        if(path==='/outbox/status')return {address:n.address,inboxProtocol:'automesh-inbox-v1'};
        if(path==='/inbox/list'){cursors.push(body.cursor);return {protocol:'automesh-inbox-v1',deliveries:body.cursor?[]:[{}],cursor:body.cursor?'':'c'.repeat(32)};}
        ack();throw Error('unexpected_request');
      }});
    try{await worker.poll();await worker.poll();expect(cursors).toEqual(['','c'.repeat(32)]);expect(receive).not.toHaveBeenCalled();expect(ack).not.toHaveBeenCalled();}
    finally{worker.stop();await worker.settled();b.identity.dispose();n.identity.dispose();}
  });
  it('retries the same local inbox page after a failed durable save, without redelivering or reusing keys', async () => {
    const [a,b,n] = await Promise.all([account(),account(),account()]);
    const expiresAt = Date.now()+60000;
    const keys = await Promise.all(Array.from({length:3},()=>generateCourierKey(a.address,expiresAt)));
    const bundle = await signCourier('prekeys',{protocol:COURIER_PROTOCOL,from:b.address,to:a.address,expiresAt,
      keys:keys.map(({id,publicKey})=>({id,publicKey}))},b.identity);
    const deliveries = await Promise.all(keys.map(async(key,i)=>{
      const job = await createCourierJob(a.identity,a.address,n.address,bundle,key,crypto.randomUUID(),Date.now(),encodeChatContent('page '+i));
      return {from:n.address,job,hop:await signCourier('hop',{protocol:COURIER_PROTOCOL,courier:n.address,id:job.body.id,digest:await cipherDigest(job.body.packet)},n.identity)};
    }));
    let state = {...emptyCourierState(),node:{url:'https://node.example',nodeId:'a'.repeat(32),address:n.address},keys};
    let committed = emptyCourierState(), allowSave = false;
    const received:string[] = [], acked = new Set<string>(), cursors:string[] = [];
    const chats = setContactState(ensureConversation(emptySessionChats(),a.address),a.address,'accepted');
    const worker = new CourierController({...b,state:()=>state,update:s=>{state=s as typeof state;},chats:()=>chats,
      persist:async()=>{if(received.length===2&&!allowSave)return false;committed=restoreCourierState(state);return true;},
      receive:message=>received.push(message.id),delivery:()=>{},publish:async()=>{},error:()=>{},
      request:async(_url,_node,_identity,_address,path,body:any)=>{
        if(path==='/outbox/status')return {address:n.address,inboxProtocol:'automesh-inbox-v1'};
        if(path==='/inbox/list'){cursors.push(body.cursor);return {protocol:'automesh-inbox-v1',cursor:body.cursor?'':'c'.repeat(32),deliveries:body.cursor?deliveries.slice(2):deliveries.slice(0,2)};}
        if(path==='/inbox/ack'){
          const proof=JSON.parse(body.receipt);await verifyCourier(proof,'receipt',b.address);
          expect(committed.acks.some(a=>a.id===proof.body.id&&a.receipt===body.receipt)).toBe(true);
          acked.add(proof.body.id);return {acknowledged:true};
        }
        throw Error('unexpected_request');
      }});
    try {
      await expect(worker.poll()).rejects.toThrow('courier_not_saved');expect(acked.size).toBe(1);
      allowSave=true;await worker.poll();expect(cursors).toEqual(['','']);expect(acked.size).toBe(2);
      await worker.poll();expect(cursors).toEqual(['','','c'.repeat(32)]);expect(acked.size).toBe(3);
      expect(received).toEqual(deliveries.map(d=>d.job.body.id));expect(state.keys).toHaveLength(0);
    }finally{worker.stop();await worker.settled();for(const who of[a,b,n])who.identity.dispose();}
  });
  it('keeps a wake received during a failed poll and does not replace radio/cancellation/confirmed states',async()=>{
    vi.useFakeTimers();let reject!:(error:Error)=>void;
    const chats=setContactState(recordSentMessage(emptySessionChats(),'peer',{id:'live',from:'me',direction:'outgoing',text:'x',timestamp:1,delivery:'queued'}),'peer','accepted');
    const m=chats.byPeer.peer.messages[0];
    chats.byPeer.peer.messages.push({...m,id:'history',importedFromDevice:true},{...m,id:'cancel',nodeQueue:'canceling'},
      {...m,id:'radio',radioDelivery:'queued'},{...m,id:'confirmed',delivery:'delivered'});
    const issue=vi.fn(),worker=new CourierController({address:'me',identity:{} as any,state:emptyCourierState,update:()=>{},chats:()=>chats,
      persist:async()=>true,receive:()=>{},delivery:()=>{},publish:async()=>{},error:()=>{},issue});
    const poll=vi.spyOn(worker,'poll').mockImplementationOnce(()=>new Promise<void>((_resolve,fail)=>{reject=fail;})).mockResolvedValue();
    try {
      worker.start();await vi.advanceTimersByTimeAsync(50);worker.wake();reject(Error('connection_lost'));
      await vi.advanceTimersByTimeAsync(50);expect(poll).toHaveBeenCalledTimes(2);
      expect(issue.mock.calls.map(call=>call[1])).toEqual(['live']);
    }finally{worker.stop();vi.useRealTimers();}
  });
  it('keeps the failed page cursor for retry while accepting other valid remote envelopes',async()=>{
    const [a,b,n]=await Promise.all([account(),account(),account()]);let now=Date.now();
    const clock=vi.spyOn(Date,'now').mockImplementation(()=>now),expiresAt=now+60000;
    const keys=await Promise.all([generateCourierKey(a.address,expiresAt),generateCourierKey(a.address,expiresAt)]);
    const receiverBundle=await signCourier('prekeys',{protocol:COURIER_PROTOCOL,from:b.address,to:a.address,expiresAt,keys:keys.map(({id,publicKey})=>({id,publicKey}))},b.identity);
    const deliveries=await Promise.all(keys.map(async(key,i)=>{
      const job=await createCourierJob(a.identity,a.address,n.address,receiverBundle,key,crypto.randomUUID(),now,encodeChatContent('remote '+i));
      const hop=await signCourier('hop',{protocol:COURIER_PROTOCOL,courier:n.address,id:job.body.id,digest:await cipherDigest(job.body.packet)},n.identity);
      return {from:n.address,job,hop};
    }));
    const grant=await signCourier('recipient-inbox',{protocol:'automesh-recipient-inbox-v1',from:a.address,to:b.address,courier:n.address,nodeId:'a'.repeat(32),issuedAt:now,expiresAt},a.identity);
    const senderBundle=await signCourier('prekeys',{protocol:COURIER_PROTOCOL,from:a.address,to:b.address,expiresAt,keys:[{id:keys[0].id,publicKey:keys[0].publicKey}],senderQueue:{url:'https://queue.example',nodeId:'a'.repeat(32),address:n.address,grant}},a.identity);
    let state:ReturnType<typeof emptyCourierState>={...emptyCourierState(),keys,bundles:{[a.address]:senderBundle}};
    let rejectFirst=true,lists=0;
    const chats=setContactState(ensureConversation(emptySessionChats(),a.address),a.address,'accepted'),acked=new Set<string>(),cursors:string[]=[];
    const worker=new CourierController({...b,state:()=>state,update:s=>state=s,chats:()=>chats,persist:async()=>true,publish:async()=>{},delivery:()=>{},error:()=>{},
      receive:message=>{if(rejectFirst&&message.id===deliveries[0].job.body.id)throw Error('courier_not_saved');},
      request:async(_url,_node,_identity,_address,path,body:any)=>{
        if(path==='/receive/list'){cursors.push(body.cursor);return {protocol:'automesh-inbox-v1',deliveries:deliveries.filter(d=>!acked.has(d.job.body.id)),cursor:++lists===1?'c'.repeat(32):''};}
        expect(path).toBe('/receive/ack');const proof=JSON.parse(body.receipt);await verifyCourier(proof,'receipt',b.address);acked.add(proof.body.id);return {acknowledged:true};
      }});
    try{
      await worker.poll();await worker.settled();expect(acked.has(deliveries[1].job.body.id)).toBe(true);expect(acked.has(deliveries[0].job.body.id)).toBe(false);
      expect(state.keys.some(k=>k.id===keys[0].id)).toBe(true);
      rejectFirst=false;now+=6000;await worker.poll();await worker.settled();expect(cursors).toEqual(['','']);expect(acked.size).toBe(2);
    }finally{worker.stop();await worker.settled();clock.mockRestore();for(const who of[a,b,n])who.identity.dispose();}
  });
  it('ignores a late node health response after lock and leaves a fresh receiver independent',async()=>{
    const receiver=await account(), node=await account();
    let state={...emptyCourierState(),node:{url:'https://node.example',nodeId:'a'.repeat(32),address:node.address}};
    let release!: (value:unknown)=>void, requested!:()=>void;
    const waiting=new Promise<void>(resolve=>requested=resolve), calls:string[]=[];
    const receive=vi.fn(), diagnostics=vi.fn();
    const old=new CourierController({...receiver,state:()=>state,update:value=>state=value as typeof state,chats:emptySessionChats,
      persist:async()=>true,receive,delivery:()=>{},publish:async()=>{},error:()=>{},diagnostics,
      request:async(_url,_node,_identity,_address,path)=>{calls.push(path);requested();return new Promise(resolve=>release=resolve);}});
    const poll=old.poll(); const rejected=expect(poll).rejects.toThrow('courier_session_closed');
    await waiting;old.stop();release({address:node.address,inboxProtocol:'automesh-inbox-v1'});await rejected;await old.settled();
    expect(calls).toEqual(['/outbox/status']);expect(receive).not.toHaveBeenCalled();expect(diagnostics).not.toHaveBeenCalled();
    const fresh=new CourierController({...receiver,state:()=>state,update:value=>state=value as typeof state,chats:emptySessionChats,
      persist:async()=>true,receive,delivery:()=>{},publish:async()=>{},error:()=>{},
      request:async(_url,_node,_identity,_address,path)=>path==='/outbox/status'?{address:node.address,inboxProtocol:'automesh-inbox-v1'}
        :path==='/inbox/list'?{protocol:'automesh-inbox-v1',cursor:'',deliveries:[]}:{receipts:[]}});
    try {await fresh.poll();} finally {fresh.stop();await fresh.settled();receiver.identity.dispose();node.identity.dispose();}
  });
  it('pulls incoming after repeated fresh unlocks without signaling, outgoing enabled or sender online', async () => {
    const [a, b, n] = await Promise.all([account(), account(), account()]);
    const chats = setContactState(ensureConversation(emptySessionChats(), a.address), a.address, 'accepted');
    const keys = await Promise.all(Array.from({ length: 32 }, () => generateCourierKey(a.address, Date.now() + 120000)));
    const bundle = await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: b.address, to: a.address,
      expiresAt: Math.min(...keys.map(k => k.expiresAt)), keys: keys.map(({ id, publicKey }) => ({ id, publicKey })) }, b.identity);
    const queue = await Promise.all(keys.map(async (k, i) => {
      const job = await createCourierJob(a.identity, a.address, n.address, bundle, k, crypto.randomUUID(), Date.now(), encodeChatContent('incoming-' + i));
      return { from: n.address, job, hop: await signCourier('hop', { protocol: COURIER_PROTOCOL, courier: n.address, id: job.body.id, digest: await cipherDigest(job.body.packet) }, n.identity) };
    }));
    let state = { ...emptyCourierState(), enabled: false, node: { url: 'https://node.automesh.space', nodeId: 'a'.repeat(32), address: n.address }, keys };
    let committed = emptyCourierState(), save = true, received = 0, acked = 0, loseAckResponse = true;
    const request = async (_url: string, _node: string, _identity: unknown, address: string, path: string, body: any): Promise<any> => {
      expect(address).toBe(b.address);
      if (path === '/outbox/status') return { address: n.address, inboxProtocol: 'automesh-inbox-v1' };
      if (path === '/inbox/list') return { protocol: 'automesh-inbox-v1', cursor: '', deliveries: [queue[acked]] };
      if (path === '/inbox/ack') {
        const receipt = JSON.parse(body.receipt); await verifyCourier(receipt, 'receipt', b.address);
        expect(committed.acks.some(ack => ack.id === receipt.body.id && ack.receipt === body.receipt)).toBe(true);
        if (loseAckResponse) { loseAckResponse = false; throw new Error('connection_lost'); }
        acked++; return { acknowledged: true };
      }
      throw new Error('unexpected_request');
    };
    const worker = () => new CourierController({ ...b, state: () => state, update: s => { state = s as typeof state; }, chats: () => chats,
      persist: async () => { if (save) committed = restoreCourierState(state); return save; }, receive: () => { received++; },
      delivery: () => {}, publish: async () => {}, error: () => {}, request });
    let target = worker();
    try {
      save = false; await expect(target.poll()).rejects.toThrow('courier_not_saved'); expect(acked).toBe(0);
      save = true; await target.poll(); expect(acked).toBe(0); expect(received).toBe(1);
      await target.poll(); expect(acked).toBe(1); expect(received).toBe(1);
      for (let cycle = 1; cycle < 32; cycle++) {
        target.stop(); await target.settled(); state = restoreCourierState(committed) as typeof state; target = worker();
        await target.poll(); expect(acked).toBe(cycle + 1); expect(received).toBe(cycle + 1);
      }
    } finally { target.stop(); await target.settled(); }
  });

  it('does not contact a stored public courier in LAN-only mode', async () => {
    const a = await account(), n = await account(), request = vi.fn();
    let state = { ...emptyCourierState(), enabled: true, node: { url: 'https://node.automesh.space', nodeId: 'a'.repeat(32), address: n.address } };
    const worker = new CourierController({ ...a, lanOnly: () => true, state: () => state, update: value => { state = value as typeof state; },
      chats: emptySessionChats, persist: async () => true, receive: () => {}, delivery: () => {}, publish: async () => {}, error: () => {}, request });
    try { await expect(worker.poll()).rejects.toThrow('internet_disabled'); expect(request).not.toHaveBeenCalled(); } finally { worker.stop(); }
  });
  it.each(['node', 'peer'])('does not spend a file prekey on an outdated %s, while text remains compatible', async outdated => {
    const [a, b, n] = await Promise.all([account(), account(), account()]); let state = emptyCourierState();
    const chats = setContactState(ensureConversation(emptySessionChats(), b.address), b.address, 'accepted');
    const fileId = crypto.randomUUID(), textId = crypto.randomUUID(), load = vi.fn(async () => null), uploads: any[] = [];
    chats.byPeer[b.address].messages.push({ id: fileId, text: '', from: a.address, timestamp: Date.now(), direction: 'outgoing', delivery: 'queued', fileStatus: 'queued',
      file: { id: fileId, name: 'test.txt', mime: 'text/plain', size: 4, sha256: '0'.repeat(64) } },
      { id: textId, text: 'still compatible', from: a.address, timestamp: Date.now(), direction: 'outgoing', delivery: 'queued' });
    const worker = new CourierController({ address: a.address, identity: a.identity, state: () => state, update: s => { state = s; }, chats: () => chats,
      persist: async () => true, receive: () => {}, delivery: () => {}, publish: async () => {}, error: () => {},
      files: { load, offer: () => {}, accepted: () => false, progress: () => {}, complete: async () => {}, savePart: async () => {}, loadPart: async () => null, cleanup: async () => {} },
      request: async (_url, _node, _identity, _address, path, body: any) => {
        if (path === '/outbox/status') return { address: n.address, enabled: true, relay: 'wss://relay.example/signal',
          ...(outdated !== 'node' ? { fileQueue: { protocol: ATTACHMENT_PROTOCOL, maxFileBytes: FILE_POLICY_BYTES } } : {}) };
        if (path === '/outbox/put') { uploads.push(body.job); return { status: 'stored' }; } return { receipts: [] };
      } });
    try {
      await worker.configure({ url: 'https://localhost:3003', nodeId: 'a'.repeat(32), address: n.address }, true);
      const expiresAt = Date.now() + 60000, key = await generateCourierKey(a.address, expiresAt);
      await worker.accept(b.address, await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: b.address, to: a.address, expiresAt,
        ...(outdated !== 'peer' ? { attachmentProtocol: ATTACHMENT_PROTOCOL, maxFileBytes: FILE_POLICY_BYTES } : {}), keys: [{ id: key.id, publicKey: key.publicKey }] }, b.identity));
      await worker.poll(); expect(load).not.toHaveBeenCalled(); expect(uploads.map(j => j.body.id)).toEqual([textId]);
      expect(state.outgoingFiles).toEqual({}); expect(Object.keys(state.used)).toEqual([key.id]);
    } finally { worker.stop(); await worker.settled(); }
  });
  it('requires updated LAN-capable node and signs LAN-only jobs without reusing prekeys', async () => {
    const [a, b, n] = await Promise.all([account(), account(), account()]); let state = emptyCourierState();
    const chats = setContactState(ensureConversation(emptySessionChats(), b.address), b.address, 'accepted');
    const id = crypto.randomUUID(); chats.byPeer[b.address].messages.push({ id, text: 'LAN', from: a.address, timestamp: Date.now(), direction: 'outgoing', delivery: 'queued' });
    let updated = false; let lanOnly = true; const uploaded: any[] = []; const errors: string[] = [];
    const worker = new CourierController({ address: a.address, identity: a.identity, state: () => state, update: s => { state = s; },
      chats: () => chats, persist: async () => true, receive: () => {}, delivery: () => {}, publish: async () => {},
      error: value => { errors.push(value); }, lanOnly: () => lanOnly,
      request: async (_url, _node, _identity, _address, path, body: any) => {
        if (path === '/outbox/status') return updated ? { address: n.address, enabled: true, relay: '', lanEnabled: true,
          deliveryScopes: true, routes: { lan: 'connected', internet: 'disabled' } } : { address: n.address, relay: 'wss://relay.example/signal' };
        if (path === '/outbox/put') { uploaded.push(body.job); return { status: 'stored' }; } return { receipts: [] };
      } });
    try {
      const endpoint = { url: 'https://localhost:3003', nodeId: 'a'.repeat(32), address: n.address };
      await expect(worker.configure(endpoint, true)).rejects.toThrow('courier_lan_update_required'); expect(state.node).toBeNull();
      updated = true; await worker.configure(endpoint, true);
      const expiresAt = Date.now() + 60000, key = await generateCourierKey(a.address, expiresAt);
      await worker.accept(b.address, await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: b.address, to: a.address, expiresAt,
        keys: [{ id: key.id, publicKey: key.publicKey }] }, b.identity));
      await worker.poll(); expect(uploaded).toHaveLength(1); expect(uploaded[0].body.lanOnly).toBe(true);
      expect(restoreCourierState(state).pending[0]).toEqual(uploaded[0]);
      lanOnly = false; await worker.poll(); expect(uploaded).toHaveLength(1); expect(Object.keys(state.used)).toEqual([key.id]);
      expect(errors.at(-1)).toBe('');
    } finally { worker.stop(); await worker.settled(); }
  });
  it('uses keys once, retries exact jobs, refuses forged receipts and never uploads failed commits', async () => {
    const [a, b, n] = await Promise.all([account(), account(), account()]);
    let state = emptyCourierState(); let fail = false, forge = false; const uploads: unknown[] = [];
    let chats = setContactState(ensureConversation(emptySessionChats(), b.address), b.address, 'accepted');
    for (let i = 0; i < 3; i++) chats = recordSentMessage(chats, b.address, { id: crypto.randomUUID(), text: 'hello', from: a.address,
      timestamp: Date.now(), direction: 'outgoing', delivery: 'queued' });
    const worker = new CourierController({ address: a.address, identity: a.identity, state: () => state, update: s => { state = s; },
      chats: () => chats, persist: async () => !fail, receive: () => {}, delivery: (peer, id, s) => { chats = setDeliveryStatus(chats, peer, id, s); },
      publish: async () => {}, error: () => {}, request: async (_url, _node, _identity, _address, path, body) => {
        if (path === '/outbox/status') return { address: n.address, relay: 'wss://relay.example/signal' };
        if (path === '/outbox/put') { uploads.push(structuredClone(body)); return { status: 'stored' }; }
        if (path === '/outbox/receipts') return { receipts: forge ? [{ receipt: '{}' }] : [] }; return {};
      } });
    try {
      await worker.configure({ url: 'https://localhost:3003', nodeId: 'a'.repeat(32), address: n.address }, true);
      const expiresAt = Date.now() + 60000; const keys = await Promise.all([generateCourierKey(a.address, expiresAt), generateCourierKey(a.address, expiresAt)]);
      const bundle = await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: b.address, to: a.address, expiresAt,
        keys: keys.map(({ id, publicKey }) => ({ id, publicKey })) }, b.identity);
      await worker.accept(b.address, bundle);
      fail = true; await expect(worker.poll()).rejects.toThrow('courier_not_saved'); expect(uploads).toHaveLength(0);
      fail = false; await worker.poll(); expect(uploads).toHaveLength(2);
      const initial = [...uploads]; await worker.accept(b.address, bundle); await worker.poll();
      expect(uploads).toEqual(initial); expect(Object.keys(state.used)).toHaveLength(2); expect(state.pending).toHaveLength(2);
      forge = true; await expect(worker.poll()).rejects.toThrow('invalid_courier_receipt');
      expect(chats.byPeer[b.address].messages.some(m => m.delivery === 'delivered')).toBe(false);
      expect(restoreCourierState(state).pending).toHaveLength(2);
      worker.stop(); const previous = state;
      await expect(worker.publish(b.address)).rejects.toThrow('courier_busy'); expect(state).toBe(previous);
    } finally { worker.stop(); await worker.settled(); }
  });
  it('uploads seven messages in the same pass without first-five starvation or lost failed jobs', async () => {
    const [a, b, n] = await Promise.all([account(), account(), account()]); let state = emptyCourierState();
    let chats = setContactState(ensureConversation(emptySessionChats(), b.address), b.address, 'accepted');
    const ids = Array.from({ length: 7 }, () => crypto.randomUUID()); const stored = new Map<string, unknown>();
    let failFirst = true; let committed: typeof state = state;
    for (const id of ids) chats = recordSentMessage(chats, b.address, { id, text: id, from: a.address, timestamp: Date.now(), direction: 'outgoing', delivery: 'queued' });
    const worker = new CourierController({ address: a.address, identity: a.identity, state: () => state, update: s => { state = s; },
      chats: () => chats, persist: async () => { committed = structuredClone(state); return true; }, receive: () => {},
      delivery: (peer, id, status) => { chats = setDeliveryStatus(chats, peer, id, status); }, publish: async () => {}, error: () => {},
      request: async (_url, _node, _identity, _address, path, body: any) => {
        if (path === '/outbox/status') return { address: n.address, relay: 'wss://relay.example/signal', status: 'connected' };
        if (path === '/outbox/receipts') { expect(body.ids).toHaveLength(7); return { receipts: [] }; }
        const job = body.job;
        expect(committed.pending.find(j => j.body.id === job.body.id)).toEqual(job);
        if (job.body.id === ids[0] && failFirst) throw new Error('queue_busy');
        stored.set(job.body.id, structuredClone(job)); return { status: 'stored' };
      } });
    try {
      await worker.configure({ url: 'https://localhost:3003', nodeId: 'a'.repeat(32), address: n.address }, true);
      const expiresAt = Date.now() + 60000;
      const keys = await Promise.all(ids.map(() => generateCourierKey(a.address, expiresAt)));
      await worker.accept(b.address, await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: b.address, to: a.address,
        expiresAt, keys: keys.map(({ id, publicKey }) => ({ id, publicKey })) }, b.identity));
      await worker.poll(); expect(stored.size).toBe(6); expect(state.pending).toHaveLength(7);
      expect(chats.byPeer[b.address].messages.filter(m => m.delivery === 'stored')).toHaveLength(6);
      const exact = structuredClone(state.pending.find(j => j.body.id === ids[0]));
      failFirst = false; await worker.poll(); expect(stored.size).toBe(7); expect(stored.get(ids[0])).toEqual(exact);
      expect(chats.byPeer[b.address].messages.every(m => m.delivery === 'stored')).toBe(true);
      await worker.poll(); expect(stored.size).toBe(7); expect(Object.keys(state.used)).toHaveLength(7);
    } finally { worker.stop(); await worker.settled(); }
  });
  it('coalesces send notifications into an immediate pass and cancels timers on lock', async () => {
    vi.useFakeTimers(); const state = emptyCourierState();
    const worker = new CourierController({ address: '', identity: {} as any, state: () => state, update: () => {},
      chats: emptySessionChats, persist: async () => true, receive: () => {}, delivery: () => {}, publish: async () => {}, error: () => {} });
    const poll = vi.spyOn(worker, 'poll').mockResolvedValue();
    try { worker.start(); for (let i = 0; i < 30; i++) worker.wake();
      await vi.advanceTimersByTimeAsync(50); expect(poll).toHaveBeenCalledTimes(1);
      worker.stop(); await vi.advanceTimersByTimeAsync(10000); expect(poll).toHaveBeenCalledTimes(1);
    } finally { worker.stop(); vi.useRealTimers(); }
  });
  it('never advertises reusable keys from an uncommitted batch; lock stops continuation', async () => {
    const [a, b] = await Promise.all([account(), account()]); let state = emptyCourierState(); let fail = true; let publishes = 0;
    let release: (() => void) | undefined; let wait = false;
    const chats = setContactState(ensureConversation(emptySessionChats(), b.address), b.address, 'accepted');
    const worker = new CourierController({ address: a.address, identity: a.identity, state: () => state, update: s => { state = s; },
      chats: () => chats, persist: async () => { if (wait) await new Promise<void>(r => { release = r; }); return !fail; },
      receive: () => {}, delivery: () => {}, publish: async () => { publishes++; }, error: () => {} });
    try {
      await expect(worker.publish(b.address)).rejects.toThrow('courier_not_saved'); expect(state.keys).toHaveLength(32); expect(publishes).toBe(0);
      await expect(worker.publish(b.address)).rejects.toThrow('courier_not_saved'); expect(publishes).toBe(0);
      fail = false; await worker.publish(b.address); expect(publishes).toBe(1);
      wait = true; const pending = worker.publish(b.address);
      await new Promise(r => setTimeout(r, 0)); worker.stop(); release!();
      await expect(pending).rejects.toThrow('courier_session_closed'); expect(publishes).toBe(1);
    } finally { worker.stop(); release?.(); await worker.settled(); }
  });
});
