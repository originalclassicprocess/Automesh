import type { ChatEntry } from './session-chats';
import { nodeQueueSummary } from './node-queue';
import {activeNodeTransfer,effectiveDeliveryIssue} from './node-transfer';
import {deliveryNeedsAction} from '$lib/application/delivery-issues';

export const nodeQueueCategories = [
  { id:'waiting', label:'На ноде', tone:'success', detail:'Нода приняла эти сообщения. Они ждут получения собеседником.', empty:'На ноде нет сообщений, ожидающих получения.' },
  { id:'transmitting', label:'Отправляем', tone:'warning', detail:'Готовим и загружаем сообщения на ноду. До подтверждения приёма оставьте приложение открытым.', empty:'Сейчас ничего не готовится и не передаётся ноде.' },
  { id:'retrying', label:'Ожидают', tone:'warning', detail:'Ждём соединения, ключей или разрешения на следующий запрос. Повторяем автоматически; оставьте приложение открытым.', empty:'Нет отправок, ожидающих автоматического повтора.' },
  { id:'errors', label:'Требуют действия', tone:'danger', detail:'Отправка остановлена из-за квоты, прав доступа или локального сохранения. Причина указана под чатом; нажмите, чтобы открыть сообщение.', empty:'Нет отправок, требующих действия.' },
  { id:'canceling', label:'Отменяем', tone:'warning', detail:'Ждём подтверждения удаления от ноды. Уже полученную собеседником копию отозвать нельзя.', empty:'Нет запросов на отмену.' },
  { id:'expired', label:'Срок истёк', tone:'danger', detail:'Нода удалила эти отправки по истечении срока доставки. Локальная копия осталась; её можно отправить заново.', empty:'Нет отправок с истёкшим сроком.' },
  { id:'stopped', label:'Отменено вами', tone:'muted', detail:'Вы отменили эти отправки. Нода подтвердила удаление; локальную копию можно отправить заново.', empty:'Нет отменённых вами отправок.' },
] as const;
export type NodeQueueCategory = typeof nodeQueueCategories[number]['id'];
export type NodeQueueGroups = Record<NodeQueueCategory, ChatEntry[]>;
export type NodeQueueChat = { peer:string; name:string; groups:NodeQueueGroups };

// A local/direct outbox is not node activity. Count only node jobs or explicit
// node/key failures, keeping receipts and terminal notices mutually exclusive.
export function nodeInteractionGroups(messages:readonly ChatEntry[], pendingIds:ReadonlySet<string>):NodeQueueGroups {
  const q=nodeQueueSummary(messages);
  const candidates=q.local.filter(m=>!m.fileDeleted&&!['ready','rejected','canceled'].includes(m.fileStatus??'')&&(pendingIds.has(m.id)||m.courierStage||m.deliveryIssue?.startsWith('node_')||m.deliveryIssue?.startsWith('keys_')));
  const errors=candidates.filter(m=>{const code=effectiveDeliveryIssue(m);return code&&deliveryNeedsAction(code,m.deliveryError);});
  const retrying=candidates.filter(m=>{const code=effectiveDeliveryIssue(m);return code&&!deliveryNeedsAction(code,m.deliveryError)||!code&&!activeNodeTransfer(m)&&(pendingIds.has(m.id)||m.courierStage==='retrying');});
  const transmitting=candidates.filter(m=>!effectiveDeliveryIssue(m)&&m.courierStage!=='retrying'&&activeNodeTransfer(m));
  return { waiting:q.waiting, transmitting, retrying, errors, canceling:q.canceling, expired:q.stopped.filter(m=>m.nodeQueue==='expired'),stopped:q.stopped.filter(m=>m.nodeQueue==='canceled') };
}
export function nodeInteractionCounts(chats:readonly NodeQueueChat[]):Record<NodeQueueCategory,number> {
  return Object.fromEntries(nodeQueueCategories.map(({id})=>[id,chats.reduce((sum,c)=>sum+c.groups[id].length,0)])) as Record<NodeQueueCategory,number>;
}
