import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import MessageText from './MessageText.svelte';
import NodeQueueBadges from './NodeQueueBadges.svelte';
import TransferBadges from './TransferBadges.svelte';
import MessageTools from './MessageTools.svelte';
import { messageStatus } from './message-presentation';
import type { ChatEntry } from './session-chats';
const message: ChatEntry = { id: 'one', from: 'alice', timestamp: 1, direction: 'outgoing', text: 'Hello', delivery: 'queued' };
const noop = () => {};
const props = { message, status: messageStatus(message), recipient: 'bob', shareText: message.text, openView: null,
  canReply: true, onOpen: noop, onClose: noop, onReply: noop, onForward: noop, onSelect: noop, onStop: noop,
  onDownload: noop, onDelete: noop, onPin: noop, loadShareFile: async () => { throw new Error('must not load automatically'); } };
describe('message components', () => {
  it('keeps compact queue/transfer counters passive inside the clickable chat row',()=>{
    const messages:ChatEntry[]=[{...message,delivery:'stored'},{...message,id:'stop',nodeQueue:'canceled'},
      {...message,id:'file',fileStatus:'sending',file:{id:'file',name:'x',size:10,mime:'text/plain',sha256:'a'.repeat(64)}}];
    expect(render(NodeQueueBadges,{props:{messages,compact:true}}).body).not.toContain('<button');
    expect(render(TransferBadges,{props:{messages,compact:true}}).body).not.toContain('<button');
    const active=render(NodeQueueBadges,{props:{messages,onJump:noop,onClear:noop}}).body;
    expect(active).toContain('На ноде');expect(active).toContain('Отменено вами');expect(active).toContain('Очистить счётчик');
  });
  it('offers cancellation and explicit retry only on the corresponding message states',()=>{
    expect(render(MessageTools,{props:{...props,openView:'menu',onCancelNode:noop}}).body).toContain('Отменить на ноде');
    const canceled={...message,nodeQueue:'canceled' as const};
    const html=render(MessageTools,{props:{...props,message:canceled,openView:'menu',onCancelNode:noop,onRetryNode:noop}}).body;
    expect(html).toContain('Отправить снова');expect(html).not.toContain('Отменить на ноде');
  });
  it('enlarges a standalone emoji but not a sentence or multiple emoji',()=>{
    expect(render(MessageText,{props:{text:'👨‍👩‍👧‍👦'}}).body).toContain('emoji-only');
    expect(render(MessageText,{props:{text:'hello 👋'}}).body).not.toContain('emoji-only');
    expect(render(MessageText,{props:{text:'👋👋'}}).body).not.toContain('emoji-only');
  });
  it('escapes markup and emits no images, scripts or preview requests', () => {
    const html = render(MessageText, { props: { text: '<img src=x onerror=alert(1)> https://site.com/?a=1&b=2 http://site.com/' } }).body;
    expect(html).not.toContain('<img'); expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img'); expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('rel="noopener noreferrer"'); expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('insecure');
  });
  it('does not expose the action list before a user opens it', () => {
    const html = render(MessageTools, { props }).body;
    expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('<dialog');
    expect(html).not.toContain('Удалить у меня');
  });
  it('offers all requested actions when relevant, without loading a file', () => {
    const html = render(MessageTools, { props: { ...props, message: { ...message, fileStatus: 'sending', file: { id: 'one', name: 'x.png', size: 10, mime: 'image/png', sha256: 'a'.repeat(64) } }, openView: 'menu' } }).body;
    for (const label of ['Ответить', 'Переслать', 'Выбрать', 'Остановить передачу', 'Поделиться вне Automesh', 'Скачать', 'Подробнее о статусе', 'Проверить путь', 'Удалить у меня']) expect(html).toContain(label);
  });
  it('does not claim an invented route', () => {
    const html = render(MessageTools, { props: { ...props, openView: 'route' } }).body;
    expect(html).toContain('Полный сетевой маршрут неизвестен'); expect(html).not.toContain('подписи автора и пересыльщика проверены');
  });
  it('offers radio retry only when the application provides a connected radio action',()=>{
    const menu={...props,openView:'menu' as const,message:{...message,radioDelivery:'retry' as const}};
    expect(render(MessageTools,{props:menu}).body).not.toContain('Повторить по LoRa');
    expect(render(MessageTools,{props:{...menu,onRetryRadio:noop}}).body).toContain('Повторить по LoRa');
  });
});
