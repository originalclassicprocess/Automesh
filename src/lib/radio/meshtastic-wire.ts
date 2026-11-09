// Narrow, independently implemented Phone API codec. No firmware/SDK code is
// bundled. Wire field references: meshtastic/protobufs@ffd5ad428da6db4a7ddfe62e06548718cc2603e0.
export const PRIVATE_APP_PORT = 256; // Private experiment, not a registered application port.
export const TEXT_MESSAGE_APP=1;
// 215 + 6 bytes Data protobuf + 16 byte radio header + 12 byte PKI overhead
// stays below the firmware's 255 byte LoRa frame, including node PKI unicast.
export const RADIO_PAYLOAD_BYTES = 215;
export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
function varint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw Error('radio_invalid_integer');
  const bytes: number[] = []; do { const low = value % 128; value = Math.floor(value / 128); bytes.push(low | (value ? 128 : 0)); } while (value); return new Uint8Array(bytes);
}
export const uint = (field: number, value: number) => concat(varint(field * 8), varint(value));
export const binary = (field: number, bytes: Uint8Array) => concat(varint(field * 8 + 2), varint(bytes.length), bytes);
export function fixed(field: number, value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw Error('radio_invalid_integer');
  const data = new Uint8Array(4); new DataView(data.buffer).setUint32(0, value, true); return concat(varint(field * 8 + 5), data);
}
type Field = { wire: number; bytes?: Uint8Array; number?: number; integer?: bigint };
export function fields(input: Uint8Array): Map<number, Field> {
  if (input.length > 512) throw Error('radio_usb_frame_too_large');
  let offset = 0, count = 0; const result = new Map<number, Field>();
  function readVarint(): bigint {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      if (offset >= input.length) throw Error('radio_truncated_protobuf');
      const byte = input[offset++];
      // Protobuf int32 negatives (including MeshPacket.rx_rssi) are sign-extended
      // to uint64 on the wire. Unknown uint64 metadata must also remain skippable.
      if (i === 9 && byte > 1) throw Error('radio_protobuf_integer_overflow');
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) return value;
    } throw Error('radio_invalid_varint');
  }
  while (offset < input.length) {
    if (++count > 128) throw Error('radio_protobuf_field_limit');
    const rawTag = readVarint(); if (rawTag > 0xffffffffn) throw Error('radio_duplicate_or_invalid_field');
    const tag = Number(rawTag), field = Math.floor(tag / 8), wire = tag % 8;
    if (!field || result.has(field)) throw Error('radio_duplicate_or_invalid_field');
    if (wire === 0) {
      const integer = readVarint();
      result.set(field, { wire, integer, ...(integer <= BigInt(Number.MAX_SAFE_INTEGER) ? { number: Number(integer) } : {}) });
    }
    else {
      const rawSize = wire === 2 ? readVarint() : wire === 1 ? 8n : wire === 5 ? 4n : -1n;
      if (rawSize < 0n || rawSize > BigInt(input.length - offset)) throw Error('radio_truncated_protobuf');
      const size = Number(rawSize);
      if (size < 0 || offset + size > input.length) throw Error('radio_truncated_protobuf');
      const bytes = input.slice(offset, offset + size); offset += size;
      result.set(field, { wire, bytes, ...(wire === 5 ? { number: new DataView(bytes.buffer).getUint32(0, true) } : {}) });
    }
  } return result;
}
export function numberField(input: Map<number, Field>, field: number, fallback = 0): number {
  const value = input.get(field); if (!value) return fallback;
  if ((value.wire !== 0 && value.wire !== 5) || value.number === undefined || value.number > 0xffffffff) throw Error('radio_invalid_number'); return value.number;
}
export function int32Field(input: Map<number, Field>, field: number, fallback = 0): number {
  const value = input.get(field); if (!value) return fallback;
  if (value.wire !== 0 || value.integer === undefined ||
    (value.integer > 0xffffffffn && value.integer < 0xffffffff80000000n)) throw Error('radio_invalid_number');
  return Number(BigInt.asIntN(32, value.integer));
}
export function floatField(input: Map<number, Field>, field: number): number | undefined {
  const value = input.get(field); if (!value) return;
  if (value.wire !== 5 || !value.bytes) throw Error('radio_invalid_float');
  const number = new DataView(value.bytes.buffer,value.bytes.byteOffset,4).getFloat32(0,true);
  return Number.isFinite(number) ? number : undefined;
}
export function bytesField(input: Map<number, Field>, field: number): Uint8Array {
  const value = input.get(field); if (!value) return new Uint8Array();
  if (value.wire !== 2 || !value.bytes) throw Error('radio_invalid_bytes'); return value.bytes;
}
export function textField(input: Map<number, Field>, field: number): string { return new TextDecoder('utf-8', { fatal: true }).decode(bytesField(input, field)); }
export function nonzeroFloat(input: Map<number, Field>, field: number): boolean {
  const value = input.get(field); if (!value) return false;
  if (value.wire !== 5 || !value.bytes) throw Error('radio_invalid_float'); return new DataView(value.bytes.buffer).getFloat32(0, true) !== 0;
}
export function serialFrame(bytes: Uint8Array): Uint8Array {
  if (!bytes.length || bytes.length > 512) throw Error('radio_usb_frame_too_large');
  return concat(new Uint8Array([0x94, 0xc3, bytes.length >> 8, bytes.length & 255]), bytes);
}
export class SerialFrames {
  private buffer = new Uint8Array();
  feed(chunk: Uint8Array): Uint8Array[] {
    if (chunk.length > 65536) throw Error('radio_usb_input_limit');
    this.buffer = concat(this.buffer, chunk); const output: Uint8Array[] = []; let cursor = 0;
    while (cursor + 4 <= this.buffer.length) {
      if (this.buffer[cursor] !== 0x94 || this.buffer[cursor + 1] !== 0xc3) { cursor++; continue; }
      const length = this.buffer[cursor + 2] * 256 + this.buffer[cursor + 3];
      if (!length || length > 512) { cursor++; continue; }
      if (cursor + 4 + length > this.buffer.length) break;
      output.push(this.buffer.slice(cursor + 4, cursor + 4 + length)); cursor += 4 + length;
    }
    this.buffer = this.buffer.slice(cursor); return output;
  }
}
export function toRadioPacket(to: number, channel: number, id: number, payload: Uint8Array, wantAck = false): Uint8Array {
  if (to <= 0 || to >= 0xffffffff || !Number.isInteger(channel) || channel < 0 || channel > 7 || payload.length > RADIO_PAYLOAD_BYTES) throw Error('radio_invalid_destination_or_size');
  // Explicit opt-out from MQTT upload. No admin/configuration messages or broadcasts.
  const data = concat(uint(1, PRIVATE_APP_PORT), binary(2, payload), uint(9, 0));
  // A zero hop limit with want_ack is replaced by the firmware's configured
  // default. Use an explicit one-hop ceiling for acknowledged directed packets.
  const packet = concat(fixed(2, to), uint(3, channel), binary(4, data), fixed(6, id), uint(9, wantAck ? 1 : 0), uint(10, wantAck ? 1 : 0));
  return binary(1, packet);
}
export function toChannelTextPacket(channel:number,id:number,text:string):Uint8Array {
  const payload=new TextEncoder().encode(text);
  if(!Number.isInteger(channel)||channel<0||channel>7||!Number.isInteger(id)||id<=0||id>0xffffffff||!text.trim()||payload.length>200)throw Error('meshtastic_text_too_large');
  // Standard Meshtastic text from the board, broadcast to its configured channel.
  // Firmware reliability feedback uses an implicit ACK from a heard rebroadcast,
  // not individual ACKs from everyone. No application-level automatic retries.
  // MQTT upload is off; firmware retains its normal hop/airtime/retry policy.
  const data=concat(uint(1,TEXT_MESSAGE_APP),binary(2,payload),uint(9,0));
  return binary(1,concat(fixed(2,0xffffffff),uint(3,channel),binary(4,data),fixed(6,id),uint(10,1)));
}
