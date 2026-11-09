import type {ChatEntry} from './session-chats';
export const queueTerminal=(m:ChatEntry)=>m.direction==='outgoing' && !m.restoredFromBackup && !m.importedFromDevice && !!m.nodeQueue && m.nodeQueue!=='canceling' && !['delivered','read'].includes(m.delivery??'');
export function nodeQueueSummary(messages:readonly ChatEntry[]) {
  messages=messages.filter(m=>!m.radioDelivery);
  const waiting=messages.filter(m=>m.direction==='outgoing'&&!m.restoredFromBackup&&!m.importedFromDevice&&!m.nodeQueue&&m.delivery==='stored');
  const canceling=messages.filter(m=>!m.restoredFromBackup&&!m.importedFromDevice&&m.nodeQueue==='canceling'&&!['delivered','read'].includes(m.delivery??''));
  const stopped=messages.filter(m=>queueTerminal(m)&&!m.nodeQueueDismissed);
  const errors=messages.filter(m=>!m.restoredFromBackup&&!m.importedFromDevice&&!m.nodeQueue&&m.direction==='outgoing'&&!!m.deliveryIssue&&!['stored','delivered','read'].includes(m.delivery??''));
  const local=messages.filter(m=>m.direction==='outgoing'&&!m.nodeQueue&&!m.restoredFromBackup&&!m.importedFromDevice&&!m.localCall&&['queued','sending','sent','saving'].includes(m.delivery??''));
  return {waiting,canceling,stopped,errors,local};
}
export function nextQueueId(ids:readonly string[],previous:string):string|undefined {
  if(!ids.length)return undefined;
  return ids[(ids.indexOf(previous)+1)%ids.length];
}
export function dismissQueueNotices(messages:ChatEntry[]):ChatEntry[] {
  return messages.map(m=>queueTerminal(m)&&!m.nodeQueueDismissed?{...m,nodeQueueDismissed:true}:m);
}
export const queueBytes=(bytes:number)=>bytes<1024*1024?`${Math.ceil(bytes/1024)} КБ`:`${(bytes/1024/1024).toFixed(1)} МБ`;

export function applyNodeOutcome(m:ChatEntry,status:'canceling'|'canceled'|'expired'):ChatEntry {
  if(m.direction!=='outgoing'||['delivered','read'].includes(m.delivery??''))return m;
  return {...m,courierStage:undefined,nodeQueue:status,nodeQueueDismissed:false,deliveryIssue:undefined,deliveryError:undefined,
    ...(m.file?{fileStatus:'canceled' as const,fileProgress:0}: {})};
}
