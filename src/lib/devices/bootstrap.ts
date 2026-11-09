import { isValidAccountId } from '../addressing/bech32m.js';
import type { DeviceEvent } from './delivery';
const PREFIX = '\0automesh-device-bootstrap-v1:';
export type DeviceBootstrap = { nickname: string; contacts: Array<{ address: string; name: string }> };
export function deviceBootstrapPackets(data: DeviceBootstrap): string[] {
  const packets: string[] = []; let contacts: DeviceBootstrap['contacts'] = [];
  const pack = () => PREFIX + JSON.stringify({ nickname: data.nickname.slice(0, 32), contacts });
  for (const contact of data.contacts.slice(0, 50)) {
    const item = { address: contact.address, name: contact.name.slice(0, 32) }; contacts.push(item);
    if (new TextEncoder().encode(pack()).length > 3500) { contacts.pop(); packets.push(pack()); contacts = [item]; }
  }
  packets.push(pack());
  return packets;
}
export function readDeviceBootstrap(event: DeviceEvent, owner: string): DeviceBootstrap | null {
  if (!event.text.startsWith(PREFIX)) return null;
  // Only the authenticated physical owner can initialize another device.
  // A linked device's messaging permission cannot overwrite account contacts.
  if (event.from !== owner || event.to !== owner || event.authorDevice !== owner || new TextEncoder().encode(event.text).length > 4096) throw new Error('device_bootstrap_denied');
  const data = JSON.parse(event.text.slice(PREFIX.length)) as DeviceBootstrap;
  const name = (value: unknown) => typeof value === 'string' && value.length <= 32 && !/[\u0000-\u001f\u007f]/.test(value);
  if (!data || Object.keys(data).sort().join(',') !== 'contacts,nickname' || !name(data.nickname) || !Array.isArray(data.contacts) || data.contacts.length > 50 ||
    data.contacts.some(c => !c || Object.keys(c).sort().join(',') !== 'address,name' || !isValidAccountId(c.address) || !name(c.name)) ||
    new Set(data.contacts.map(c => c.address)).size !== data.contacts.length) throw new Error('device_bootstrap_denied');
  return data;
}
