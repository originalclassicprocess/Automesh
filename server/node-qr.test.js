import { expect, it } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { nodeInvite, parseNodeInvite } from '../src/lib/transport/network-settings';

it('decodes the actual generated node QR including its Unicode name, entirely offline', () => {
  const node = { url: 'wss://192.168.0.169:3002/signal', name: 'Домашний узел', enabled: true };
  const modules = QRCode.create(nodeInvite(node)).modules;
  const scale = 5; const margin = 4; const size = (modules.size + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const column = Math.floor(x / scale) - margin; const row = Math.floor(y / scale) - margin;
    const black = column >= 0 && row >= 0 && column < modules.size && row < modules.size && modules.get(row, column);
    const offset = (y * size + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = black ? 0 : 255;
    pixels[offset + 3] = 255;
  }
  const read = jsQR(pixels, size, size);
  expect(read).not.toBeNull();
  expect(parseNodeInvite(read.data, 'https://app.example/')).toEqual(node);
});
