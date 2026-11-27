import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import { groupQueueChats, knownQueueEnvelopes, nodeInteractionGroups, nodeInteractionCounts } from './node-queue-overview';
import NodeQueueOverview from './NodeQueueOverview.svelte';
import type { ChatEntry } from './session-chats';
import type { GroupEntry, GroupRoom } from '$lib/groups/storage';
import { emptyCourierState, type CourierState } from '$lib/node/courier-state';
import { COURIER_PROTOCOL } from '$lib/node/courier-protocol';

const message=(id:string,extra:Partial<ChatEntry>={}):ChatEntry=>({id,from:'me',text:'Private message',direction:'outgoing',timestamp:1,delivery:'queued',...extra});
it('counts node interaction, excluding ordinary direct and local storage activity',()=>{
  const groups=nodeInteractionGroups([
    message('direct'),message('direct-error',{deliveryIssue:'direct_receipt_timeout'}),message('disk',{deliveryIssue:'local_storage'}),
    message('upload',{courierStage:'uploading'}),message('failed-upload',{deliveryIssue:'node_full'}),message('keys',{deliveryIssue:'keys_missing'}),
    message('stored',{delivery:'stored'}),message('cancel',{nodeQueue:'canceling'}),message('expired',{nodeQueue:'expired'}),
    message('hidden',{nodeQueue:'canceled',nodeQueueDismissed:true}),message('received',{nodeQueue:'expired',delivery:'delivered'}),
    message('restored',{delivery:'stored',restoredFromBackup:true}),message('imported',{delivery:'stored',importedFromDevice:true}),
  ],new Set(['upload','failed-upload']));
  expect(groups.transmitting.map(m=>m.id)).toEqual(['upload']);
  expect(groups.errors.map(m=>m.id)).toEqual(['failed-upload']);
  expect(nodeInteractionCounts([{peer:'a',name:'Alice',groups}])).toEqual({waiting:1,transmitting:1,retrying:1,errors:1,canceling:1,expired:1,stopped:0});
});
it('opens with counters only, without message lists, sizes or destructive-looking disabled actions',()=>{
  const chats=[{peer:'a',name:'Alice',groups:nodeInteractionGroups([message('a',{delivery:'stored'})],new Set())}];
  const html=render(NodeQueueOverview,{props:{chats,onOpen:()=>{},onClear:()=>{}}}).body;
  expect(html.match(/aria-expanded="false"/g)).toHaveLength(9);
  expect(html).toContain('На ноде');expect(html).not.toContain('Alice');expect(html).not.toContain('Private message');
  expect(html).not.toContain('МБ');expect(html).not.toContain('disabled');expect(html).not.toContain('Скрыть все');
});

it('counts one group message locally across its card and file envelopes and separates relays', () => {
  const self = 'self', bob = 'bob', carol = 'carol', address = 'node';
  const entry = (from: string, text: string): GroupEntry => ({ from, text, id:crypto.randomUUID(),
    hash:crypto.randomUUID(), packet:'ciphertext', nodeStatus:{ [bob]:'stored' } });
  const own = { ...entry(self, 'Own group file'), nodeFileStatus:{ [carol]:'stored' as const } };
  const relayed = entry(carol, 'Relayed group message');
  const room: GroupRoom = { id:crypto.randomUUID(), title:'Group', owner:self, members:[self,bob,carol], keys:{}, entries:[own,relayed] };
  const state: CourierState = { ...emptyCourierState(), node:{ address, nodeId:'node-id', url:'https://node.example' }, groupJobs:{} };
  const expiresAt = Date.now()+60_000;
  for (const [post, to, file] of [[own,bob,false],[own,carol,true],[relayed,bob,false]] as const) {
    const id = crypto.randomUUID();
    state.groupJobs![id] = { group:room.id, hash:post.hash, ...(file ? { file:true } : {}) };
    state.pending.push({ body:{ protocol:COURIER_PROTOCOL, id, from:self, to, courier:address, packet:'opaque', expiresAt },
      publicKey:'', signature:'' });
  }
  const result = groupQueueChats([room], state, self, () => undefined);
  expect(nodeInteractionCounts(result).waiting).toBe(2);
  expect(knownQueueEnvelopes(result)).toBe(3);
  expect(result[0].groups.waiting.map(item => item.groupJob)).toEqual([
    { relay:false, envelopes:2, target:own.id, expiresAt }, { relay:true, envelopes:1, target:relayed.id, expiresAt },
  ]);
  const confirmed = new Set([state.pending[2].body.id.replaceAll('-', '')]);
  expect(groupQueueChats([room], state, self, () => undefined, confirmed)[0].groups.waiting.map(item => item.id)).toEqual([relayed.id]);
});
