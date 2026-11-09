import { expect, it } from 'vitest';
import type { SignedObject } from '../core/objects';
import { requiresDeviceDelivery, deviceDeliveryExplanation, requirePolicyProgress, reconcileRootOnlyOutbox } from './delivery-plan';
import { emptySessionChats, ensureConversation, recordSentMessage } from '../chat/session-chats';
const roster = (body: object) => ({ publicKey:'public',record: { author:'peer',body: { primary: true, devices: [], ...body } } }) as unknown as SignedObject;
it('does not hijack root-only chats after an empty direct advertisement', () => {
  expect(requiresDeviceDelivery(undefined)).toBe(false); expect(requiresDeviceDelivery(roster({}))).toBe(false);
});
it('never downgrades node-bound, revoked, expired or disabled-primary device policy', () => {
  for (const body of [{ directory: {} }, { primary: false }, { devices: [{ revokedAt: 1 }] }, { devices: [{ certificate: { expiresAt: 1 } }] }])
    expect(requiresDeviceDelivery(roster(body))).toBe(true);
});
it('explains unavailable owners without exposing arbitrary server text', () => {
  expect(deviceDeliveryExplanation(new Error('device_owner_unavailable'))).toContain('свежую проверку');
  expect(deviceDeliveryExplanation(new Error('secret-token https://private.invalid'))).not.toContain('secret');
});
it('rejects an older or empty hint after device authorization was observed', () => {
  const first=roster({sequence:3,devices:[{certificate:{record:{id:'one'}},revokedAt:1}]});
  expect(()=>requirePolicyProgress(first,roster({sequence:2}))).toThrow('rollback');
  expect(()=>requirePolicyProgress(first,roster({sequence:4}))).toThrow('rollback');
  expect(()=>requirePolicyProgress(first,first)).not.toThrow();
});
it('repairs only queued primary text misrouted by empty adverts, preserving IDs and restored history', () => {
  let chats=ensureConversation(emptySessionChats(),'peer');
  for(const [id,delivery,restored] of [['one','queued',false],['two','stored',false],['three','queued',true]] as const)
    chats=recordSentMessage(chats,'peer',{id,from:'self',text:id,timestamp:1,direction:'outgoing',delivery,deviceMessage:true,restoredFromBackup:restored});
  const next=reconcileRootOnlyOutbox(chats,[roster({})]);
  expect(next.byPeer.peer.messages.map(m=>m.deviceMessage)).toEqual([false,true,true]);
  expect(next.byPeer.peer.messages.map(m=>m.id)).toEqual(['one','two','three']);
  expect(chats.byPeer.peer.messages[0].deviceMessage).toBe(true);
  expect(reconcileRootOnlyOutbox(chats,[roster({devices:[{}]})])).toBe(chats);
});
