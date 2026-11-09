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
    for (const delivery of [undefined, 'queued', 'sending', 'sent'] as const) expect(messageStatus({ ...base, delivery }).tone).toBe('waiting');
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
    expect(messageStatus({ ...old, fileStatus: 'canceled' })).toMatchObject({ label: 'Файл не перенесён', tone: 'waiting' });
    expect(canDownloadMessage({ ...old, fileStatus: 'canceled' })).toBe(false);
    expect(messageStatus({ ...base, deviceMessage: true }).tone).toBe('waiting');
    expect(messageStatus({ ...base, deviceMessage: true, delivery: 'delivered' })).toMatchObject({ label: 'Доставлено', tone: 'success' });
  });
});

it('keeps preparation, HTTPS upload, automatic retry and actionable quota separate',()=>{
 const m={...file,delivery:'queued' as const,deliveryIssue:'node_unavailable' as const};
 expect(messageStatus({...m,courierStage:'preparing'}).label).toBe('Готовим файл для ноды');
 expect(messageStatus({...m,courierStage:'uploading'})).toMatchObject({label:'Загружаем на ноду 50%',tone:'success'});
 expect(messageStatus({...m,courierStage:'retrying'}).label).toBe('Повторяем подключение к ноде');
 expect(messageStatus({...m,courierStage:'uploading',deliveryIssue:'node_profile_files_full'}).tone).toBe('warning');
 expect(messageStatus({...m,courierStage:'uploading',delivery:'delivered'}).label).toBe('Доставлено');
 expect(messageStatus({...m,courierStage:'uploading',nodeQueue:'expired'}).tone).toBe('error');
 expect(messageStatus({...m,nodeQueue:'canceled'}).tone).toBe('waiting');
});
