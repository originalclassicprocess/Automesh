import { expect, it } from 'vitest';
import { requirePrimaryRoute, hasDelegatedWork, recoverPrimaryQueued } from './primary-delivery';
import { contactHandshake } from './contact-handshake';
import { deliveryIssueForError, deliveryIssueText, isDeliveryIssue } from './delivery-issues';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { signMembership, MEMBERSHIP_TYPE } from '../devices/membership';
import { DEVICE_DIRECTORY } from '../../../nodes/packages/protocol/src/devices.js';
import { emptySessionChats, ensureConversation, recordSentMessage } from '../chat/session-chats';
import type { SignedObject } from '../core/objects';
const env = {subtle:crypto.subtle,now:()=>1800000000000,newId:()=>crypto.randomUUID()};
it('uses primary keys with a node pin, without delegated devices, even when the hint has expired',async()=>{
  const signer=new WebCryptoIdentity(); await signer.create();
  try {
    const owner=await accountIdFromPublicKey(await signer.getPublicKeyBytes());
    const authority={url:'https://node.example',nodeId:'a'.repeat(32),publicKey:'04'+'b'.repeat(128)};
    const hint=await signMembership({type:DEVICE_DIRECTORY,sequence:1,previous:null,epoch:0,primary:true,devices:[],directory:authority},signer,env);
    await expect(requirePrimaryRoute(owner,owner,[hint],{...env,now:()=>env.now()+40*86400000})).resolves.toBeUndefined();
    expect(hasDelegatedWork(hint,[hint],emptySessionChats())).toBe(false);
    const disabled=await signMembership({type:MEMBERSHIP_TYPE,sequence:1,previous:null,epoch:0,primary:false,devices:[]},signer,env);
    await expect(requirePrimaryRoute(owner,owner,[disabled],env)).rejects.toThrow('primary_disabled');
    const changed=structuredClone(hint); changed.record.body={};
    await expect(requirePrimaryRoute(owner,owner,[changed],env)).rejects.toThrow('primary_policy_invalid');
  } finally { signer.dispose(); }
});
it('keeps actual device work active and only repairs queued primary text, not imported/sync history or stored jobs',()=>{
  let chats=ensureConversation(emptySessionChats(),'peer');
  for(const [id,from,delivery,restored] of [['root','self','queued',false],['stored','self','stored',false],['archive','self','queued',true],['foreign','other','queued',false],['sync','self',undefined,false]] as const)
    chats=recordSentMessage(chats,'peer',{id,from,text:id,timestamp:1,direction:'outgoing',delivery,deviceMessage:true,restoredFromBackup:restored});
  const next=recoverPrimaryQueued(chats,'self',new Set(['peer']));
  expect(next.byPeer.peer.messages.map(m=>m.deviceMessage)).toEqual([false,true,true,true,true]);
  expect(chats.byPeer.peer.messages.every(m=>m.deviceMessage)).toBe(true);
  expect(hasDelegatedWork(null,[],chats)).toBe(true);
  const hint={record:{body:{primary:true,devices:[{revokedAt:1}]}}} as unknown as SignedObject;
  expect(hasDelegatedWork(hint,[],emptySessionChats())).toBe(true);
});
it('confirms existing consent once, without auto-accepting unsolicited requests or ACK loops',()=>{
  for(const state of [undefined,'new','pending','blocked'] as const) for(const signal of ['message','accepted'] as const)
    expect(contactHandshake(state,signal)).toEqual({accept:false,keys:false,confirm:false});
  expect(contactHandshake('accepted','message')).toEqual({accept:false,keys:true,confirm:true});
  expect(contactHandshake('outgoing','accepted')).toEqual({accept:true,keys:true,confirm:true});
  expect(contactHandshake('accepted','accepted')).toEqual({accept:false,keys:true,confirm:false});
});
it('reports only allowlisted reasons, never remote secrets',()=>{
  expect(deliveryIssueForError(new Error('not_member'),'node_unavailable')).toBe('node_denied');
  const issue=deliveryIssueForError(new Error('https://secret.example/?token=secret'),'node_unavailable');
  expect(deliveryIssueText(issue)).not.toContain('secret'); expect(isDeliveryIssue('invented')).toBe(false);
});
