import {expect,it} from 'vitest';
import {deliveryAttention} from './delivery-attention';
import type {ChatEntry} from './session-chats';
import {deliveryIssueForError} from '../application/delivery-issues';
const base:ChatEntry={id:'id',from:'me',direction:'outgoing',timestamp:1,text:'hello',delivery:'queued'};
it('retains an older waiting outgoing message even after an incoming reply and counts pending text',()=>{
  expect(deliveryAttention([{...base,deliveryIssue:'keys_missing'},{...base,id:'two'},{...base,id:'in',direction:'incoming',delivery:undefined}])).toMatchObject({label:'Ждём ключи',count:2,tone:'waiting'});
});
it('does not duplicate ordinary sent/stored/delivered/read statuses, imported archives or transfers',()=>{
  for(const delivery of ['stored','delivered','read'] as const)expect(deliveryAttention([{...base,delivery}])).toBeNull();
  expect(deliveryAttention([{...base,delivery:'sent'}])).toMatchObject({tone:'waiting',label:'Ждём подтверждения'});
  expect(deliveryAttention([{...base,restoredFromBackup:true}])).toBeNull();
  expect(deliveryAttention([{...base,file:{id:'id',name:'x',size:1,mime:'text/plain',sha256:'a'.repeat(64)}}])).toBeNull();
  expect(deliveryAttention([{...base,deliveryIssue:'keys_missing',file:{id:'id',name:'x',size:1,mime:'text/plain',sha256:'a'.repeat(64)}}])?.label).toBe('Ждём ключи');
  expect(deliveryAttention([{...base,delivery:'sent',deliveryIssue:'direct_receipt_timeout'}])?.label).toBe('Нет подтверждения');
  expect(deliveryAttention([{...base,delivery:'stored',deliveryIssue:'keys_missing'}])).toBeNull();
});
it('prioritizes required action without exposing arbitrary error text',()=>{
  expect(deliveryAttention([{...base,deliveryIssue:'node_denied'},{...base,id:'two'}])).toMatchObject({count:2,label:'Нет доступа к ноде',tone:'action'});
  const malformed={...base,deliveryIssue:'https://secret.test/token'} as unknown as ChatEntry;
  expect(deliveryAttention([malformed])?.detail).not.toContain('secret');
});
it('separates file slots, profile quota and storage in delivery indicators',()=>{
  for(const [code,label] of Object.entries({node_file_limit:'Лимит файлов ноды',profile_file_limit:'Квота файлов профиля',node_storage_limit:'Нет места для очереди',node_message_limit:'Лимит конвертов',profile_message_limit:'Квота отправителя'})) {
    const issue=deliveryIssueForError(new Error(code),'node_unavailable');
    expect(deliveryAttention([{...base,deliveryIssue:issue}])).toMatchObject({label,tone:'action'});
  }
  expect(deliveryIssueForError(new Error('mailbox_full'),'node_unavailable')).toBe('node_full');
});
