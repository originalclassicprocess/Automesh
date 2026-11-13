import {nodeTransferUpdate} from '$lib/chat/node-transfer';
import {nodeInteractionGroups} from '$lib/chat/node-queue-overview';
import {messageStatus} from '$lib/chat/message-presentation';
import {deliveryAttention} from '$lib/chat/delivery-attention';
import {PREKEY_TARGET} from '$lib/node/courier-prekeys.js';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createHomeNode } from './application.js';
import { testProtector } from './test-protection.fixture.js';
const secretProtector = testProtector();
import { createSignalingServer } from '../signaling.js';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { registrationProofBytes } from '$lib/transport/registration-proof.js';
import { CourierController, type CourierDelivery, type CourierReply } from '$lib/node/courier-controller';
import { RecoveryController } from '$lib/application/recovery';
import { attachmentHash } from '$lib/node/attachment-crypto';
import { ATTACHMENT_CHUNK_BYTES } from '$lib/node/attachment-protocol.js';
import { unbase64 } from '$lib/node/offline-crypto';
import { emptyCourierState, restoreCourierState } from '$lib/node/courier-state';
import { cipherDigest } from '$lib/node/offline-crypto';
import { signCourier } from '$lib/node/courier-crypto';
import { COURIER_PROTOCOL } from '$lib/node/courier-protocol.js';
import { signedNodeRequest } from '$lib/node/client';
import { emptySessionChats, ensureConversation, receiveMessage, recordSentMessage, setContactState, setDeliveryStatus } from '$lib/chat/session-chats';
import { deriveChatStoreKey, sealChatData, openSealedChatData, type LocalChatData } from '$lib/chat/local-store';
const nativeFetch = globalThis.fetch;
let directory = ''; let node: Awaited<ReturnType<typeof createHomeNode>> | undefined;
let relay: ReturnType<typeof createSignalingServer> | undefined; const sockets: WebSocket[] = []; const workers: CourierController[] = [];
async function account() { const identity = new WebCryptoIdentity(); const seed = crypto.getRandomValues(new Uint8Array(32)); await identity.fromSeed(seed);
  return { identity, seed, address: await accountIdFromPublicKey(await identity.getPublicKeyBytes()) }; }
