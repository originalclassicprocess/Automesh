import { routingEndpoints, signalingNodes, type NetworkSettings } from '$lib/transport/network-settings';
import { validatedSignalingUrl, isLocalHost, type SignalingEndpoint } from '$lib/transport/client-config';
import type { CourierState } from './courier-state';
import type { NodeState } from '$lib/transport/RoutedWebRTCTransport';

// A delivery role is not an optional discovery reserve. Respect explicit
// network policy and disabled entries; never bypass a user's LAN-only choice.
export function receiveRouting(base: SignalingEndpoint[], settings: NetworkSettings, pageUrl: string, courier: CourierState) {
  const endpoints = routingEndpoints(base, settings, pageUrl), required: string[] = [];
  const applicationUrls = new Set(base.filter(n => n.kind === 'internet').map(n => n.url));
  // The delivery node's public listener takes precedence over application
  // discovery; LAN listeners stay after public routes. Sort only the discovery
  // plan: an established encrypted direct channel is never migrated.
  const ordered = () => {
    const rank = (n: SignalingEndpoint) => n.kind === 'lan' ? 3 : required.includes(n.url) ? 0 : applicationUrls.has(n.url) ? 1 : 2;
    return { endpoints: endpoints.sort((a,b) => rank(a)-rank(b)), required };
  };
  if (settings.signalingEnabled === false || !courier.node ||
      !(courier.enabled || courier.keys.length || courier.pending.length || courier.incomingFiles.length)) return ordered();
  const url = new URL('/signal', courier.node.url); url.protocol = 'wss:';
  const kind = isLocalHost(url.hostname) ? 'lan' as const : 'internet' as const;
  if ((kind === 'internet' && settings.internetEnabled === false) ||
      !validatedSignalingUrl(url.href, pageUrl, kind) ||
      signalingNodes(base, settings).some(n => n.url === url.href && !n.enabled)) return ordered();
  if (!endpoints.some(n => n.url === url.href)) endpoints.push({ url: url.href, kind });
  required.push(url.href);
  return ordered();
}
// Only bounded explanations enter the interface, never raw server exceptions.
export function receptionFailure(required: string[], states: NodeState[]): string {
  if (!required.length || receptionChannel(required,states) === 'Подключён') return '';
  for (const url of required) {
    const node = states.find(n => n.url === url);
    if (!node || !['offline','error'].includes(node.status)) continue;
    if (node.error === 'signaling_registration_rejected') return 'Сервер отказал в регистрации канала получения. Проверьте доступ профиля к ноде.';
    if (['signaling_protocol_outdated','invalid_registration_challenge'].includes(node.error)) return 'Не удалось безопасно зарегистрировать канал. Проверьте совместимость клиента и ноды.';
    if (node.error === 'signaling_address_busy') return 'Предыдущее подключение профиля ещё занято. Повторим восстановление.';
    return 'Канал получения недоступен: не удалось соединиться с нодой. Повторим подключение.';
  }
  return '';
}
export function receptionChannel(required: string[], states: NodeState[]): string {
  if (!required.length) return 'Не настроен или отключён';
  return required.every(url => states.some(n => n.url === url && (n.status === 'connected' ||
    (n.alias && n.registryId && states.some(other => other.status === 'connected' && other.registryId === n.registryId)))))
    ? 'Подключён' : 'Восстанавливаем подключение';
}
