import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import { connectionOverview } from './connection-overview';
import ConnectionDashboard from './ConnectionDashboard.svelte';
import DeliveryDiagnostics from './DeliveryDiagnostics.svelte';
import { emptyDeliveryDiagnostics } from './delivery-diagnostics';
const base = {signalingEnabled:true,signalingConnected:true,direct:0,queueSelected:false,queueEnabled:false,queueConnected:false,pending:2,receiveExpected:false,receiveConnected:false,rights:'direct' as const};
it('does not confuse signaling, admin bookmark, delivery and authorization', () => {
  expect(connectionOverview(base)).toMatchObject({signaling:'connected',queue:'unselected',receiver:'unselected',rights:'direct'});
  const html=render(ConnectionDashboard,{props:{state:connectionOverview(base),onOpen:()=>{}}}).body;
  expect(html).toContain('Нода доставки не выбрана');expect(html).toContain('Сигналинг и доступ к панели не подключают очередь');
});
it('keeps receiving distinct when new sending is disabled or signaling is paused', () => {
  const state=connectionOverview({...base,signalingEnabled:false,queueSelected:true,queueConnected:true,receiveConnected:true});
  expect(state).toMatchObject({signaling:'disabled',queue:'connected',receiver:'connected',paused:true});
  const html=render(ConnectionDashboard,{props:{state,onOpen:()=>{}}}).body;
  expect(html).toContain('Сигналинг выключен');expect(html).not.toContain('Серверные подключения приостановлены');
});
it('never declares a node obsolete before checking its capability', () => {
  const html=render(DeliveryDiagnostics,{props:{channel:'Не настроен',queueReachable:false,keys:32,diagnostics:emptyDeliveryDiagnostics(),onRetry:()=>{}}}).body;
  expect(html).toContain('Ещё не проверено');expect(html).not.toContain('Нужно обновление ноды');
});
