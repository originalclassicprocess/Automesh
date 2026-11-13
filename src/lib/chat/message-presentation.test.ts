import { describe, expect, it } from 'vitest';
import { canDownloadMessage, canStopFile, messageStatus, messageProvenance } from './message-presentation';
import type { ChatEntry } from './session-chats';
const base: ChatEntry = { id: 'one', text: 'Hello', from: 'alice', timestamp: 1, direction: 'outgoing' };
const file: ChatEntry = { ...base, file: { id: 'one', name: 'x.png', mime: 'image/png', size: 100, sha256: 'a'.repeat(64) }, fileStatus: 'sending', fileProgress: 50 };
describe('message presentation', () => {
  it('shows saving until durable commit, including Saved, and keeps confirmed status ahead of stale errors', () => {
    expect(messageStatus({ ...base, delivery: 'saving' }, true).label).toBe('Сохраняем');
    expect(messageStatus({ ...base, delivery: 'queued', deliveryIssue: 'keys_missing' }).detail).toContain('keys_missing');
    expect(messageStatus({ ...base, delivery: 'stored', deliveryIssue: 'node_timeout' }).label).toBe('На ноде');
    expect(messageStatus({ ...base, delivery: 'delivered', deliveryIssue: 'node_timeout' }).label).toBe('Доставлено');
  });
  it('never treats unknown, queued, sent or node storage as receipt', () => {
    for (const delivery of ['queued', 'sending', 'sent'] as const) expect(messageStatus({ ...base, delivery }).tone).toBe('waiting');
    expect(messageStatus(base).tone).toBe('neutral');
    expect(messageStatus({ ...base, delivery: 'stored' }).label).toBe('На ноде');
    expect(messageStatus({ ...base, delivery: 'delivered' }).label).toBe('Доставлено');
  });
  it('respects read receipt privacy', () => {
    expect(messageStatus({ ...base, delivery: 'read' }, false, false).label).toBe('Доставлено');
    expect(messageStatus({ ...base, delivery: 'read' }, false, true).icon).toBe('✓✓');
  });
  it('distinguishes incomplete files, node acknowledgement, and interruption', () => {
    expect(messageStatus(file).label).toBe('Отправляем 50%');
    expect(messageStatus({ ...file, delivery: 'stored' }).label).toBe('На ноде');
    expect(messageStatus({ ...file, fileStatus: 'failed' }).tone).toBe('error');
    expect(messageStatus({ ...file, direction: 'incoming', fileStatus: 'offered' }).label).toBe('Ожидает загрузки');
    expect(messageStatus({ ...file, direction: 'incoming', fileStatus: 'ready' }).tone).toBe('success');
    expect(messageStatus({ ...file, fileStatus: 'canceled' }).label).toBe('Остановлено');
  });
  it('offers only meaningful file actions', () => {
    expect(canStopFile(file)).toBe(true);
    expect(canStopFile({ ...file, fileStatus: 'ready' })).toBe(false);
    expect(canDownloadMessage({ ...file, direction: 'incoming' })).toBe(false);
    expect(canDownloadMessage({ ...file, direction: 'incoming', fileStatus: 'ready' })).toBe(true);
    expect(canDownloadMessage({ ...file, fileDeleted: true })).toBe(false);
  });
  it('separates historical provenance and local file availability from remote delivery', () => {
    const old = { ...file, importedFromDevice: true, restoredFromBackup: true, fileStatus: 'ready' as const };
    expect(messageStatus(old)).toMatchObject({ label: 'Файл сохранён', tone: 'success' });
    expect(messageProvenance(old)).toContain('История с другого устройства');
    expect(messageStatus({ ...old, fileStatus: 'canceled' })).toMatchObject({ label: 'Файл не перенесён', tone: 'neutral' });
    expect(canDownloadMessage({ ...old, fileStatus: 'canceled' })).toBe(false);
    expect(messageStatus({ ...base, deviceMessage: true }).tone).toBe('neutral');
    expect(messageStatus({ ...base, deviceMessage: true, delivery: 'delivered' })).toMatchObject({ label: 'Доставлено', tone: 'success' });
  });
});

it('keeps preparation, HTTPS upload, automatic retry and actionable quota separate',()=>{
 const m={...file,delivery:'queued' as const,deliveryIssue:'node_unavailable' as const};
 expect(messageStatus({...m,courierStage:'preparing'}).label).toBe('Готовим файл для ноды');
 expect(messageStatus({...m,courierStage:'uploading'})).toMatchObject({label:'Загружаем на ноду 50%',tone:'waiting'});
 expect(messageStatus({...m,courierStage:'retrying'}).label).toBe('Повторяем подключение к ноде');
 expect(messageStatus({...m,courierStage:'uploading',deliveryIssue:'node_profile_files_full'}).tone).toBe('error');
 expect(messageStatus({...m,courierStage:'uploading',delivery:'delivered'})).toMatchObject({label:'Отправляем 50%',tone:'waiting'});
 expect(messageStatus({...m,courierStage:'uploading',nodeQueue:'expired'}).tone).toBe('error');
 expect(messageStatus({...m,nodeQueue:'canceled'}).tone).toBe('neutral');
});
it('never uses green for buffered bytes, offer receipts or cancellation still awaiting node confirmation',()=>{
 for(const delivery of ['sent','delivered','read'] as const){
   expect(messageStatus({...file,fileProgress:100,delivery},false,true).tone).toBe('waiting');
 }
 expect(messageStatus({...file,fileProgress:100,courierStage:'uploading'})).toMatchObject({tone:'waiting',label:'Подтверждаем приём нодой'});
 expect(messageStatus({...base,nodeQueue:'canceling'}).tone).toBe('waiting');
 expect(messageStatus({...file,delivery:'stored'}).detail).toContain('нода доставки должна оставаться включённой');
 expect(messageStatus({...file,fileStatus:'ready',deliveryIssue:'node_denied'}).tone).toBe('success');
});
it('separates automatic waiting from repairs, including optional nodes and rejected key sources',()=>{
 for(const deliveryIssue of ['contact_pending','direct_unavailable','node_timeout','keys_missing','node_not_configured','node_sending_disabled'] as const)
   expect(messageStatus({...base,delivery:'queued',deliveryIssue}).tone).toBe('waiting');
 for(const deliveryIssue of ['node_denied','node_full','local_storage','primary_policy_invalid','network_forbidden'] as const)
   expect(messageStatus({...base,delivery:'queued',deliveryIssue}).tone).toBe('error');
 expect(messageStatus({...base,delivery:'queued',deliveryIssue:'keys_source_unavailable',deliveryError:'prekey_source_not_approved'}).tone).toBe('error');
 expect(messageStatus({...base,delivery:'queued',deliveryIssue:'keys_source_unavailable',deliveryError:'request_timeout'}).tone).toBe('waiting');
});
