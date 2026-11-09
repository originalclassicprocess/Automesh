// Reproducible dependency-free PNG icons for the installable web app.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = new URL('../static/', import.meta.url);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const tag = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, checksum]);
}

function isLine(x, y, ax, ay, bx, by, width) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= width;
}

function color(x, y) {
  const nodes = [[20, 20], [44, 20], [32, 44]];
  if (nodes.some(([nx, ny]) => Math.abs(x - nx) <= 6 && Math.abs(y - ny) <= 6)) {
    if (nodes.some(([nx, ny]) => Math.abs(x - nx) <= 2.5 && Math.abs(y - ny) <= 2.5)) {
      return [255, 255, 255, 255];
    }
    return [72, 214, 186, 255];
  }
  if (isLine(x, y, 20, 20, 44, 20, 2.4) ||
      isLine(x, y, 20, 20, 32, 44, 2.4) ||
      isLine(x, y, 44, 20, 32, 44, 2.4)) {
    return [72, 214, 186, 255];
  }
  return [23, 38, 63, 255];
}

function makeIcon(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const rgba = color((x + 0.5) * 64 / size, (y + 0.5) * 64 / size);
      for (let channel = 0; channel < 4; channel++) pixels[row + 1 + x * 4 + channel] = rgba[channel];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(fileURLToPath(new URL(`icon-${size}.png`, root)), png);
}

for (const size of [192, 512]) makeIcon(size);
