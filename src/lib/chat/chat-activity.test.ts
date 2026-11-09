import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { chatActivity } from './chat-activity';
import ChatActivity from './ChatActivity.svelte';
import ConversationRow from './ConversationRow.svelte';
import type { ChatEntry, Conversation } from './session-chats';
const message: ChatEntry = { id:'m', from:'me', text:'Hello', timestamp:1, direction:'outgoing', delivery:'queued' };
const upload: ChatEntry = { ...message, file:{ id:'m', name:'file.png', mime:'image/png', size:100, sha256:'a'.repeat(64) },
  fileStatus:'sending', fileProgress:40, courierStage:'uploading' };
describe('compact chat activity', () => {
  it('shows progress instead of a stale reconnect warning and never claims delivery', () => {
    const status=chatActivity([{...upload,deliveryIssue:'node_unavailable'}]);
    expect(status).toMatchObject({label:'↑ 1 · 40%',tone:'success'});
    expect(status?.detail).not.toContain('Подключаемся к ноде');
    expect(chatActivity([{...upload,delivery:'stored'}])?.label).toBe('На ноде · 1');
    expect(chatActivity([{...upload,delivery:'delivered',fileStatus:'ready'}])).toBeNull();
  });
  it('keeps action failures prominent while retaining another transfer’s progress', () => {
    const status=chatActivity([upload,{...message,id:'quota',deliveryIssue:'node_profile_files_full'}]);
    expect(status).toMatchObject({tone:'warning',label:'Квота файлов профиля',transfer:'↑ 1 · 40%'});
    expect(status?.detail).toContain('profile_files');
  });
  it('distinguishes expiry and cancellation, and respects cleared counters', () => {
    expect(chatActivity([{...message,nodeQueue:'expired'}])).toMatchObject({tone:'danger',label:'Срок истёк · 1'});
    expect(chatActivity([{...message,nodeQueue:'canceling'}])).toMatchObject({tone:'danger',label:'Отменяем · 1'});
    expect(chatActivity([{...message,nodeQueue:'canceled'}])).toMatchObject({tone:'muted',label:'Отменено вами · 1'});
    expect(chatActivity([{...message,nodeQueue:'expired',nodeQueueDismissed:true}])).toBeNull();
  });
  it('does not hide an in-flight text envelope behind the file-only controls', () => {
    expect(chatActivity([{...message,courierStage:'preparing'}])).toMatchObject({tone:'success',label:'Отправляем на ноду · 1'});
  });
  it('keeps row activity passive and detailed counters inside a closed disclosure', () => {
    const conversation:Conversation={peerAddress:'example',messages:[upload],draft:'',unread:4,connection:'connected',error:'',sending:false,contact:'accepted'};
    const row=render(ConversationRow,{props:{accountId:'example',name:'Alice',conversation,onOpen:()=>{}}}).body;
    expect(row.match(/<button/g)).toHaveLength(1);
    expect(row).toContain('Непрочитанных: 4');
    expect(row).not.toContain('<details');
    const detail=render(ChatActivity,{props:{messages:[upload,{...message,id:'stored',delivery:'stored'}],onJump:()=>{}}}).body;
    expect(detail).toContain('<details');
    expect(detail).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    expect(detail).toContain('Отправка: 1');
    expect(detail.indexOf('aria-label="Передачи файлов"')).toBeLessThan(detail.indexOf('<details'));
    expect(row).toContain('↑ Отправка');
  });
  it('leaves uploads and downloads visible outside the disclosure even during cancellation', () => {
    const incoming={...upload,id:'receive',direction:'incoming' as const,courierStage:undefined,fileStatus:'receiving' as const,fileProgress:65};
    const html=render(ChatActivity,{props:{messages:[upload,incoming,{...message,id:'cancel',nodeQueue:'canceling'}],onJump:()=>{}}}).body;
    const closed=html.slice(0,html.indexOf('<details'));
    expect(closed).toContain('Отправка: 1');expect(closed).toContain('Получение: 1');
    expect(closed).toContain('40%');expect(closed).toContain('65%');
    expect(closed).toContain('Справка о передаче файлов');
    expect(closed).not.toContain('Для продолжения передачи оставьте приложение открытым.');
  });
});
