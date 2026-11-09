import { decodeAccountId } from './bech32m.js';

// A visual hint only. The account ID and verified signature are the identity proof.
export function identiconFor(accountId: string): string {
  const fingerprint = decodeAccountId(accountId);
  if (!fingerprint) return '';
  const hue = Math.floor((fingerprint[0] / 255) * 360);
  const saturation = 50 + (fingerprint[1] % 25);
  const color = `hsl(${hue} ${saturation}% 40%)`;
  const cells: string[] = [];
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 3; column++) {
      if ((fingerprint[2 + row * 3 + column] & 1) === 0) continue;
      cells.push(`<rect x="${column * 8}" y="${row * 8}" width="8" height="8"/>`);
      if (column < 2) cells.push(`<rect x="${(4 - column) * 8}" y="${row * 8}" width="8" height="8"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#f4f4f4"/><g fill="${color}">${cells.join('')}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
