import {currentKeyStock,type RemoteKeyStock} from '$lib/node/key-stock';
import type { CourierState } from '$lib/node/courier-state';
import type { OfflineState } from '$lib/node/offline-state';
export type OfflineKeyBudget = { count: number; label: string; detail: string; available: boolean;refreshable?:boolean; badgeText?:string };
export function offlineKeyBudget(self: string, peer: string, trusted: boolean, courier: CourierState, mailbox: OfflineState, connected: boolean, now: number, remoteStock?:RemoteKeyStock): OfflineKeyBudget {
  const unavailable = (label: string, detail: string): OfflineKeyBudget => ({ count: 0, label, detail, available: false });
  if (!trusted) return unavailable('Нода: доверенный режим нужен', 'Одноразовые ключи офлайн-доставки сохраняются только в зашифрованной истории доверенного клиента.');
  const ownNode = courier.enabled && courier.node;
  const mailboxNode = mailbox.enabled && mailbox.node;
  if (!ownNode && !mailboxNode) return unavailable(courier.node || mailbox.node ? 'Офлайн-доставка выключена' : 'Нода не подключена', 'Обычная переписка онлайн не ограничена числом одноразовых офлайн-ключей. Подключите ноду и включите офлайн-доставку в настройках связи.');
  const bundle = ownNode ? courier.bundles[peer] : mailbox.bundles[peer];
  const used = ownNode ? courier.used : mailbox.used;
  const source=ownNode?courier.bundles[peer]?.body.keySource:undefined;
  const refreshable=!!source&&bundle?.body.from===peer&&bundle?.body.to===self;
  if (!bundle || bundle.body.from !== peer || bundle.body.to !== self || bundle.body.expiresAt <= now && !refreshable)
    return unavailable('Нода: ждём ключи', 'Сначала оба участника должны подключиться и обменяться действующими ключами. Просроченные ключи не считаются.');
  const cached=bundle.body.expiresAt>now?new Set(bundle.body.keys.filter(key=>!used[key.id]).map(key=>key.id)).size:0;
  const stock=currentKeyStock(source,remoteStock,now);
  if(refreshable){
    const remote=stock?.status==='ready'||stock?.status==='empty'?stock.available:undefined;
    const count=cached+(remote??0);
    return {count,available:count>0,refreshable:true,badgeText:count?String(count):remote===0?'0':stock?.status==='unavailable'?'!':'?',
      label:remote===undefined?`Нода · ${cached?cached+' ключей в клиенте · ':''}ключи по запросу · ${stock?.status==='unavailable'?'запас недоступен':'проверяем запас'}`:
        `${!connected?'Нет связи с вашей нодой · ':''}${count?'Ключи: '+count:'Ключи закончились'}`,
      detail:`В этом клиенте: ${cached}. `+(remote!==undefined?`На ноде собеседника: ${remote}. Проверено: ${new Date(stock!.checkedAt).toLocaleTimeString()}. `:
        stock?.status==='unavailable'?'Не удалось проверить запас ноды собеседника; это не означает, что ключей ноль. ':'Запас ноды ещё не проверен. ')+
        'При отправке нода выдаёт один ключ из этого запаса. Его заранее пополняет открытый основной клиент собеседника. Наличие обоих пользователей онлайн не гарантирует прямой канал. Обычная прямая переписка не ограничена этим счётчиком.'};
  }
  const count=cached;
  const noun = count % 10 === 1 && count % 100 !== 11 ? 'ключ' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'ключа' : 'ключей';
  return { count, available: count > 0,...(refreshable?{refreshable:true}:{}),
    label: `${ownNode && !connected ? 'Нода недоступна' : 'Нода'} · ${refreshable&&!count?'ключи по запросу':`${count} ${noun}${refreshable?' в клиенте':''}`}`,
    detail: 'Оставшиеся в этом клиенте одноразовые ключи собеседника для новых офлайн-конвертов. Ключ расходуется при резервировании конверта, не повторно при его отправке. Один файл расходует один ключ, а не ключ на каждую часть. '
      +(refreshable?'Дополнительно запрашиваем опубликованные ключи через ноду собеседника; её запас в это число не входит. ':'Новые ключи приходят при прямом обмене. ')
      +'Это не лимит обычных сообщений и не гарантия доступности ноды. При нуле прямой чат продолжает работать.' };
}
