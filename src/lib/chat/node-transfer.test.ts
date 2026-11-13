import {expect,it} from 'vitest';
import {nodeTransferUpdate,peerDisconnectedMessage,fileEntryUpdate} from './node-transfer';
import {emptySessionChats,ensureConversation,saveChats,restoreChats,type ChatEntry} from './session-chats';
import {nodeInteractionGroups} from './node-queue-overview';
const m:ChatEntry={id:'file',from:'me',direction:'outgoing',text:'',timestamp:1,delivery:'queued',fileStatus:'sending',fileProgress:42,deliveryIssue:'node_unavailable'};
it('keeps completed files confirmed after late failures/cancels and still permits local deletion',()=>{
 const done={...m,fileStatus:'ready' as const,delivery:'read' as const};
 for(const fileStatus of ['failed','rejected','canceled','sending','queued'] as const)
   expect(fileEntryUpdate(done,{fileStatus,fileProgress:0,fileAccepted:false})).toEqual(done);
 expect(fileEntryUpdate(done,{fileProgress:0})).toEqual(done);
 expect(fileEntryUpdate(done,{fileDeleted:true})).toMatchObject({fileStatus:'ready',delivery:'read',fileDeleted:true});
 expect(fileEntryUpdate(m,{fileStatus:'ready'}).fileStatus).toBe('ready');
});
it('preserves independent HTTPS progress when signaling disconnects, while resetting an interrupted direct transfer',()=>{
 const upload=nodeTransferUpdate(m,'uploading');expect(upload.deliveryIssue).toBeUndefined();expect(peerDisconnectedMessage(upload)).toBe(upload);
 expect(peerDisconnectedMessage(m)).toMatchObject({fileProgress:0,fileStatus:'queued'});
 expect(nodeTransferUpdate({...m,deliveryIssue:'node_full'},'preparing').deliveryIssue).toBe('node_full');
});
it('never restores runtime activity or labels an unstarted durable reservation as uploading',()=>{
 const state=ensureConversation(emptySessionChats(),'peer');state.byPeer.peer.messages=[{...m,courierStage:'uploading'}];
 const saved=saveChats(state);expect(JSON.stringify(saved)).not.toContain('courierStage');
 expect(restoreChats(saved).byPeer.peer.messages[0].courierStage).toBeUndefined();
 const groups=nodeInteractionGroups([{...m,deliveryIssue:undefined,fileStatus:'queued'}],new Set(['file']));
 expect(groups.transmitting).toHaveLength(0);expect(groups.retrying).toHaveLength(1);
});
