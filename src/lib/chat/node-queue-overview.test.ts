import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import { nodeInteractionGroups, nodeInteractionCounts } from './node-queue-overview';
import NodeQueueOverview from './NodeQueueOverview.svelte';
import type { ChatEntry } from './session-chats';

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
