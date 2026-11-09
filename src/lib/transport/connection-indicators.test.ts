import { describe, expect, it } from 'vitest';
import { connectionIndicators, deliveryIndicators, connectionOverview } from './connection-indicators';
import type { NodeState } from './RoutedWebRTCTransport';
const internet: NodeState = { url: 'wss://automesh.space/signal', kind: 'internet', status: 'connected', alias: false, error: '' };
const lan: NodeState = { url: 'wss://192.168.0.1:3002/signal', kind: 'lan', status: 'idle', alias: false, error: '' };
describe('connection indicators (not a connectivity scanner)', () => {
  it('lights the summary for any actual signaling, peer or node connection, not stored keys or a saved URL', () => {
    expect(connectionOverview(connectionIndicators([internet, lan], 0, true)).connected).toBe(true);
    expect(connectionOverview(connectionIndicators([], 1, false)).connected).toBe(true);
    expect(connectionOverview(connectionIndicators([lan], 0, true), true).connected).toBe(true);
    expect(connectionOverview(connectionIndicators([{ ...internet, status: 'offline' }], 0, true)).connected).toBe(false);
    expect(connectionOverview(connectionIndicators([internet], 0, true, false)).connected).toBe(false);
    expect(connectionOverview(connectionIndicators([{ ...lan, status: 'reconnecting' }], 0, true))).toMatchObject({ connected: false, connecting: true });
  });
  it('separates an accessible LAN node from its internet relay and receiving readiness', () => {
    const status = { connection: 'connected' as const, relay: 'retrying', stored: 7 };
    expect(deliveryIndicators(true, status, 7, true, true, 16).map(r => r.state)).toEqual(['offline', 'connected']);
    const ready = deliveryIndicators(true, { ...status, relay: 'connected' }, 7, true, true, 16);
    expect(ready[0].label).toContain('7'); expect(ready[0].state).toBe('connected'); expect(ready[0].detail).toContain('ещё не доставка');
    expect(deliveryIndicators(false, status, 0, false, true, 16).map(r => r.state)).toEqual(['disabled', 'disabled']);
    expect(deliveryIndicators(true, { ...status, connection: 'offline' }, 0, true, false, 0).map(r => r.state)).toEqual(['offline', 'offline']);
  });
  it('distinguishes signaling from active peer channels', () => {
    const rows = connectionIndicators([internet, lan], 0, true);
    expect(rows.map(row => row.state)).toEqual(['connected', 'offline', 'offline']);
    expect(rows[0].detail).toContain('не проверка всего интернета');
    expect(connectionIndicators([], 2, false).map(row => row.state)).toEqual(['disabled', 'disabled', 'connected']);
  });
  it('reports connecting, missing nodes, and registry aliases without claiming stale aliases are online', () => {
    expect(connectionIndicators([{ ...lan, status: 'reconnecting' }], 0, true)[1].state).toBe('connecting');
    expect(connectionIndicators([], 0, true)[1].detail).toBe('Сервер не настроен');
    expect(connectionIndicators([{ ...lan, alias: true }, internet], 0, true)[1].state).toBe('offline');
    expect(connectionIndicators([{ ...lan, alias: true }, { ...internet, status: 'offline' }], 0, true)[1].state).toBe('offline');
  });
});
