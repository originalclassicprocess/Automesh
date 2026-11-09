import type {ChatEntry} from './session-chats';
import {deliveryNeedsAction,isDeliveryIssue} from '$lib/application/delivery-issues';
export type CourierStage=NonNullable<ChatEntry['courierStage']>;
export function activeNodeTransfer(m:ChatEntry):boolean{
  return m.direction==='outgoing'&&!m.nodeQueue&&!m.fileDeleted&&!['stored','delivered','read'].includes(m.delivery??'')&&
    !['ready','rejected','canceled'].includes(m.fileStatus??'')&&(m.courierStage==='preparing'||m.courierStage==='uploading');
}
export function effectiveDeliveryIssue(m:ChatEntry){
  const issue=isDeliveryIssue(m.deliveryIssue)?m.deliveryIssue:undefined;
  return issue&&activeNodeTransfer(m)&&!deliveryNeedsAction(issue)?undefined:issue;
}
export function nodeTransferUpdate(m:ChatEntry,stage:CourierStage|undefined):ChatEntry{
  const clear=stage==='uploading'||stage==='preparing'&&!!m.deliveryIssue&&!deliveryNeedsAction(m.deliveryIssue);
  return {...m,courierStage:stage,...clear?{deliveryIssue:undefined,deliveryError:undefined}:{}};
}

// A peer/signaling disconnect must not rewrite a separate HTTPS worker's progress.
export function peerDisconnectedMessage(m:ChatEntry):ChatEntry{
 if(m.courierStage==='uploading')return m;
 return {...m,delivery:m.delivery==='sending'?'queued':m.delivery,
   fileStatus:m.fileStatus==='sending'?'queued':m.fileStatus==='receiving'?'offered':m.fileStatus,
   fileProgress:m.fileStatus==='sending'||m.fileStatus==='receiving'?0:m.fileProgress};
}
