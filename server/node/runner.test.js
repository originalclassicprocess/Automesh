import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { privateIPv4, validateNodeConfig, createControlReservation } from './runner.js';
describe('explicit private node binding', () => {
  const interfaces = { wifi: [{ address: '192.168.4.2' }] };
  const config = { version: 1, lanAddress: '192.168.4.2', port: 3003, controlPort: 3004,
    dataDirectory: resolve('node-data'), pfxFile: resolve('node.pfx'), pfxPassword: 'not-a-seed',
    adminToken: 'a'.repeat(64), maxBytes: 64 * 1024 * 1024 };
  it('requires an actual private interface and two distinct unprivileged ports', () => {
    expect(validateNodeConfig(config, interfaces)).toBe(config);
    for (const change of [{ lanAddress: '0.0.0.0' }, { lanAddress: '192.168.4.3' }, { lanAddress: '8.8.8.8' },
      { port: 80 }, { controlPort: 3003 }, { dataDirectory: '../outside' }, { adminToken: '' },
      { maxMessages: 0 }, { maxMessages: 5001 }, { maxMessages: 1.5 }, { signalingEnabled: 'yes' }, { caFile: '../unexpected.cer' }])
      expect(() => validateNodeConfig({ ...config, ...change }, interfaces)).toThrow('invalid_node_config_or_lan_changed');
  });
  it('accepts explicit signaling control and bounded per-queue limits', () => {
    expect(validateNodeConfig({ ...config, maxMessages: 5000, signalingEnabled: false }, interfaces).maxMessages).toBe(5000);
  });
  it('does not mistake public IPv4 or loopback for a LAN binding', () => {
    expect(privateIPv4('172.31.1.2')).toBe(true); expect(privateIPv4('172.32.1.2')).toBe(false);
    expect(privateIPv4('127.0.0.1')).toBe(false); expect(privateIPv4('192.168.1.999')).toBe(false);
  });
  it('does not retain a GUI poll that arrives during control-port reservation', async () => {
    const reservation = createControlReservation(); reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const socket = createConnection({ host: '127.0.0.1', port: reservation.address().port });
    const closed = new Promise(resolveClose => socket.once('close', resolveClose));
    socket.on('error', () => {});
    const deadline = setTimeout(() => socket.destroy(new Error('reservation_failed_to_reject')), 1000);
    try {
      socket.end('GET /status HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n');
      await closed;
      expect(socket.errored?.message).not.toBe('reservation_failed_to_reject');
    } finally {
      clearTimeout(deadline); socket.destroy();
      await new Promise(resolveClose => reservation.close(resolveClose));
    }
  });
});
