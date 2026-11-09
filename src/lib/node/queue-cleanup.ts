import type {DeliveryErrorCode} from '$lib/application/delivery-issues';
export type QueueCleanup={count:number;stage:'list'|'verify'|'cancel'|'save'|'refresh';error?:DeliveryErrorCode};
const automatic=new Set(['node_unavailable','request_aborted','request_timeout','client_type_error','rate_limit','too_many_challenges']);
export const cleanupErrors=(value:QueueCleanup|undefined)=>value?.error&&!automatic.has(value.error)?Math.max(1,value.count):0;
export const cleanupWaiting=(value:QueueCleanup|undefined)=>value?.error&&automatic.has(value.error)?Math.max(1,value.count):0;
export function cleanupExplanation(value:QueueCleanup):string{
  const stages={list:'Сверка очереди',verify:'Проверка конверта',cancel:'Освобождение копии',save:'Сохранение результата',refresh:'Проверка остатка очереди'};
  const reason=value.error==='invalid_node_request'?'Клиент не разрешил запрос к ноде.':value.error==='not_member'?'Нода не подтвердила доступ профиля.':value.error==='courier_not_saved'?'Не удалось сохранить результат на устройстве.':value.error==='invalid_courier_inventory'?'Нода вернула некорректный список.':'Нода не подтвердила завершение запроса.';
  return `${stages[value.stage]}: ${reason} Повторим автоматически. Доставленная переписка сохранена.`;
}
