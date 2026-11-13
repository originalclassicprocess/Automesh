import type { ChatEntry } from './session-chats';
import { deliveryIssues, isDeliveryErrorCode, deliveryNeedsAction } from '$lib/application/delivery-issues';
import {activeNodeTransfer,effectiveDeliveryIssue} from './node-transfer';
export type MessageStatus = { icon: string; label: string; detail: string; tone: 'waiting' | 'success' | 'error' | 'neutral' };
export function messageProvenance(message: ChatEntry): string {
  return message.importedFromDevice ? 'История с другого устройства. Это не новая отправка.' :
    message.deviceMessage && !message.delivery && message.direction === 'outgoing' ? 'Копия с другого устройства. Подтверждение доставки не перенесено.' : '';
}
export function messageStatus(message: ChatEntry, self = false, showRead = false): MessageStatus {
  const result = (icon: string, label: string, detail: string, tone: MessageStatus['tone'] = 'waiting') => ({ icon, label,
    detail: tone === 'waiting' && !detail.includes('открыт') ? `${detail} Для продолжения оставьте приложение открытым.` : detail, tone });
  if (message.radioDelivery && !message.nodeQueue && !message.restoredFromBackup && !message.importedFromDevice && !['stored','delivered','read'].includes(message.delivery ?? '') && message.direction === 'outgoing') {
    const label = { queued: 'В очереди LoRa', transmitting: 'Отправляем по LoRa', awaiting: 'Ждём ответа платы', board: 'Принято платой собеседника', received: 'Доставлено', retry: 'LoRa: нужен повтор', stopped: 'LoRa приостановлена' }[message.radioDelivery];
    return result(['received','board'].includes(message.radioDelivery) ? '✓' : '◷', label,
      message.radioDelivery === 'received' ? 'Automesh собеседника подтвердил получение сообщения. Можно закрыть приложение.' :
      message.radioDelivery === 'stopped' ? message.radioSuppressed ? 'Отправка по LoRa остановлена. Для новой попытки выберите повтор.' : 'Отправка по LoRa приостановлена. Продолжим после восстановления подключения к плате.' :
      message.radioDelivery === 'retry' ? 'Подтверждение Automesh не получено. Проверьте соединение с платой и повторите отправку при необходимости.' :
      message.radioDelivery === 'board' ? 'Плата собеседника подтвердила все части. Сохранение в Automesh и прочтение ещё не подтверждены. Буфер платы ограничен и может быть потерян при перезагрузке. Копия отправки сохранена для ручного повтора.' :
      'Ждём подтверждения платы или сохранения в Automesh собеседника. Пока статус жёлтый, оставьте приложение открытым. Красный означает, что отправка не подтверждена; доступен повтор.',
      ['received','board'].includes(message.radioDelivery) ? 'success' : message.radioDelivery === 'stopped' && message.radioSuppressed ? 'neutral' : message.radioDelivery === 'retry' ? 'error' : 'waiting');
  }
  if (message.restoredFromBackup && message.importedFromDevice) {
    if (message.fileDeleted) return result('⊘', 'Файл удалён', 'Исторический файл удалён на этом устройстве.', 'neutral');
    if (message.file && message.fileStatus !== 'ready') return result('◷', 'Файл не перенесён', 'История получена, но байтов файла на этом устройстве нет.', 'neutral');
    return result('✓', message.file ? 'Файл сохранён' : 'Сохранено на устройстве',
      'Историческая копия сохранена локально. Это не новое подтверждение доставки или прочтения собеседником.', 'success');
  }
  if (message.restoredFromBackup) return result('↺', message.file && message.fileStatus !== 'ready' && !message.fileDeleted
    ? 'Файл отсутствует в копии' : 'Из резервной копии',
    'Восстановленная история. Старые отправки не повторяются; этот статус не подтверждает новую доставку.', 'neutral');
  if (message.nodeQueue && !['delivered','read'].includes(message.delivery ?? '')) {
    if (message.nodeQueue === 'canceling') return result('◷','Отменяем на ноде','Отправка приостановлена. Ждём подтверждения удаления с ноды; уже полученные копии не удаляются.', 'waiting');
    return result('⊘',message.nodeQueue === 'expired' ? 'Срок на ноде истёк' : 'Отменено вами',
      'На этой ноде конверт больше не доставляется. Локальная копия сохранена; отправить снова можно вручную. Уже полученные копии не удаляются.',message.nodeQueue==='expired'?'error':'neutral');
  }
  if (message.file && message.fileStatus === 'canceled') return result('⊘', 'Остановлено', 'Передача остановлена. Уже полученные копии не удаляются.', 'neutral');
  if (message.file && message.fileStatus === 'rejected') return result('⊘', 'Файл отклонён', 'Получатель не принял файл.', 'neutral');
  const complete = !message.file || message.fileStatus === 'ready';
  if (message.direction === 'outgoing' && complete && message.delivery === 'read' && showRead)
    return result('✓✓', 'Прочитано', 'Получено подтверждение прочтения. Это не подтверждение просмотра каждого вложения.', 'success');
  if (message.direction === 'outgoing' && complete && ['delivered', 'read'].includes(message.delivery ?? ''))
    return result('✓', self ? 'Сохранено' : 'Доставлено', self ? 'Сохранено в вашем чате с собой.' : 'Получено подтверждение доставки от клиента собеседника.', 'success');
  if (!message.file && message.direction === 'outgoing' && message.deviceCopyDelivery === 'delivered')
    return result('✓', 'Доставлено на устройство', 'Одно из дополнительных устройств собеседника подтвердило получение. Отдельная доставка на основное устройство продолжается.', 'success');
  if (message.direction === 'outgoing' && message.delivery === 'stored')
    return result('☁', 'На ноде', 'Узел подтвердил сохранение зашифрованного сообщения; для файла — всех его частей. Получение собеседником ещё не подтверждено. Можно закрыть Automesh; нода доставки должна оставаться включённой.', 'success');
  if (message.direction === 'outgoing' && message.file && message.fileStatus === 'ready')
    return result('✓', 'Файл доставлен', 'Клиент собеседника подтвердил получение файла.', 'success');
  const issue=effectiveDeliveryIssue(message);
  if(activeNodeTransfer(message)&&!issue){
    if(message.courierStage==='preparing')return result('◷',message.file?'Готовим файл для ноды':'Готовим сообщение для ноды','Подготавливаем зашифрованную отправку. Оставьте приложение открытым.', 'waiting');
    const percent=message.file?Math.min(100,Math.max(0,Math.floor((message.fileProgress??0)/Math.max(1,message.file.size)*100))):0;
    return result('↑',percent===100?'Подтверждаем приём нодой':`Загружаем на ноду ${percent}%`,'Загрузка по HTTPS. Сохранение на ноде и доставка собеседнику подтверждаются отдельно.', 'waiting');
  }
  if(issue&&(message.courierStage==='retrying'||deliveryNeedsAction(issue,message.deliveryError))){
    const [label,detail]=deliveryIssues[issue];return result(deliveryNeedsAction(issue,message.deliveryError)?'×':'◷',label,detail,deliveryNeedsAction(issue,message.deliveryError)?'error':'waiting');
  }
  if (message.file && message.fileStatus === 'failed') return result('×', 'Передача прервалась', 'Передача файла не завершена. Можно повторить; это не означает, что само сообщение потеряно.', 'error');
  if (message.file && ['receiving', 'sending'].includes(message.fileStatus ?? '')) {
    const percent = Math.min(100, Math.max(0, Math.round((message.fileProgress ?? 0) / Math.max(message.file.size, 1) * 100)));
    return result('↑↓', `${message.fileStatus === 'receiving' ? 'Получаем' : 'Отправляем'} ${percent}%`, 'Процент показывает передачу байтов, а не подтверждение доставки или прочтения.');
  }
  if (message.direction === 'incoming') {
    if (message.file && message.fileStatus !== 'ready') return result('◷', 'Ожидает загрузки', 'Сообщение с описанием файла получено; сам файл пока не загружен полностью. Выберите загрузку, чтобы получить файл.', 'neutral');
    return result('✓', message.file ? 'Файл получен' : 'Получено', message.file ? 'Файл загружен, его целостность проверена.' : 'Сообщение принято этим устройством.', 'success');
  }
  if (message.delivery === 'saving') return result('◷', 'Сохраняем', 'Запись в локальное хранилище ещё не подтверждена. Сетевая отправка не начата.');
  if (self) return result('✓', 'Сохранено', 'Сохранено в вашем чате с собой.', 'success');
  if (issue && message.delivery !== 'sending') {
    const [label, detail] = deliveryIssues[issue];
    return result('◷', label, `${detail} Код: ${issue}${isDeliveryErrorCode(message.deliveryError) ? `; причина: ${message.deliveryError}` : ''}`);
  }
  if (message.delivery === 'sending') return result('↑', 'Отправляем', 'Идёт попытка передачи. Подтверждения доставки ещё нет.');
  if (message.delivery === 'sent') return result('◷', 'Отправлено', 'Сообщение передано в соединение; подтверждения доставки от собеседника ещё нет.');
  if (message.file && message.fileStatus === 'offered') return result('◷', 'Ждём получения файла', 'Файл предложен собеседнику, но его получение ещё не подтверждено.');
  if (!message.delivery && !message.file && message.deviceMessage)
    return result('↔', 'Копия с другого устройства', 'Синхронизирована исходящая запись вашего аккаунта. Это не отдельное подтверждение получения собеседником.', 'neutral');
  if (!message.delivery && !message.file) return result('·', 'Статус неизвестен', 'У старого сообщения не сохранено подтверждение доставки.', 'neutral');
  return result('◷', 'В очереди', 'Сообщение пока не передано получателю и не подтверждено узлом. Офлайн-собеседник не считается ошибкой.');
}
export function canDownloadMessage(message: ChatEntry): boolean {
  if (message.details?.ephemeral) return false;
  if (message.importedFromDevice && message.file && message.fileStatus !== 'ready') return false;
  return !message.file || !message.fileDeleted && (message.direction === 'outgoing' || message.fileStatus === 'ready');
}
export function canStopFile(message: ChatEntry): boolean {
  return !!message.file && !message.fileDeleted && !['ready', 'canceled', 'rejected'].includes(message.fileStatus ?? '') &&
    !['delivered', 'read'].includes(message.delivery ?? '');
}
