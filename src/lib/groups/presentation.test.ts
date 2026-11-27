import { describe, expect, it } from 'vitest';
import { groupDelivery, groupRecipients } from './presentation';
import { groupChronology, groupEntryUnread, type GroupEntry, type GroupRoom } from './storage';

const post = (id: string, sentAt: number, fields: Partial<GroupEntry> = {}): GroupEntry => ({
  id, sentAt, from:'a', text:id, hash:id, packet:id, ...fields,
});
const room: GroupRoom = { id:'group', title:'Group', owner:'a', members:['a','b','c','d','e'], keys:{}, entries:[] };

describe('group conversation presentation', () => {
  it('keeps the observed exchange across slow clocks and inserts independent history by sender time', () => {
    const first = post('first', 70_000);
    const second = post('second', 8_000, { from:'b', after:['first'] });
    const third = post('third', 71_000, { after:['first','second'] });
    const late = post('late', 2_000, { from:'c', unread:true });
    for (const entries of [[third, second, first, late], [late, second, third, first]]) {
      const history = groupChronology(entries);
      expect(history.map(item => item.id)).toEqual(['late','first','second','third']);
      expect(history.filter(item => groupEntryUnread(item, 'b')).map(item => item.id)).toEqual(['late']);
    }
  });

  it('uses confirmed file bytes for delivery status even if the card is already read', () => {
    const twoRecipients = { ...room, members:['a','b','c'] };
    const file = { id:'file', name:'file.bin', mime:'application/octet-stream', size:3, sha256:'f'.repeat(64) };
    const entry = post('file', 1, { file, receivedBy:['b','c'], nodeStatus:{ b:'delivered', c:'stored' } });
    expect(groupDelivery(twoRecipients, entry, 'a').status).toMatchObject({ label:'Файл не отправлен', tone:'error' });
    expect(groupRecipients(twoRecipients, entry).every(item => item.card && !item.file)).toBe(true);
    expect(groupDelivery(twoRecipients, { ...entry, nodeFileStatus:{ b:'stored' } }, 'a'))
      .toMatchObject({ status:{ label:'Сохранено на ноде', tone:'success' }, count:'1/2' });
    expect(groupDelivery(twoRecipients, { ...entry, fileReceivedBy:['b'], nodeFileStatus:{ c:'delivered' } }, 'a'))
      .toMatchObject({ status:{ label:'Получено всеми', tone:'success' } });
    expect(groupDelivery(twoRecipients, entry, 'c').status).toMatchObject({ label:'Ожидает загрузки' });
    expect(groupDelivery(twoRecipients, { ...entry, fileReady:true }, 'c').status).toMatchObject({ label:'Файл получен', tone:'success' });
  });

  it('shows yellow only for a live attempt and green only for a confirmed remote copy', () => {
    const entry = post('message', 1);
    expect(groupDelivery(room, entry, 'a').status).toMatchObject({ label:'Не отправлено', tone:'error' });
    expect(groupDelivery(room, entry, 'a', false, undefined, new Set(['b'])).status)
      .toMatchObject({ label:'Ищем получателя', tone:'waiting' });
    expect(groupDelivery(room, entry, 'a', false, 'sending').status).toMatchObject({ label:'Отправляем', tone:'waiting' });
    expect(groupDelivery(room, { ...entry, nodeStatus:{ b:'finished' } }, 'a').status.tone).toBe('error');
    expect(groupDelivery(room, { ...entry, receivedBy:['b'] }, 'a', false, 'sending'))
      .toMatchObject({ status:{ label:'Получено', tone:'success' }, count:'1/4' });
    expect(groupDelivery(room, { ...entry, receivedBy:['b'], nodeStatus:{ c:'stored', d:'stored', e:'stored' } }, 'a'))
      .toMatchObject({ status:{ label:'Сохранено на ноде', tone:'success' }, count:undefined });
    const all = { ...entry, receivedBy:['b','c','d','e'] };
    expect(groupDelivery(room, all, 'a').status).toMatchObject({ label:'Получено всеми', tone:'success' });
    const receipts = all.receivedBy.map(by => ({ by, state:'read' as const, hash:entry.hash, publicKey:'', signature:'' }));
    expect(groupDelivery(room, { ...all, receipts }, 'a').status).toMatchObject({ label:'Прочитано всеми', tone:'success' });
  });
});
