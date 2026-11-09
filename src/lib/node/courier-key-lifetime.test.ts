import {it,expect,vi,afterEach} from 'vitest';
import {WebCryptoIdentity} from '$lib/identity/webcrypto';
import {accountIdFromPublicKey} from '$lib/addressing/account-id.js';
import {COURIER_PROTOCOL,COURIER_TTL} from './courier-protocol.js';
import {createCourierJob,generateCourierKey,openCourier,signCourier} from './courier-crypto';
import {cipherDigest} from './offline-crypto';
import {emptyCourierState,restoreCourierState} from './courier-state';
import {generatePrekey,signObject,sealOffline,openOffline,unbase64} from './offline-crypto';
import {encodeChatContent} from '$lib/chat/message-details';
import {emptyOfflineState,restoreOfflineState} from './offline-state';
afterEach(()=>vi.restoreAllMocks());
it('keeps a seven-day envelope decryptable after the publication window ends, including restored state',async()=>{
  const a=new WebCryptoIdentity(),b=new WebCryptoIdentity(),node=new WebCryptoIdentity();await Promise.all([a.create(),b.create(),node.create()]);
  try{
    let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
    const [from,to,courier]=await Promise.all([a,b,node].map(async identity=>accountIdFromPublicKey(await identity.getPublicKeyBytes())));
    const publishUntil=now+86400000,key=await generateCourierKey(from,publishUntil,{retainUntil:publishUntil+COURIER_TTL});
    const bundle=await signCourier('prekeys',{protocol:COURIER_PROTOCOL,from:to,to:from,expiresAt:publishUntil,retainUntil:key.expiresAt,deliveryTtlMs:COURIER_TTL,
      keys:[{id:key.id,publicKey:key.publicKey}]},b);
    const job=await createCourierJob(a,from,courier,bundle,key,crypto.randomUUID(),now,'delayed');expect(job.body.expiresAt).toBe(now+COURIER_TTL);
    const restored=restoreCourierState({...emptyCourierState(),keys:[key]}).keys[0];now+=3*86400000;
    const hop=await signCourier('hop',{protocol:COURIER_PROTOCOL,courier,id:job.body.id,digest:await cipherDigest(job.body.packet)},node);
    expect((await openCourier(job,hop,restored,to)).content).toBe('delayed');
    await expect(createCourierJob(a,from,courier,bundle,key,crypto.randomUUID(),now,'new')).rejects.toThrow('invalid_courier_bundle');
    const corrupt={...restored,expiresAt:restored.expiresAt-1};expect(()=>restoreCourierState({...emptyCourierState(),keys:[corrupt]})).toThrow('invalid_prekey_lifetime');
  }finally{a.dispose();b.dispose();node.dispose();}
});
it('also separates publication and delivery deadlines on the compatible opaque-mailbox path',async()=>{
  const a=new WebCryptoIdentity(),b=new WebCryptoIdentity();await Promise.all([a.create(),b.create()]);
  try{
    let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
    const [from,to]=await Promise.all([a,b].map(async identity=>accountIdFromPublicKey(await identity.getPublicKeyBytes())));
    const node={url:'https://localhost:3003',nodeId:'a'.repeat(32)},publishUntil=now+86400000;
    const key=await generatePrekey(from,node.nodeId,publishUntil,publishUntil+COURIER_TTL);
    const bundle=await signObject({version:1 as const,from:to,to:from,node,expiresAt:publishUntil,retainUntil:key.expiresAt,deliveryTtlMs:COURIER_TTL,
      keys:[{id:key.id,publicKey:key.publicKey}]},'prekeys',b);
    const id=crypto.randomUUID(),content=encodeChatContent('mailbox delayed');
    const encoded=await sealOffline(a,from,bundle,key,id,now,content),packet=JSON.parse(new TextDecoder().decode(unbase64(encoded)));
    expect(packet.body.expiresAt).toBe(now+COURIER_TTL);now+=3*86400000;
    const restored=restoreOfflineState({...emptyOfflineState(),keys:[key]}).keys[0];
    expect((await openOffline(encoded,restored,to,node.nodeId,id.replaceAll('-',''),packet.body.expiresAt)).content).toBe(content);
  }finally{a.dispose();b.dispose();}
});
