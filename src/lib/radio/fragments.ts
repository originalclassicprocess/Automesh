import { concat, RADIO_PAYLOAD_BYTES } from './meshtastic-wire';
import { bytesToHex } from '$lib/message/encoding';
// Keep the existing fragmented wire layout. Short authenticated envelopes can
// travel directly, without a redundant fragment header or a second radio frame.
const HEADER = 24, PAYLOAD = 180 - HEADER;
export const MAX_RADIO_ENVELOPE = 1024;
export function fragment(bytes: Uint8Array, transfer = crypto.getRandomValues(new Uint8Array(16))): Uint8Array[] {
  if (transfer.length !== 16 || !bytes.length || bytes.length > MAX_RADIO_ENVELOPE) throw Error('radio_envelope_size');
  if (bytes.length <= RADIO_PAYLOAD_BYTES && bytes[3] === 0x45 && bytes[4] === 1) return [bytes.slice()];
  const count = Math.ceil(bytes.length / PAYLOAD);
  return Array.from({ length: count }, (_, index) => {
    const header = new Uint8Array(HEADER); header.set([0x4d, 0x41, 0x52, 1]); header.set(transfer, 4);
    header[20] = index; header[21] = count; new DataView(header.buffer).setUint16(22, bytes.length);
    return concat(header, bytes.slice(index * PAYLOAD, (index + 1) * PAYLOAD));
  });
}
export class RadioAssembly {
  private pending = new Map<string, { until: number; total: number; count: number; pieces: Map<number, Uint8Array> }>();
  constructor(private readonly now = Date.now) {}
  get pendingCount() { this.prune(); return this.pending.size; }
  private prune() { for (const [key, value] of this.pending) if (value.until <= this.now()) this.pending.delete(key); }
  clear() { this.pending.clear(); }
  add(frame: Uint8Array): Uint8Array | null {
    this.prune();
    if (frame.length >= 118 && frame.length <= RADIO_PAYLOAD_BYTES && frame[0] === 0x4d && frame[1] === 0x41 && frame[2] === 0x52 && frame[3] === 0x45 && frame[4] === 1) return frame.slice();
    if (frame.length <= HEADER || frame.length > RADIO_PAYLOAD_BYTES || frame[0] !== 0x4d || frame[1] !== 0x41 || frame[2] !== 0x52 || frame[3] !== 1) throw Error('radio_invalid_fragment');
    const id = bytesToHex(frame.slice(4, 20)), index = frame[20], count = frame[21];
    const total = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(22), content = frame.slice(HEADER);
    if (!total || total > MAX_RADIO_ENVELOPE || count !== Math.ceil(total / PAYLOAD) || index >= count || content.length !== Math.min(PAYLOAD, total - index * PAYLOAD)) throw Error('radio_invalid_fragment');
    let assembly = this.pending.get(id);
    if (!assembly) {
      if (this.pending.size >= 8) throw Error('radio_reassembly_limit');
      assembly = { until: this.now() + 180000, total, count, pieces: new Map() }; this.pending.set(id, assembly);
    }
    if (assembly.total !== total || assembly.count !== count) { this.pending.delete(id); throw Error('radio_fragment_conflict'); }
    const prior = assembly.pieces.get(index);
    if (prior && bytesToHex(prior) !== bytesToHex(content)) { this.pending.delete(id); throw Error('radio_fragment_conflict'); }
    assembly.pieces.set(index, content);
    if (assembly.pieces.size !== count) return null;
    this.pending.delete(id); return concat(...Array.from({ length: count }, (_, i) => assembly!.pieces.get(i)!));
  }
}
