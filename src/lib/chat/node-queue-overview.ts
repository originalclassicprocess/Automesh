import type { ChatEntry } from './session-chats';
import { nodeQueueSummary } from './node-queue';
import {activeNodeTransfer,effectiveDeliveryIssue} from './node-transfer';
import {deliveryNeedsAction} from '$lib/application/delivery-issues';
import { applyGroupEdit, groupEdits, groupRecords } from '$lib/groups/actions';
import { groupChatEntry, type GroupDeliveryPhase } from '$lib/groups/presentation';
import { groupVisible, type GroupRoom } from '$lib/groups/storage';
import type { CourierState } from '$lib/node/courier-state';

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
export type NodeQueueItem = ChatEntry & { groupJob?:{ target?:string; relay:boolean; envelopes:number; expiresAt:number } };
export type NodeQueueGroups = Record<NodeQueueCategory, NodeQueueItem[]>;
export type NodeQueueChat = { peer:string; name:string; groups:NodeQueueGroups; group?:true };

export function groupQueueChats(rooms: readonly GroupRoom[], state: CourierState, self: string,
  phase: (group: string, hash: string) => GroupDeliveryPhase | undefined,
  storedIds?: ReadonlySet<string>): NodeQueueChat[] {
  const queued = new Map<string, { stored:number; expiresAt:number }>();
  for (const { body } of state.pending) {
    const ref = state.groupJobs?.[body.id];
    if (!ref || body.from !== self || body.courier !== state.node?.address) continue;
    const room = rooms.find(room => room.id === ref.group);
    const entry = room && groupRecords(room).find(entry => entry.hash === ref.hash);
    if (!entry) continue;
    const status = (ref.file ? entry.nodeFileStatus : entry.nodeStatus)?.[body.to];
    const stored = storedIds?.has(body.id.replaceAll('-', '')) ?? status === 'stored';
    if (!stored && status !== undefined) continue;
    const key = room.id + ':' + entry.hash;
    const item = queued.get(key) ?? { stored:0, expiresAt:body.expiresAt };
    if (stored) item.stored++;
    item.expiresAt = Math.min(item.expiresAt, body.expiresAt);
    queued.set(key, item);
  }
  return rooms.filter(groupVisible).flatMap(room => {
    const groups = nodeInteractionGroups([], new Set());
    const edits = groupEdits(room);
    const originals = new Map(room.entries.map(entry => [entry.id, entry]));
    for (const entry of groupRecords(room)) {
      const item = queued.get(room.id + ':' + entry.hash);
      if (!item) continue;
      const original = entry.action ? (entry.action.targetId ? originals.get(entry.action.targetId) : undefined) : entry;
      const target = original && !original.hidden ? applyGroupEdit(original, edits) : undefined;
      const message = groupChatEntry(target ?? { ...entry, text:'',file:undefined }, self);
      const category = item.stored ? 'waiting' : phase(room.id, entry.hash) === 'sending' ? 'transmitting' : 'retrying';
      groups[category].push({ ...message, id:entry.id, groupJob:{
        target:target?.id, relay:entry.from !== self, envelopes:item.stored, expiresAt:item.expiresAt,
      } });
    }
    if (!groups.waiting.length && !groups.transmitting.length && !groups.retrying.length) return [];
    return [{ peer:room.id, name:room.title, groups, group:true as const }];
  });
}

export function knownQueueEnvelopes(chats: readonly NodeQueueChat[]) {
  return chats.reduce((sum, chat) => sum + chat.groups.waiting.reduce((count, item) =>
    count + (item.groupJob?.envelopes ?? 1), 0), 0);
}

// A local/direct outbox is not node activity. Count only node jobs or explicit
// node/key failures, keeping receipts and terminal notices mutually exclusive.
export function nodeInteractionGroups(messages:readonly ChatEntry[], pendingIds:ReadonlySet<string>, storedIds?:ReadonlySet<string>):NodeQueueGroups {
  const q=nodeQueueSummary(messages);
  const candidates=q.local.filter(m=>!m.fileDeleted&&!['ready','rejected','canceled'].includes(m.fileStatus??'')&&(pendingIds.has(m.id)||m.courierStage||m.deliveryIssue?.startsWith('node_')||m.deliveryIssue?.startsWith('keys_')));
  const errors=candidates.filter(m=>{const code=effectiveDeliveryIssue(m);return code&&deliveryNeedsAction(code,m.deliveryError);});
  const retrying=candidates.filter(m=>{const code=effectiveDeliveryIssue(m);return code&&!deliveryNeedsAction(code,m.deliveryError)||!code&&!activeNodeTransfer(m)&&(pendingIds.has(m.id)||m.courierStage==='retrying');});
  const transmitting=candidates.filter(m=>!effectiveDeliveryIssue(m)&&m.courierStage!=='retrying'&&activeNodeTransfer(m));
  return { waiting:storedIds?q.waiting.filter(m=>storedIds.has(m.id.replaceAll('-',''))):q.waiting,
    transmitting, retrying, errors, canceling:q.canceling, expired:q.stopped.filter(m=>m.nodeQueue==='expired'),stopped:q.stopped.filter(m=>m.nodeQueue==='canceled') };
}
export function nodeInteractionCounts(chats:readonly NodeQueueChat[]):Record<NodeQueueCategory,number> {
  return Object.fromEntries(nodeQueueCategories.map(({id})=>[id,chats.reduce((sum,c)=>sum+c.groups[id].length,0)])) as Record<NodeQueueCategory,number>;
}
