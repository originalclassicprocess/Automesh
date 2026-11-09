import type { NodeState } from './RoutedWebRTCTransport';
import type { CourierStatus } from '$lib/node/courier-controller';
export type ConnectionIndicator = { label: string; state: 'connected' | 'connecting' | 'offline' | 'disabled'; detail: string;
  section?: 'direct' | 'servers' | 'outgoing' | 'incoming' | 'radio' };
export function connectionOverview(indicators: readonly ConnectionIndicator[], nodeConnected = false) {
  const connected = nodeConnected || indicators.some(item => item.state === 'connected');
  const connecting = !connected && indicators.some(item => item.state === 'connecting');
  return { connected, connecting, label: connected ? 'Есть соединение' : connecting ? 'Подключаемся' : 'Нет соединений' };
}
export function deliveryIndicators(enabled: boolean, status: CourierStatus, pending: number, trusted: boolean, receivingReady: boolean, receiveKeys: number): ConnectionIndicator[] {
  const state = !enabled && !pending ? 'disabled' : status.connection === 'checking' ? 'connecting'
    : status.connection === 'connected' && (status.relay === 'connected' || status.lan === 'connected') ? 'connected' : 'offline';
  return [{ label: pending ? `Нода ↑ · ${pending}` : 'Нода ↑', state, section: 'outgoing',
    detail: !enabled && !pending ? 'Отправка через ноду выключена' : status.connection !== 'connected' ? 'Связь с вашей нодой не подтверждена'
      : status.relay !== 'connected' && status.lan !== 'connected' ? 'Нода доступна, но маршруты доставки ещё не подключены'
      : `Доступные маршруты ноды: ${[status.lan === 'connected' ? 'LAN' : '', status.relay === 'connected' ? 'интернет' : ''].filter(Boolean).join(', ')}; без квитанции: ${pending}. Это ещё не доставка получателю.` },
    { label: 'Приём ↓', section: 'incoming', state: !trusted ? 'disabled' : receivingReady && receiveKeys > 0 ? 'connected' : 'offline',
      detail: !trusted ? 'Отложенное получение требует доверенного режима' : !receivingReady ? 'Основной канал получения не подтверждён. HTTPS-получение с нод собеседников показано в диагностике.'
        : receiveKeys ? 'Канал подключён, ключи получения есть. Это не подтверждение доставки от всех контактов.' : 'Нет действующих ключей получения. Пополнение через ноду или прямое соединение проверяется отдельно.' }];
}
export function connectionIndicators(nodes: NodeState[], directCount: number, serversEnabled: boolean, internetEnabled = true): ConnectionIndicator[] {
  const result: ConnectionIndicator[] = (['internet', 'lan'] as const).map(kind => {
    const rows = nodes.filter(node => node.kind === kind);
    const disabled = !serversEnabled || (kind === 'internet' && !internetEnabled);
    const state = disabled ? 'disabled' : rows.some(n => n.status === 'connected') ? 'connected'
      : rows.some(n => n.status === 'connecting' || n.status === 'reconnecting') ? 'connecting' : 'offline';
    const label = kind === 'internet' ? 'Интернет' : 'LAN';
    const detail = disabled ? kind === 'internet' && !internetEnabled ? 'Интернет-связь чатов отключена: только LAN' : 'Серверные подключения выключены' : !rows.length ? 'Сервер не настроен'
      : state === 'connected' ? 'Сервер подключения доступен; это не проверка всего интернета'
      : state === 'connecting' ? 'Подключение к серверу…' : 'Сервер подключения недоступен';
    return { label, state, detail };
  });
  result.push({ label: directCount ? `P2P · ${directCount}` : 'P2P', section: 'direct', state: directCount ? 'connected' : 'offline',
    detail: directCount ? `Активные прямые соединения: ${directCount}` : 'Нет активных соединений с собеседниками' });
  return result;
}
