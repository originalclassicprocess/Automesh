export type MessageQuota={profileMessages:number;profileMessageLimit:number;profileMessageBytes:number;profileMessageByteLimit:number;nodeMessages:number;nodeMessageLimit:number;nodeRecords:number;nodeRecordLimit:number};
export type QueueQuota = { protocol:'automesh-queue-quota-v1';profileFiles:number;profileFileLimit:number;nodeFiles:number;nodeFileLimit:number;reservedBytes:number;maxBytes:number } & Partial<MessageQuota>;
export type QueueSnapshot = { checkedAt:number;messages:number;quota?:QueueQuota };
const number=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
export function readQueueSnapshot(raw:unknown,now=Date.now()):QueueSnapshot|undefined {
  if(!raw||typeof raw!=='object')return;
  const value=raw as Record<string,unknown>;
  if(!number(value.messages))return;
  const q=value.quota as QueueQuota|undefined;
  const valid=q?.protocol==='automesh-queue-quota-v1'&&[q.profileFiles,q.profileFileLimit,q.nodeFiles,q.nodeFileLimit,q.reservedBytes,q.maxBytes].every(number);
  const capacity=readMessageQuota(q);
  return {checkedAt:now,messages:value.messages,...valid?{quota:{protocol:q!.protocol,profileFiles:q!.profileFiles,profileFileLimit:q!.profileFileLimit,nodeFiles:q!.nodeFiles,nodeFileLimit:q!.nodeFileLimit,reservedBytes:q!.reservedBytes,maxBytes:q!.maxBytes,...capacity}}:{}};
}
export function readMessageQuota(q:QueueQuota|undefined):MessageQuota|undefined{
  const fields=['profileMessages','profileMessageLimit','profileMessageBytes','profileMessageByteLimit','nodeMessages','nodeMessageLimit','nodeRecords','nodeRecordLimit'] as const;
  return q&&fields.every(k=>number(q[k]))?Object.fromEntries(fields.map(k=>[k,q[k]])) as MessageQuota:undefined;
}
export const messageQuotaFull=(q:QueueQuota|undefined)=>!!q&&!!readMessageQuota(q)&&(q.profileMessages!>=q.profileMessageLimit!||q.profileMessageBytes!>=q.profileMessageByteLimit!||q.nodeMessages!>=q.nodeMessageLimit!||q.nodeRecords!>=q.nodeRecordLimit!);
export const freshQueueSnapshot=(snapshot:QueueSnapshot|undefined,now=Date.now())=>!!snapshot&&now-snapshot.checkedAt<=45000&&now>=snapshot.checkedAt-5000;
export function queueQuotaFull(q:QueueQuota|undefined):boolean {
  return !!q&&(q.profileFiles>=q.profileFileLimit||q.nodeFiles>=q.nodeFileLimit||q.reservedBytes>=q.maxBytes||messageQuotaFull(q));
}
export function queueQuotaLabel(q:QueueQuota|undefined):string {
  if(!q)return 'Квота не проверена';
  if(q.profileFiles>=q.profileFileLimit)return 'Квота файлов профиля заполнена';
  if(q.nodeFiles>=q.nodeFileLimit)return 'Файловые слоты ноды заполнены';
  if(q.reservedBytes>=q.maxBytes)return 'Место на ноде заполнено';
  if(messageQuotaFull(q))return 'Квота сообщений заполнена';
  return 'Квота ноды';
}
