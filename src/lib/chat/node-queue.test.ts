import {it,expect} from 'vitest';
import {nodeQueueSummary,nextQueueId,dismissQueueNotices,applyNodeOutcome} from './node-queue';
import {setDeliveryStatus,emptySessionChats,ensureConversation,type ChatEntry} from './session-chats';
import {messageStatus} from './message-presentation';
const m=(id:string,patch:Partial<ChatEntry>={}):ChatEntry=>({id,text:'test',from:'self',timestamp:1,direction:'outgoing',delivery:'stored',...patch});
it('cycles a filtered queue after additions/removals without skipping the first item',()=>{
 expect(nextQueueId(['a','b'],'')).toBe('a');expect(nextQueueId(['a','b'],'a')).toBe('b');expect(nextQueueId(['a','b'],'b')).toBe('a');expect(nextQueueId(['c'],'b')).toBe('c');expect(nextQueueId([],'')).toBeUndefined();
});
it('clears terminal counters without touching history, active messages or cancellation requests',()=>{
 const rows=[m('a'),m('b',{nodeQueue:'canceled'}),m('c',{nodeQueue:'expired'}),m('d',{nodeQueue:'canceling'}),m('e',{direction:'incoming'})];
 const cleared=dismissQueueNotices(rows);expect(cleared).toHaveLength(5);expect(nodeQueueSummary(cleared)).toMatchObject({waiting:[rows[0]],canceling:[rows[3]],stopped:[]});
 expect(cleared[0]).toBe(rows[0]);expect(cleared[3]).toBe(rows[3]);expect(nodeQueueSummary(rows).stopped).toHaveLength(2);
 expect(messageStatus(cleared[1]).label).toBe('Отменено вами');
});
it('real receipt wins over local cancellation and removes stale counters',()=>{
 let s=ensureConversation(emptySessionChats(),'peer');s.byPeer.peer.messages=[m('x',{nodeQueue:'canceling'})];
 s=setDeliveryStatus(s,'peer','x','delivered');expect(s.byPeer.peer.messages[0].nodeQueue).toBeUndefined();expect(nodeQueueSummary(s.byPeer.peer.messages).stopped).toHaveLength(0);
});

it('text and file outcomes share policy and never override a durable delivery receipt',()=>{
 const canceled=applyNodeOutcome(m('text'),'canceled');expect(canceled.nodeQueue).toBe('canceled');
 expect(applyNodeOutcome(m('ok',{delivery:'delivered'}),'expired').nodeQueue).toBeUndefined();
 const file=m('file',{file:{id:'file',size:10,name:'file',mime:'text/plain',sha256:'a'.repeat(64)}});
 expect(applyNodeOutcome(file,'canceling').fileStatus).toBe('canceled');
});