async function start(relayUrl: string, port = 0, signalingEnabled = true) {
  if (!directory) directory = await mkdtemp(join(tmpdir(), 'automesh-courier-test-'));
  const hosts = ['127.0.0.1:0'];
  node = await createHomeNode({ directory, hosts, origins: ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://automesh.space'], adminToken: 'b'.repeat(64), testHttp: true, courierRelay: relayUrl, testRelay: true, secretProtector, signalingEnabled });
  const listener = node.createPublicServer(); listener.listen(port, '127.0.0.1'); await once(listener, 'listening');
  const actualPort = (listener.address() as { port: number }).port; hosts.push(`127.0.0.1:${actualPort}`);
  node.control.listen(0, '127.0.0.1'); await once(node.control, 'listening');
  return { url: `https://127.0.0.1:${actualPort}`, nodeId: node.state.value.nodeId, address: node.courier.address, port: actualPort };
}
async function register(url: string, who: Awaited<ReturnType<typeof account>>) {
  const ws = new WebSocket(url); sockets.push(ws); await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'register', address: who.address }));
  const challenge = JSON.parse((await once(ws, 'message'))[0].toString());
  ws.send(JSON.stringify({ type: 'register_proof', address: who.address,
    publicKey: Buffer.from(await who.identity.getPublicKeyBytes()).toString('hex'),
    signature: Buffer.from(await who.identity.sign(registrationProofBytes(who.address, challenge.challenge))).toString('hex') }));
  expect(JSON.parse((await once(ws, 'message'))[0].toString()).courierProtocol).toBe(COURIER_PROTOCOL);
  return ws;
}
function client(who: Awaited<ReturnType<typeof account>>, peer: string, lanOnly = false, fileMode = false) {
  let state = emptyCourierState(); let saved = state; let fail = false;
  let chats = setContactState(ensureConversation(emptySessionChats(), peer), peer, 'accepted');
  let other: CourierController;
  const files = new Map<string, Uint8Array>(), parts = new Map<string, Uint8Array>(); let acceptFiles = false;
  const phases:string[]=[];
  const worker = new CourierController({ activity:(peer,id,stage)=>{const m=chats.byPeer[peer]?.messages.find(m=>m.id===id);if(m)Object.assign(m,nodeTransferUpdate(m,stage));phases.push(stage??'idle');},
    issue:(peer,id,issue)=>{const m=chats.byPeer[peer]?.messages.find(m=>m.id===id);if(m)m.deliveryIssue=issue;},address: who.address, identity: who.identity, state: () => state, update: s => { state = s; },
    ...(fileMode ? { files: {
      load: async (_peer: string, id: string) => files.get(id)?.slice() ?? null,
      offer: (from: string, offer: any, timestamp: number, courierVia: string) => { if (!chats.byPeer[from].messages.some(m => m.id === offer.id)) chats = receiveMessage(chats, { id: offer.id, text: '', from, timestamp, direction: 'incoming', file: offer, fileStatus: 'offered', courierVia }); },
      accepted: () => acceptFiles,
      progress: (_peer: string, id: string, bytes: number) => { const m = chats.byPeer[peer].messages.find(m => m.id === id)!; m.fileProgress = bytes;m.fileStatus='sending'; },
      complete: async (_peer: string, id: string, bytes: Uint8Array) => { files.set(id, bytes.slice()); chats.byPeer[peer].messages.find(m => m.id === id)!.fileStatus = 'ready'; },
      savePart: async (_peer: string, id: string, index: number, bytes: Uint8Array) => { parts.set(`${id}:${index}`, bytes.slice()); },
      loadPart: async (_peer: string, id: string, index: number) => parts.get(`${id}:${index}`)?.slice() ?? null,
      cleanup: async (_peer: string, id: string, chunks: number) => { for (let i = 0; i < chunks; i++) parts.delete(`${id}:${i}`); },
    } } : {}),
    chats: () => chats, persist: async () => { if (fail) return false; saved = structuredClone(state); return true; },
    receive: m => { chats = receiveMessage(chats, { ...m, direction: 'incoming' }); },
    delivery: (peer, id, status) => { chats = setDeliveryStatus(chats, peer, id, status); },
    publish: async (_peer, bundle) => { await other.accept(who.address, bundle); }, error: () => {}, lanOnly: () => lanOnly }); workers.push(worker);
  return { worker, phases, state: () => state, chats: () => chats, saved: () => saved, fail: (f: boolean) => { fail = f; },
    connect: (o: CourierController) => { other = o; },
    send: (text: string) => { const id = crypto.randomUUID(); chats = recordSentMessage(chats, peer, { id, text, from: who.address, timestamp: Date.now(), direction: 'outgoing', delivery: 'queued' }); return id; },
    reload: () => { state = restoreCourierState(saved); }, files, parts, acceptFiles: (yes: boolean) => { acceptFiles = yes; },
    sendFile: async (bytes: Uint8Array) => {
      const id = crypto.randomUUID(); files.set(id, bytes.slice()); chats = recordSentMessage(chats, peer, { id, text: '', from: who.address, timestamp: Date.now(), direction: 'outgoing', delivery: 'queued',
        file: { id, name: 'private-video.mp4', mime: 'video/mp4', size: bytes.length, sha256: await attachmentHash(bytes) }, fileStatus: 'queued' }); return id;
    } };
}
function attachFileReceiver(ws: WebSocket, worker: CourierController, failures: unknown[]) {
  const pending = new Map<string, (m: any) => void>(); const deliveries: CourierDelivery[] = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'courier_file_chunk') { pending.get(m.requestId)?.(m); return; }
    if (m.type !== 'courier_delivery') return; deliveries.push(m);
    const reply: CourierReply = (id, receipt) => ws.send(JSON.stringify({ type: 'courier_receipt', to: m.from, id, receipt }));
    reply.chunk = (request, signal) => new Promise((resolve, reject) => {
      const id = request.body.requestId;
      const cleanup = () => { clearTimeout(timer); pending.delete(id); signal.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(new Error('aborted')); }; const timer = setTimeout(abort, 3000); signal.addEventListener('abort', abort, { once: true });
      pending.set(id, chunk => { cleanup(); resolve(unbase64(chunk.cipher)); });
      ws.send(JSON.stringify({ type: 'courier_file_request', to: m.from, request }));
    });
    void worker.receive(m, reply).catch(e => failures.push(e));
  }); return deliveries;
}
afterEach(async () => {
  const previous = workers.splice(0); for (const worker of previous) worker.stop(); await Promise.all(previous.map(w => w.settled()));
  for (const socket of sockets.splice(0)) socket.terminate(); await node?.close(); node = undefined;
  if (relay) await new Promise<void>(resolve => relay!.close(() => resolve())); relay = undefined;
  if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; vi.unstubAllGlobals();
});
describe('outgoing courier with authenticated LAN upload and real internet-relay transport', () => {
  it('recovers a lost signed receipt after unlock while signaling fails, without another prekey or duplicate',async()=>{
    const [alice,bob]=await Promise.all([account(),account()]),endpoint=await start('');
    let loseReceipt=false;
    vi.stubGlobal('fetch',async(url:any,init?:RequestInit)=>{
      const response=await nativeFetch(String(url).replace('https://queue.example',endpoint.url).replace(/^https:/,'http:'),init);
      if(loseReceipt&&String(url).endsWith('/outbox/receipts')){loseReceipt=false;throw new TypeError('connection_lost_after_response');}
      return response;
    });
    const admin=`http://127.0.0.1:${node!.control.address().port}`;
    const code=(await(await nativeFetch(admin+'/status',{headers:{Authorization:'Bearer '+'b'.repeat(64)}})).json()).pairCode;
    await signedNodeRequest(endpoint.url,endpoint.nodeId,alice.identity,alice.address,'/node/join',{code},new AbortController().signal);
    const a=client(alice,bob.address),b=client(bob,alice.address);a.connect(b.worker);b.connect(a.worker);
    await a.worker.configure({...endpoint,url:'https://queue.example'},true);await a.worker.publish(bob.address);await b.worker.publish(alice.address);
    const id=a.send('survive a lost receipt');await a.worker.poll();await a.worker.settled();
    const job=structuredClone(a.state().pending[0]),used=structuredClone(a.state().used);
    await b.worker.poll();await b.worker.settled();expect(b.chats().byPeer[alice.address].messages).toHaveLength(1);
    loseReceipt=true;await expect(a.worker.poll()).rejects.toThrow();expect(a.state().pending[0]).toEqual(job);
    a.worker.stop();await a.worker.settled();
    let state=restoreCourierState(a.saved()),chats=a.chats();
    const sender=new CourierController({...alice,state:()=>state,update:s=>{state=s;},chats:()=>chats,persist:async()=>true,
      receive:()=>{},delivery:(peer,id,status)=>{chats=setDeliveryStatus(chats,peer,id,status);},publish:async()=>{},error:()=>{}});
    workers.push(sender);const recovery=new RecoveryController(0);
    try{
      await Promise.all([recovery.request('signaling',()=>{throw Error('signaling_unavailable');}),
        recovery.request('queue',async()=>{await sender.poll();await sender.settled();})]);
      expect(state.pending).toHaveLength(0);expect(state.used).toEqual(used);
      expect(chats.byPeer[bob.address]).toMatchObject({contact:'accepted',messages:[{id,delivery:'delivered'}]});
      expect(b.chats().byPeer[alice.address].messages).toHaveLength(1);expect(sockets).toHaveLength(0);
    }finally{recovery.reset();}
  });
  it('replaces retry errors with real HTTPS upload activity and never claims recipient delivery',async()=>{
    const [alice,bob]=await Promise.all([account(),account()]),endpoint=await start('');
    let failPart=true;const seen:Array<{stage:unknown;issue:unknown;upload:number;errors:number;label:string}>=[];
    let a:ReturnType<typeof client>|undefined;
    vi.stubGlobal('fetch',async(url:any,init?:RequestInit)=>{
      if(String(url).endsWith('/outbox/file/part')&&a){
        const m=a.chats().byPeer[bob.address].messages[0],g=nodeInteractionGroups([m],new Set([m.id]));
        seen.push({stage:m.courierStage,issue:m.deliveryIssue,upload:g.transmitting.length,errors:g.errors.length,label:messageStatus(m).label});
        expect(deliveryAttention([m])).toBeNull();
        if(failPart){failPart=false;throw Error('node_timeout');}
      }
      return nativeFetch(String(url).replace(/^https:/,'http:'),init);
    });
    const admin=`http://127.0.0.1:${node!.control.address().port}`;
    const code=(await(await nativeFetch(admin+'/status',{headers:{Authorization:'Bearer '+'b'.repeat(64)}})).json()).pairCode;
    await signedNodeRequest(endpoint.url,endpoint.nodeId,alice.identity,alice.address,'/node/join',{code},new AbortController().signal);
    a=client(alice,bob.address,false,true);const b=client(bob,alice.address,false,true);a.connect(b.worker);b.connect(a.worker);
    await a.worker.configure(endpoint,true);await b.worker.publish(alice.address);
    const id=await a.sendFile(new Uint8Array([1,2,3]));a.chats().byPeer[bob.address].messages[0].deliveryIssue='node_unavailable';
    await a.worker.poll();await a.worker.settled();
    const waiting=a.chats().byPeer[bob.address].messages[0];expect(waiting.courierStage).toBe('retrying');expect(waiting.delivery).toBe('queued');
    expect(nodeInteractionGroups([waiting],new Set([id]))).toMatchObject({errors:[],transmitting:[],retrying:[waiting]});
    await a.worker.poll();await a.worker.settled();
    expect(seen).toHaveLength(2);expect(seen.every(s=>s.stage==='uploading'&&!s.issue&&s.upload===1&&s.errors===0&&s.label.startsWith('Загружаем на ноду'))).toBe(true);
    expect(a.phases).toContain('preparing');expect(a.phases).toContain('retrying');
    expect(a.chats().byPeer[bob.address].messages[0]).toMatchObject({delivery:'stored',fileProgress:3});
    expect(a.chats().byPeer[bob.address].messages[0].courierStage).toBeUndefined();
    expect(messageStatus(a.chats().byPeer[bob.address].messages[0]).label).toBe('На ноде');
  });

  it('delivers text and files to a fresh unlocked non-member over owner-granted HTTPS with no recipient signaling',async()=>{
    const [alice,bob]=await Promise.all([account(),account()]),endpoint=await start('');
    vi.stubGlobal('fetch',(url:any,init?:RequestInit)=>nativeFetch(String(url).replace('https://queue.example',endpoint.url).replace(/^https:/,'http:'),init));
    const admin=`http://127.0.0.1:${node!.control.address().port}`;
    const code=(await(await nativeFetch(admin+'/status',{headers:{Authorization:'Bearer '+'b'.repeat(64)}})).json()).pairCode;
    await signedNodeRequest(endpoint.url,endpoint.nodeId,alice.identity,alice.address,'/node/join',{code},new AbortController().signal);
    const a=client(alice,bob.address,false,true),b=client(bob,alice.address,false,true);a.connect(b.worker);b.connect(a.worker);
    await a.worker.configure({...endpoint,url:'https://queue.example'},true);await a.worker.publish(bob.address);await b.worker.publish(alice.address);
    b.worker.stop();await b.worker.settled();
    const bytes=Uint8Array.from({length:1024},(_,i)=>i%251),text=a.send('queued while both clients lock'),file=await a.sendFile(bytes);
    await a.worker.poll();await a.worker.settled();expect(node!.courier.stats().messages).toBe(2);a.worker.stop();await a.worker.settled();
    let state=restoreCourierState(b.saved()),chats=b.chats();const files=new Map<string,Uint8Array>(),parts=new Map<string,Uint8Array>();
    const createReceiver=()=>new CourierController({...bob,state:()=>state,update:s=>state=s,chats:()=>chats,persist:async()=>true,publish:async()=>{},delivery:()=>{},error:()=>{},
      receive:m=>{chats=receiveMessage(chats,{...m,direction:'incoming'});},files:{
        load:async(_p,id)=>files.get(id)?.slice()??null,offer:(from,offer,timestamp)=>{chats=receiveMessage(chats,{id:offer.id,from,text:'',timestamp,direction:'incoming',file:offer,fileStatus:'offered'});},
        accepted:()=>true,progress:()=>{},complete:async(_p,id,data)=>{files.set(id,data.slice());chats.byPeer[alice.address].messages.find(m=>m.id===id)!.fileStatus='ready';},
        savePart:async(_p,id,i,data)=>{parts.set(id+':'+i,data.slice());},loadPart:async(_p,id,i)=>parts.get(id+':'+i)?.slice()??null,cleanup:async()=>{}
      }});let receiver=createReceiver();workers.push(receiver);
    expect(state.node).toBeNull();expect(node!.state.value.members.some(m=>m.address===bob.address)).toBe(false);
    await receiver.poll();await receiver.settled();
    expect(chats.byPeer[alice.address].messages.map(m=>m.id)).toContain(text);
    expect(state.incomingFiles.find(r=>r.job.body.id===file)?.source?.grant.body.to).toBe(bob.address);
    // A second fresh unlock must reconstruct the HTTPS file route from durable state.
    receiver.stop();await receiver.settled();state=restoreCourierState(state);receiver=createReceiver();workers.push(receiver);await receiver.poll();await receiver.settled();
    expect(files.get(file)).toEqual(bytes);expect(node!.courier.stats().messages).toBe(0);expect(node!.courier.attachments.stats().files).toBe(0);
    expect(node!.state.value.members).toHaveLength(1);expect(sockets).toHaveLength(0);
  });

  it('releases node copies after direct text/file receipt through the real signed HTTP API',async()=>{
    vi.stubGlobal('fetch',(url:any,init?:RequestInit)=>nativeFetch(String(url).replace(/^https:/,'http:'),init));
    const [alice,bob]=await Promise.all([account(),account()]),endpoint=await start('');
    const admin=`http://127.0.0.1:${node!.control.address().port}`;
    const code=(await(await nativeFetch(admin+'/status',{headers:{Authorization:'Bearer '+'b'.repeat(64)}})).json()).pairCode;
    await signedNodeRequest(endpoint.url,endpoint.nodeId,alice.identity,alice.address,'/node/join',{code},new AbortController().signal);
    const a=client(alice,bob.address,false,true),b=client(bob,alice.address,false,true);a.connect(b.worker);b.connect(a.worker);
    await a.worker.configure(endpoint,true);await b.worker.publish(alice.address);
    const text=a.send('direct fallback'),file=await a.sendFile(new Uint8Array([1,2,3]));
    await a.worker.poll();await a.worker.settled();expect(node!.courier.stats().messages).toBe(2);expect(node!.courier.attachments.stats().files).toBe(1);
    a.state().pending=a.state().pending.filter(j=>j.body.id!==file);delete a.state().outgoingFiles[file]; // lost local reservation must go through /outbox/list
    for(const m of a.chats().byPeer[bob.address].messages){m.delivery='delivered';if(m.file)m.fileStatus='ready';}
    const time=vi.spyOn(Date,'now').mockReturnValue(Date.now()+16000);
    try{await a.worker.poll();await a.worker.settled();}finally{time.mockRestore();}
    expect(node!.courier.stats().messages).toBe(0);expect(node!.courier.attachments.stats().files).toBe(0);
    expect(a.state().pending).toHaveLength(0);expect(a.chats().byPeer[bob.address].messages.map(m=>m.id)).toEqual([text,file]);
  });

  it('cancels a staged file, frees its reserved quota and does not schedule it again', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(url.replace(/^https:/, 'http:'), init));
    const [alice, bob] = await Promise.all([account(), account()]); const endpoint = await start('');
    const admin = `http://127.0.0.1:${(node!.control.address() as { port: number }).port}`;
    const code = (await (await nativeFetch(`${admin}/status`, { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } })).json()).pairCode;
    await signedNodeRequest(endpoint.url, endpoint.nodeId, alice.identity, alice.address, '/node/join', { code }, new AbortController().signal);
    const a = client(alice, bob.address, true, true), b = client(bob, alice.address, false, true); a.connect(b.worker); b.connect(a.worker);
    await b.worker.publish(alice.address); await a.worker.configure(endpoint, true);
    const id = await a.sendFile(new Uint8Array(ATTACHMENT_CHUNK_BYTES * 8 + 1)); await a.worker.poll();
    expect(node!.courier.stats().attachments.files).toBe(1); expect(node!.courier.stats().messages).toBe(0);
    a.chats().byPeer[bob.address].messages[0].fileStatus = 'canceled'; await a.worker.cancelFile(id); await a.worker.poll();
    expect(node!.courier.stats().attachments).toMatchObject({ files: 0, bytes: 0, uploading: 0 }); expect(node!.courier.stats().messages).toBe(0);
    expect(a.state().pending).toHaveLength(0); expect(a.state().outgoingFiles[id]).toBeUndefined(); expect(Object.keys(a.state().used)).toHaveLength(1);
  }, 15000);
  it.each(['lan', 'internet'])('delivers encrypted files through %s after sender closes, node restarts and recipient explicitly accepts', async route => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(url.replace(/^https:/, 'http:'), init));
    let relayUrl = '';
    if (route === 'internet') { relay = createSignalingServer({ port: 0, host: '127.0.0.1', path: '/signal' }); await once(relay, 'listening'); relayUrl = `ws://127.0.0.1:${(relay.address() as { port: number }).port}/signal`; }
    const [alice, bob, evil] = await Promise.all([account(), account(), account()]); let endpoint = await start(relayUrl);
    const admin = `http://127.0.0.1:${(node!.control.address() as { port: number }).port}`;
    const code = (await (await nativeFetch(`${admin}/status`, { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } })).json()).pairCode;
    await signedNodeRequest(endpoint.url, endpoint.nodeId, alice.identity, alice.address, '/node/join', { code }, new AbortController().signal);
    const a = client(alice, bob.address, route === 'lan', true), b = client(bob, alice.address, false, true); a.connect(b.worker); b.connect(a.worker);
    await b.worker.publish(alice.address); await a.worker.configure(endpoint, true);
    const bytes = crypto.getRandomValues(new Uint8Array(40000)); const id = await a.sendFile(bytes); await a.worker.poll();
    expect(a.chats().byPeer[bob.address].messages[0].delivery).toBe('stored'); expect(node!.courier.stats().attachments.files).toBe(1);
    expect(Object.keys(a.state().used)).toHaveLength(1); expect(restoreCourierState(a.saved()).outgoingFiles[id]).toBeDefined();
    const job = a.state().pending[0], manifest = a.state().outgoingFiles[id];
    const serialized = JSON.stringify(node!.courier.decode([...node!.courier.box.records.values()][0])); expect(serialized).not.toContain('private-video.mp4'); expect(serialized).not.toContain(manifest.key);
    await expect(signedNodeRequest(endpoint.url, endpoint.nodeId, evil.identity, evil.address, '/outbox/file/part', { id: manifest.attachment.id, index: 0, cipher: 'aaaa' }, new AbortController().signal)).rejects.toThrow('not_member');
    a.worker.stop(); await node!.close(); node = undefined; endpoint = await start(relayUrl, endpoint.port);
    await vi.waitFor(() => expect(node!.courier.stats().routes[route]).toBe('connected'));
    const ws = await register(route === 'lan' ? `ws://127.0.0.1:${endpoint.port}/signal` : relayUrl, bob), failures: unknown[] = [];
    const deliveries = attachFileReceiver(ws, b.worker, failures);
    await vi.waitFor(() => expect(b.state().incomingFiles).toHaveLength(1)); await b.worker.poll();
    expect(b.parts.size).toBe(0); expect(node!.courier.stats().messages).toBe(1); expect(b.state().keys).toHaveLength(PREKEY_TARGET-1);
    b.reload(); expect(restoreCourierState(b.state()).incomingFiles[0].manifest.offer.size).toBe(bytes.length);
    b.acceptFiles(true); await b.worker.poll();
    // Receipt acknowledgement precedes asynchronous disk attachment cleanup.
    // Wait for both effects rather than racing the final unlink operations.
    await vi.waitFor(() => {
      expect(node!.courier.stats().messages).toBe(0);
      expect(node!.courier.stats().attachments).toMatchObject({ files: 0, bytes: 0, uploading: 0 });
    });
    expect(failures).toEqual([]); expect(b.files.get(id)).toEqual(bytes); expect(b.parts.size).toBe(0); expect(b.state().incomingFiles).toHaveLength(0); expect(b.state().acks).toHaveLength(1);
    expect(node!.courier.stats().attachments).toMatchObject({ files: 0, bytes: 0, uploading: 0 });
    await b.worker.receive(deliveries[0], () => {}); expect(b.chats().byPeer[alice.address].messages).toHaveLength(1);
    expect(job.body.lanOnly ?? false).toBe(route === 'lan');
  }, 20000);
  it('resumes a partly uploaded file without another prekey and never reports stored early', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(url.replace(/^https:/, 'http:'), init));
    const [alice, bob] = await Promise.all([account(), account()]); const endpoint = await start('');
    const admin = `http://127.0.0.1:${(node!.control.address() as { port: number }).port}`;
    const code = (await (await nativeFetch(`${admin}/status`, { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } })).json()).pairCode;
    await signedNodeRequest(endpoint.url, endpoint.nodeId, alice.identity, alice.address, '/node/join', { code }, new AbortController().signal);
    const a = client(alice, bob.address, true, true), b = client(bob, alice.address, false, true); a.connect(b.worker); b.connect(a.worker);
    await b.worker.publish(alice.address); await a.worker.configure(endpoint, true);
    const id = await a.sendFile(new Uint8Array(ATTACHMENT_CHUNK_BYTES * 8 + 1).fill(42)); await a.worker.poll();
    expect(node!.courier.stats().messages).toBe(0); expect(a.chats().byPeer[bob.address].messages[0].delivery).toBe('queued');
    const pending = structuredClone(a.state().pending[0]), manifest = structuredClone(a.state().outgoingFiles[id]);
    await node!.close(); node = undefined; await start('', endpoint.port); a.reload(); await a.worker.poll();
    expect(a.state().pending[0]).toEqual(pending); expect(a.state().outgoingFiles[id]).toEqual(manifest); expect(Object.keys(a.state().used)).toHaveLength(1);
    expect(node!.courier.stats().messages).toBe(1); expect(a.chats().byPeer[bob.address].messages[0].delivery).toBe('stored');
  }, 15000);
  it('resumes durable received parts after lock and failed commits, without early receipt or a second message', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(url.replace(/^https:/, 'http:'), init));
    const [alice, bob] = await Promise.all([account(), account()]); const endpoint = await start('');
    const admin = `http://127.0.0.1:${(node!.control.address() as { port: number }).port}`;
    const code = (await (await nativeFetch(`${admin}/status`, { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } })).json()).pairCode;
    await signedNodeRequest(endpoint.url, endpoint.nodeId, alice.identity, alice.address, '/node/join', { code }, new AbortController().signal);
    const a = client(alice, bob.address, true, true), b = client(bob, alice.address, false, true); a.connect(b.worker); b.connect(a.worker);
    await b.worker.publish(alice.address); await a.worker.configure(endpoint, true);
    const bytes = new Uint8Array(ATTACHMENT_CHUNK_BYTES * 8 + 3).fill(51), id = await a.sendFile(bytes); await a.worker.poll(); await a.worker.poll();
    const ws = await register(`ws://127.0.0.1:${endpoint.port}/signal`, bob), failures: unknown[] = []; attachFileReceiver(ws, b.worker, failures);
    await vi.waitFor(() => expect(b.state().incomingFiles).toHaveLength(1)); b.acceptFiles(true); b.fail(true);
    await expect(b.worker.poll()).rejects.toThrow('courier_not_saved'); expect(node!.courier.stats().messages).toBe(1); expect(b.parts.size).toBe(1);
    b.reload(); b.fail(false); await b.worker.poll(); expect(b.saved().incomingFiles[0].nextIndex).toBe(8); expect(node!.courier.stats().messages).toBe(1);
    // The downloaded key/progress are inside the authenticated encrypted archive.
    const storeKey = await deriveChatStoreKey(bob.seed, bob.address);
    const data: LocalChatData = { selfNickname: '', readReceiptsEnabled: true, autoLockMinutes: 5, peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {}, chats: { order: [], byPeer: {} }, courierState: b.saved() };
    const sealed = await sealChatData(storeKey, bob.address, data);
    expect(new TextDecoder().decode(sealed.cipher)).not.toContain(b.saved().incomingFiles[0].manifest.key);
    expect((await openSealedChatData(storeKey, bob.address, sealed)).courierState?.incomingFiles[0].nextIndex).toBe(8);
    b.reload(); await b.worker.poll(); await vi.waitFor(() => expect(node!.courier.stats().messages).toBe(0));
    expect(b.files.get(id)).toEqual(bytes); expect(b.chats().byPeer[alice.address].messages).toHaveLength(1); expect(failures).toEqual([]);
  }, 20000);
  it('delivers a persisted LAN-only queue after sender closes and recipient unlocks; no Internet relay exists', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(url.replace(/^https:/, 'http:'), init));
    const [alice, bob] = await Promise.all([account(), account()]); let endpoint = await start('');
    const admin = `http://127.0.0.1:${(node!.control.address() as { port: number }).port}`;
    const code = (await (await nativeFetch(`${admin}/status`, { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } })).json()).pairCode;
    await signedNodeRequest(endpoint.url, endpoint.nodeId, alice.identity, alice.address, '/node/join', { code }, new AbortController().signal);
    const a = client(alice, bob.address, true), b = client(bob, alice.address); a.connect(b.worker); b.connect(a.worker);
    await b.worker.publish(alice.address); await a.worker.configure(endpoint, true);
    const ids = Array.from({ length: 7 }, (_, i) => a.send(`LAN secret ${i}`)); await a.worker.poll();
    expect(a.state().pending.every(job => job.body.lanOnly)).toBe(true);
    expect(node!.courier.stats()).toMatchObject({ messages: 7, relay: '', enabled: true });
    const address = endpoint.address, port = endpoint.port; a.worker.stop();
    await node!.close(); node = undefined; endpoint = await start('', port);
    expect(endpoint.address).toBe(address); expect(node!.courier.stats().messages).toBe(7);
    await vi.waitFor(() => expect(node!.courier.stats().routes).toEqual({ lan: 'connected', internet: 'disabled', localInternet: 'disabled' }));
    const ws = await register(`ws://127.0.0.1:${port}/signal`, bob); const failures: unknown[] = [];
    ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type !== 'courier_delivery') return;
      void b.worker.receive(m, (id, receipt) => ws.send(JSON.stringify({ type: 'courier_receipt', to: m.from, id, receipt }))).catch(e => failures.push(e)); });
    await vi.waitFor(() => expect(node!.courier.stats().messages).toBe(0), { timeout: 5000 });
    expect(failures).toEqual([]); expect(b.chats().byPeer[alice.address].messages.map(m => m.id).sort()).toEqual(ids.sort());
    expect(b.state().acks).toHaveLength(7);
  }, 15000);
  it('uses the same durable queue across LAN and Internet and enforces signed LAN-only policy', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(url.replace(/^https:/, 'http:'), init));
    relay = createSignalingServer({ port: 0, host: '127.0.0.1', path: '/signal' }); await once(relay, 'listening');
    const relayUrl = `ws://127.0.0.1:${(relay.address() as { port: number }).port}/signal`;
    const [alice, bob] = await Promise.all([account(), account()]); const endpoint = await start(relayUrl);
    const admin = `http://127.0.0.1:${(node!.control.address() as { port: number }).port}`;
    const code = (await (await nativeFetch(`${admin}/status`, { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } })).json()).pairCode;
    await signedNodeRequest(endpoint.url, endpoint.nodeId, alice.identity, alice.address, '/node/join', { code }, new AbortController().signal);
    const a = client(alice, bob.address, true), b = client(bob, alice.address); a.connect(b.worker); b.connect(a.worker);
    await b.worker.publish(alice.address); await a.worker.configure(endpoint, true);
    a.send('LAN only'); await a.worker.poll(); a.worker.stop();
    await vi.waitFor(() => expect(node!.courier.stats().routes).toEqual({ lan: 'connected', internet: 'connected', localInternet: 'disabled' }));
    const internet = await register(relayUrl, bob); const internetFrames: any[] = [];
    internet.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'courier_delivery') internetFrames.push(m); });
    await node!.courier.flush();
    expect(node!.courier.routes.get('internet')!.watched.has(bob.address)).toBe(false);
    expect(internetFrames).toEqual([]); expect(node!.courier.stats().messages).toBe(1);
    const changed = structuredClone(a.state().pending[0]); changed.body.lanOnly = false;
    await expect(node!.courier.put(alice.address, changed)).rejects.toThrow('invalid_courier_signature');
    const lan = await register(`ws://127.0.0.1:${endpoint.port}/signal`, bob); const received: any[] = [];
    const accept = (ws: WebSocket) => (raw: Buffer) => { const m = JSON.parse(raw.toString()); if (m.type !== 'courier_delivery') return;
      received.push(m); void b.worker.receive(m, (id, receipt) => ws.send(JSON.stringify({ type: 'courier_receipt', to: m.from, id, receipt }))); };
    lan.on('message', accept(lan));
    await vi.waitFor(() => expect(node!.courier.stats().messages).toBe(0));
    expect(received).toHaveLength(1); expect(internetFrames).toEqual([]);
    // A new sender session in combined mode uses Internet after recipient leaves LAN.
    lan.close(); await once(lan, 'close');
    const a2 = client(alice, bob.address), b2 = client(bob, alice.address); a2.connect(b2.worker); b2.connect(a2.worker);
    await b2.worker.publish(alice.address); await a2.worker.configure(endpoint, true);
    internet.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type !== 'courier_delivery') return;
      void b2.worker.receive(m, (id, receipt) => internet.send(JSON.stringify({ type: 'courier_receipt', to: m.from, id, receipt }))); });
    a2.send('Internet fallback'); await a2.worker.poll(); a2.worker.stop();
    await vi.waitFor(() => expect(node!.courier.stats().messages).toBe(0));
    expect(b2.chats().byPeer[alice.address].messages[0].text).toBe('Internet fallback');
  }, 15000);
  it('stores and delivers a burst of seven without sender online or head-of-queue starvation', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(url.replace(/^https:/, 'http:'), init));
    relay = createSignalingServer({ port: 0, host: '127.0.0.1', path: '/signal' }); await once(relay, 'listening');
    const relayUrl = `ws://127.0.0.1:${(relay.address() as { port: number }).port}/signal`;
    const [alice, bob] = await Promise.all([account(), account()]); const endpoint = await start(relayUrl);
    const admin = `http://127.0.0.1:${(node!.control.address() as { port: number }).port}`;
    const code = (await (await nativeFetch(`${admin}/status`, { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } })).json()).pairCode;
    await signedNodeRequest(endpoint.url, endpoint.nodeId, alice.identity, alice.address, '/node/join', { code }, new AbortController().signal);
    const a = client(alice, bob.address), b = client(bob, alice.address); a.connect(b.worker); b.connect(a.worker);
    await b.worker.publish(alice.address); await a.worker.configure(endpoint, true);
    const ids = Array.from({ length: 7 }, (_, i) => a.send(`burst ${i}`)); await a.worker.poll();
    expect(a.chats().byPeer[bob.address].messages.filter(m => m.delivery === 'stored')).toHaveLength(7);
    expect(node!.courier.stats().messages).toBe(7); a.worker.stop();
    await vi.waitFor(() => expect(node!.courier.status).toBe('connected'));
    const ws = await register(relayUrl, bob); const failures: unknown[] = [];
    ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type !== 'courier_delivery') return;
      void b.worker.receive(m, (id, receipt) => ws.send(JSON.stringify({ type: 'courier_receipt', to: m.from, id, receipt }))).catch(e => failures.push(e)); });
    await vi.waitFor(() => expect(node!.courier.stats().messages).toBe(0), { timeout: 5000 });
    expect(failures).toEqual([]); expect(b.chats().byPeer[alice.address].messages.map(m => m.id).sort()).toEqual(ids.sort());
    expect(b.state().acks).toHaveLength(7); expect(b.state().keys).toHaveLength(PREKEY_TARGET-7);
  }, 15000);
  it('survives restart, delivers without sender or recipient node, and retains only verified receipts', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(url.replace(/^https:/, 'http:'), init));
    relay = createSignalingServer({ port: 0, host: '127.0.0.1', path: '/signal' }); await once(relay, 'listening');
    const relayUrl = `ws://127.0.0.1:${(relay.address() as { port: number }).port}/signal`;
    const [alice, bob, evil] = await Promise.all([account(), account(), account()]); let endpoint = await start(relayUrl);
    const request = (who: typeof alice, path: string, body = {}) => signedNodeRequest(endpoint.url, endpoint.nodeId, who.identity, who.address, path, body, new AbortController().signal);
    const admin = `http://127.0.0.1:${(node!.control.address() as { port: number }).port}`;
    const code = (await (await nativeFetch(`${admin}/status`, { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } })).json()).pairCode;
    await request(alice, '/node/join', { code });
    await expect(request(evil, '/outbox/status')).rejects.toThrow('not_member');
    const a = client(alice, bob.address), b = client(bob, alice.address); a.connect(b.worker); b.connect(a.worker);
    await b.worker.publish(alice.address); expect(b.state().node).toBeNull();
    await a.worker.configure(endpoint, true); const id = a.send('queued secret'); await a.worker.poll();
    expect(a.state().pending).toHaveLength(1); const job = structuredClone(a.state().pending[0]);
    await a.worker.poll(); expect(a.chats().byPeer[bob.address].messages[0].delivery).toBe('stored');
    expect(node!.courier.stats().messages).toBe(1); a.worker.stop(); // Original sender is not connected at all.
    const originalAddress = node!.courier.address; const port = endpoint.port; await node!.close(); node = undefined;
    endpoint = await start(relayUrl, port); expect(endpoint.address).toBe(originalAddress); expect(node!.courier.stats().messages).toBe(1);
    await vi.waitFor(() => expect(node!.courier.status).toBe('connected'));
    const ws = await register(relayUrl, bob); const deliveries: CourierDelivery[] = []; const failures: unknown[] = [];
    b.fail(true);
    ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type !== 'courier_delivery') return; deliveries.push(m);
      void b.worker.receive(m, (id, receipt) => ws.send(JSON.stringify({ type: 'courier_receipt', to: m.from, id, receipt }))).catch(e => failures.push(e)); });
    await vi.waitFor(() => expect(deliveries.length).toBeGreaterThan(0), { timeout: 5000 });
    await b.worker.settled();
    // settled() drains the internal queue; the receive().catch() observer above
    // runs on a later promise turn. Wait for it rather than racing the observer.
    await vi.waitFor(() => expect(failures).toHaveLength(1)); expect(node!.courier.stats().messages).toBe(1);
    const forged = await signCourier('receipt', { protocol: COURIER_PROTOCOL, from: bob.address, to: alice.address, id, digest: await cipherDigest(job.body.packet) }, evil.identity);
    await expect(node!.courier.acceptReceipt({ from: bob.address, id: id.replaceAll('-', ''), receipt: JSON.stringify(forged) })).rejects.toThrow('invalid_courier_signature');
    expect(node!.courier.stats().messages).toBe(1);
    expect(b.state().keys.some(k => k.id === JSON.parse(Buffer.from(job.body.packet, 'base64url').toString()).body.keyId)).toBe(false);
    // Failed persistence never acknowledges; retry commits the retained message+tombstone first.
    b.fail(false); await b.worker.receive(deliveries[0], (id, receipt) => ws.send(JSON.stringify({ type: 'courier_receipt', to: originalAddress, id, receipt })));
    await vi.waitFor(() => expect(node!.courier.stats().messages).toBe(0));
    expect(b.chats().byPeer[alice.address].messages).toHaveLength(1);
    expect(b.chats().byPeer[alice.address].messages[0]).toMatchObject({ text: 'queued secret', from: alice.address, courierVia: originalAddress });
    b.reload(); await b.worker.receive(deliveries[0], () => {}); expect(b.chats().byPeer[alice.address].messages).toHaveLength(1);
    const records = await readdir(join(directory, 'outbox'));
    const record = JSON.parse(await readFile(join(directory, 'outbox', records.find(r => r.endsWith('.json'))!), 'utf8'));
    expect(record.ciphertext).toBeUndefined(); expect(record.receipt).toBeTruthy();
    const receipt = record.receipt;
    await expect(node!.courier.put(evil.address, job)).rejects.toThrow('invalid_courier_author');
    await expect(b.worker.receive({ ...deliveries[0], from: evil.address }, () => {})).rejects.toThrow();
    await expect(request(evil, '/outbox/put', { job })).rejects.toThrow('not_member');
    expect(JSON.parse(receipt).signature).not.toBe(forged.signature);
    b.chats().byPeer[alice.address].contact = 'blocked'; let blockedAck = false;
    await b.worker.receive(deliveries[0], () => { blockedAck = true; }); expect(blockedAck).toBe(false);
    const cryptoKey = await deriveChatStoreKey(bob.seed, bob.address);
    const data: LocalChatData = { selfNickname: '', readReceiptsEnabled: true, autoLockMinutes: 5, peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {},
      chats: { order: [], byPeer: {} }, courierState: b.saved() };
    const reopened = await openSealedChatData(cryptoKey, bob.address, await sealChatData(cryptoKey, bob.address, data));
    expect(reopened.courierState?.acks).toHaveLength(1); expect(reopened.courierState?.keys).toHaveLength(PREKEY_TARGET-1);
    // Sender can reopen later and independently verify the durable recipient receipt.
    const a2 = new CourierController({ address: alice.address, identity: alice.identity, state: a.state, update: s => Object.assign(a.state(), s),
      chats: a.chats, persist: async () => true, receive: () => {}, delivery: (peer, id, status) => {
        a.chats().byPeer[peer].messages.find(m => m.id === id)!.delivery = status;
      }, publish: async () => {}, error: () => {} }); workers.push(a2);
    await a2.poll(); expect(a.state().pending).toHaveLength(0);
  }, 15000);
});
