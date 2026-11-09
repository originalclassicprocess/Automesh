import type { ChatEntry } from './session-chats';

export type TransferActivity = { count: number; active: number; waiting: number; failed: number; bytes: number; total: number; percent: number };
export type TransferSummary = { outgoing: TransferActivity; incoming: TransferActivity };
const empty = (): TransferActivity => ({count:0,active:0,waiting:0,failed:0,bytes:0,total:0,percent:0});

// Presentation only: never schedules, accepts or resumes a transfer.
// A direct send stays visible until the receiver confirms saving. Buffered
// bytes at 100% are not a durable handoff; node storage is a durable handoff,
// but is still not recipient delivery.
export function transferActivity(messages: readonly ChatEntry[]): TransferSummary {
  const result = {outgoing:empty(),incoming:empty()};
  for (const m of messages) {
    if (m.nodeQueue || !m.file || m.fileDeleted || m.restoredFromBackup || ['ready','canceled','rejected'].includes(m.fileStatus ?? '')) continue;
    const outgoing = m.direction === 'outgoing', status = m.fileStatus;
    if (outgoing && ['stored','delivered','read'].includes(m.delivery ?? '')) continue;
    if (outgoing ? !['queued','sending','offered','failed'].includes(status ?? '') :
      status !== 'receiving' && status !== 'failed' && !(m.fileAccepted && ['queued','offered'].includes(status ?? ''))) continue;
    const group = outgoing ? result.outgoing : result.incoming;
    const active=m.courierStage?m.courierStage==='uploading':status==='sending'||status==='receiving';
    group.count++; group.failed += Number(status === 'failed'&&!m.courierStage);
    group.active += Number(active);
    group.waiting += Number(!active&&(status!=='failed'||!!m.courierStage));
    group.total += m.file.size;
    group.bytes += Math.max(0,Math.min(m.file.size,Number.isFinite(m.fileProgress) ? m.fileProgress! : 0));
  }
  for (const group of Object.values(result)) group.percent = group.total ? Math.floor(group.bytes/group.total*100) : 0;
  return result;
}

export function transferLabel(group: TransferActivity, outgoing: boolean): string {
  return `${outgoing ? 'Отправка' : 'Получение'}: ${group.count}; в процессе: ${group.active}; ожидают: ${group.waiting}; ошибок: ${group.failed}. ${group.percent}% байтов текущих файлов. Это не подтверждение доставки.`;
}
