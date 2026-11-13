import type {ChatEntry} from './session-chats';
import {deliveryIssueText,deliveryNeedsAction,type DeliveryIssue} from '../application/delivery-issues';
import {activeNodeTransfer,effectiveDeliveryIssue} from './node-transfer';
import { messageStatus } from './message-presentation';
export type DeliveryAttention = {count:number;label:string;detail:string;tone:'waiting'|'action'|'danger'|'success'|'radio-waiting'};
const labels:Record<DeliveryIssue,string>={
  contact_connecting:'Устанавливаем защищённую связь',
  direct_unavailable:'Нет прямой связи',direct_receipt_timeout:'Нет подтверждения',contact_pending:'Ждём принятия',
  node_not_configured:'Нет ноды',node_sending_disabled:'Нода выключена',keys_missing:'Ждём ключи',keys_expired:'Ждём новые ключи',keys_exhausted:'Ключи закончились',
  node_unavailable:'Подключаемся к ноде',node_timeout:'Повторяем запрос',node_denied:'Нет доступа к ноде',node_full:'Нода заполнена',node_rate_limit:'Ждём разрешения ноды',
  node_files_full:'Лимит файлов ноды',node_profile_files_full:'Квота файлов профиля',node_storage_full:'Нет места для очереди',
  node_messages_full:'Лимит конвертов',node_profile_messages_full:'Квота отправителя',
  keys_source_unavailable:'Нет новых ключей с ноды',
  local_storage:'Ошибка сохранения',primary_disabled:'Основной вход отключён',primary_policy_invalid:'Проверить доступ',network_forbidden:'Маршрут запрещён',
};
export function deliveryAttention(messages:readonly ChatEntry[]):DeliveryAttention|null {
  let result:DeliveryAttention|null=null,rank=-1,count=0;
  for(const m of messages){
    if (m.radioDelivery && !m.nodeQueue && m.direction==='outgoing' && !m.restoredFromBackup && !m.importedFromDevice && !['stored','delivered','read'].includes(m.delivery??'')) {
      const status = messageStatus(m); count++;
      if(status.tone==='neutral'){count--;continue;}
      const priority = status.tone==='error'?3:status.tone==='success'?0:1;
      if (rank <= priority) { rank=priority; result={count:0,label:status.label,detail:status.detail,tone:status.tone==='error'?'danger':status.tone==='success'?'success':'radio-waiting'}; }
      continue;
    }
    if(m.nodeQueue||m.direction!=='outgoing'||m.localCall||m.restoredFromBackup||m.importedFromDevice||['stored','delivered','read'].includes(m.delivery??''))continue;
    const code=effectiveDeliveryIssue(m);
    if(activeNodeTransfer(m)&&!code)continue;
    // File progress has its own badge, but an explicit key/access/node failure
    // must still be explained, not hidden behind an upload percentage.
    if(m.file&&(!code||m.fileDeleted||['ready','canceled','rejected'].includes(m.fileStatus??'')))continue;
    if(!code&&!['saving','queued','sending','sent'].includes(m.delivery??''))continue;
    count++;const priority=code&&deliveryNeedsAction(code,m.deliveryError)?2:code?1:0;
    if(priority<rank)continue;
    rank=priority;
    result={count:0,label:code?labels[code]:m.delivery==='saving'?'Сохраняем':m.delivery==='sending'?'Отправляем':m.delivery==='sent'?'Ждём подтверждения':'В очереди',
      detail:code?deliveryIssueText(code):m.delivery==='saving'?'Идёт локальное сохранение. Не закрывайте приложение до его завершения.':
        m.delivery==='sending'?'Идёт передача по прямому каналу. Пока она не завершена, оставьте приложение открытым.':
        'Сообщение пока только в этом приложении, а не на ноде. Для отправки нужен доступный собеседник или настроенная очередь с его ключами.',
      tone:priority===2?'action':'waiting'};
  }
  return result?{...result,count}:null;
}
