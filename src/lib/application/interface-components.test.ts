import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';
import HelpInfo from './HelpInfo.svelte';
import SettingsMenu from './SettingsMenu.svelte';
import MessageCard from '$lib/chat/MessageCard.svelte';
import MessageSelectionBar from '$lib/chat/MessageSelectionBar.svelte';
import OfflineKeyBadge from '$lib/chat/OfflineKeyBadge.svelte';
describe('minimal interface components', () => {
  it('uses one select-all checkbox and three labelled icon actions', () => {
    const body = render(MessageSelectionBar, { props: { messages: [{ id: 'one' }], selected: ['one'],
      onToggleAll: () => {}, onForward: () => {}, onDownload: () => {}, onDelete: () => {} } }).body;
    expect(body.match(/type="checkbox"/g)).toHaveLength(1);
    expect(body.match(/<button/g)).toHaveLength(3);
    expect(body).toContain('Снять выбор со всех сообщений');
    expect(body).toContain('Удалить выбранные сообщения у меня');
    expect(body).not.toContain('Снять выбор</button>');
  });
  it('keeps node details accessible without a persistent explanatory line', () => {
    const body = render(OfflineKeyBadge, { props: { budget: { count: 0, available: false, label: 'Нода не подключена', detail: 'Онлайн-чат доступен' },
      configured: false, connected: false, onOpen: () => {} } }).body;
    expect(body).toContain('aria-label="Доставка: нода и LoRa"');
    expect(body).toContain('title="Нода не подключена"');
    expect(body).toContain('aria-haspopup="dialog"');
    expect(body).not.toContain('>Нода не подключена<');
  });
  it('covers the complete message with one accessible native selection button', () => {
    const children = createRawSnippet(() => ({ render: () => '<p>Public example</p>' }));
    const body = render(MessageCard, { props: { children, preview:'example', selecting:true, selected:true, onSelect: () => {} } }).body;
    expect(body).toContain('class="message-select'); expect(body).toContain('aria-pressed="true"');
    expect(body).toContain('inert'); expect(body.match(/<button/g)).toHaveLength(1);
    const normal = render(MessageCard, { props: { children, preview:'example', onSelect: () => {} } }).body;
    expect(normal).not.toContain('inert'); expect(normal).not.toContain('<button');
  });
  it('provides one help control with an expanded description', () => {
    const body = render(HelpInfo, { props: { label:'Справка: пример', text:'Описание функции', open:true } }).body;
    expect(body).toContain('aria-expanded="true"'); expect(body).toContain('role="note"'); expect(body).toContain('Описание функции');
  });
  it('shows a settings overview separately from section tabs', () => {
    const props = { items:[{ id:'security',label:'Безопасность' }], descriptions:{ security:'Пароль и резервная копия' }, backupWarning:true, onSelect:()=>{} };
    const root = render(SettingsMenu, { props:{ ...props, section:'overview' } }).body;
    expect(root).toContain('Меню настроек'); expect(root).toContain('Пароль и резервная копия');
    const detail = render(SettingsMenu, { props:{ ...props, section:'security' } }).body;
    expect(detail).toContain('Разделы настроек'); expect(detail).toContain('Все настройки');
    expect(detail).not.toContain('<select'); expect(detail).toContain('aria-haspopup="listbox"');expect(detail).toContain('Безопасность · !');
  });
});
