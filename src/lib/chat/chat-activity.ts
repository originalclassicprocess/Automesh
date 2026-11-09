import type { ChatEntry } from './session-chats';
import { deliveryAttention } from './delivery-attention';
import { nodeQueueSummary } from './node-queue';
import { transferActivity, transferLabel } from './transfer-activity';
import { activeNodeTransfer } from './node-transfer';

// Presentation only. All scheduling and delivery acknowledgements stay with
// the existing workers. A stored envelope is never described as delivered.
export function chatActivity(messages: readonly ChatEntry[], { summarizeTransfers = true } = {}) {
  const transfers = transferActivity(messages), queue = nodeQueueSummary(messages);
  const attention = deliveryAttention(messages);
  const nodeActive = messages.filter(activeNodeTransfer);
  const expired = queue.stopped.filter(m => m.nodeQueue === 'expired').length;
  const canceled = queue.stopped.filter(m => m.nodeQueue === 'canceled').length;
  const transfer = [
    transfers.outgoing.count ? `↑ ${transfers.outgoing.count} · ${transfers.outgoing.percent}%` : '',
    transfers.incoming.count ? `↓ ${transfers.incoming.count} · ${transfers.incoming.percent}%` : '',
  ].filter(Boolean).join('  ');
  const details = [
    expired ? `Нода удалила по сроку: ${expired}.` : '',
    queue.canceling.length ? `Ждём подтверждения отмены: ${queue.canceling.length}.` : '',
    attention ? `${attention.label}. ${attention.detail}` : '',
    nodeActive.length ? `Готовим или загружаем на ноду: ${nodeActive.length}. До подтверждения приёма оставьте приложение открытым.` : '',
    ...Object.entries(transfers).filter(([, group]) => group.count).map(([direction, group]) => transferLabel(group, direction === 'outgoing')),
    queue.waiting.length ? `На ноде ждут получения: ${queue.waiting.length}.` : '',
    canceled ? `Отменено вами: ${canceled}.` : '',
  ].filter(Boolean).join(' ');
  const status = (label: string, tone: 'success' | 'warning' | 'danger' | 'muted', showTransfer = true) =>
    ({ label, tone, detail: details, transfer: showTransfer && summarizeTransfers ? transfer : '' });
  if (expired) return status(`Срок истёк · ${expired}`, 'danger');
  if (queue.canceling.length) return status(`Отменяем · ${queue.canceling.length}`, 'danger');
  if (attention?.tone === 'danger') return status(attention.label, 'danger');
  if (attention?.tone === 'action') return status(attention.label, 'warning');
  const failed = transfers.outgoing.failed + transfers.incoming.failed;
  if (failed) return status(`Ошибка передачи · ${failed}`, 'warning');
  if (transfer && summarizeTransfers) return status(transfer, transfers.outgoing.active || transfers.incoming.active || nodeActive.length ? 'success' : 'muted', false);
  const nodeSummary = summarizeTransfers ? nodeActive : nodeActive.filter(m => !m.file);
  if (nodeSummary.length) return status(`Отправляем на ноду · ${nodeSummary.length}`, 'success');
  if (attention) return status(attention.label, attention.tone === 'success' ? 'success' : attention.tone === 'radio-waiting' ? 'warning' : 'muted');
  if (queue.waiting.length) return status(`На ноде · ${queue.waiting.length}`, 'success');
  if (canceled) return status(`Отменено вами · ${canceled}`, 'muted');
  return null;
}
