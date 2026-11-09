import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import HomeNodePanel from './HomeNodePanel.svelte';
import ConnectionIndicators from '$lib/transport/ConnectionIndicators.svelte';
import NodeStartGuide from './NodeStartGuide.svelte';
import { emptyCourierState } from './courier-state';
import { idleCourierStatus } from './courier-controller';
import {sourceMessages} from '$lib/i18n/catalog';
const props = { address: '', signer: () => null, addSignaling: async () => {}, trusted: true, offlineNode: null,
  offlineEnabled: false, offlineError: '', pendingCount: 0, configureOffline: async () => {}, courierState: emptyCourierState(),
  courierError: '', configureCourier: async () => {}, courierStatus: idleCourierStatus(), waitingCount: 0,
  receivingReady: true, receiveKeys: 16 };
describe('network settings rendered sections', () => {
  it('makes home hardware the first option without promising a phone daemon or serverless Internet',()=>{
    const html=render(NodeStartGuide,{props:{busy:false,onSetup(){}}}).body;
    expect(html).toContain('Своя нода дома');expect(html).toContain('Отдельный сервер арендовать не обязательно');
    expect(html).toContain('без сна');expect(html).toContain('Справка: доступность домашней ноды');
    expect(Object.values(sourceMessages).some(text=>text.includes('Телефон пока не поддерживается')&&text.includes('интернет-маршрут'))).toBe(true);
    expect(html).toContain('Магазина размещения пока нет');
  });
  it('keeps Connect setup short and separate from queue explanations', () => {
    const html = render(HomeNodePanel, { props: { ...props, mode: 'outgoing', setupOnly: true } }).body;
    expect(html).toContain('Приглашение или адрес ноды');
    expect(html).not.toContain('Доставка моих сообщений');
    expect(html).not.toContain('Всего подготовленных конвертов');
  });
  it('does not mix outgoing node setup with receiving or legacy LAN forms', () => {
    const outgoing = render(HomeNodePanel, { props: { ...props, mode: 'outgoing' } }).body;
    expect(outgoing).toContain('Отправка через ноду'); expect(outgoing).toContain('Приглашение или адрес ноды');
    expect(outgoing).toContain('Сканировать QR');expect(outgoing).toContain('Из изображения');
    expect(outgoing).not.toContain('Мой входящий ящик в LAN'); expect(outgoing).not.toContain('Разрешить отправителю');
    const incoming = render(HomeNodePanel, { props: { ...props, mode: 'incoming' } }).body;
    expect(incoming).toContain('Получение сообщений'); expect(incoming).toContain('Справка: получение сообщений');
    expect(Object.values(sourceMessages).some(text=>text.includes('Собственная нода и одновременное присутствие отправителя не требуются'))).toBe(true);
    expect(incoming).not.toContain('Приглашение или адрес ноды'); expect(incoming).not.toContain('Код привязки');
    expect(incoming).not.toContain('Мой входящий ящик в LAN');
    const advanced = render(HomeNodePanel, { props: { ...props, mode: 'incoming', legacyOnly: true } }).body;
    expect(advanced).toContain('Мой входящий ящик в LAN'); expect(advanced).toContain('Приглашение или адрес ноды');
  });
  it('renders separate small outgoing and receiving indicators', () => {
    const result = render(ConnectionIndicators, { props: { nodes: [], directCount: 0, serversEnabled: true, onOpen: () => {},
      courierEnabled: false, courierStatus: idleCourierStatus(), courierPending: 0, trusted: true, receiveKeys: 16 } }).body;
    expect(result).toContain('Нода ↑'); expect(result).toContain('Приём ↓'); expect(result).toContain('Интернет');
  });
  it('can replace the five indicators with one accessible summary control', () => {
    const result = render(ConnectionIndicators, { props: { nodes: [], directCount: 1, serversEnabled: true, onOpen: () => {},
      courierEnabled: false, courierStatus: idleCourierStatus(), courierPending: 0, trusted: true, receiveKeys: 16, compact: true } }).body;
    expect(result.match(/<button/g)).toHaveLength(1);
    expect(result).toContain('Есть соединение'); expect(result).toMatch(/class="summary-dot[^\"]* connected"/);
    expect(result).not.toContain('Нода ↑');
  });
});
