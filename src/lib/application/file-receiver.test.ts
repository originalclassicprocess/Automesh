import { describe, expect, it } from 'vitest';
import { FileReceiver } from './file-receiver';
import { FILE_CHUNK_BYTES, MAX_FILE_BYTES } from '$lib/chat/file-transfer';

describe('bounded ordered file reassembly', () => {
  it('reassembles full chunks and a final short chunk', () => {
    const receiver = new FileReceiver(FILE_CHUNK_BYTES + 3);
    receiver.append(0, new Uint8Array(FILE_CHUNK_BYTES).fill(7)); receiver.append(1, new Uint8Array([1, 2, 3]));
    expect(receiver.received).toBe(FILE_CHUNK_BYTES + 3); expect(receiver.nextIndex).toBe(2);
    expect(receiver.bytes.slice(-3)).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => receiver.append(2, new Uint8Array())).toThrow();
  });
  it('rejects duplicates, gaps and wrong lengths without advancing', () => {
    const receiver = new FileReceiver(FILE_CHUNK_BYTES + 3);
    for (const [index, size] of [[1, FILE_CHUNK_BYTES], [0, 1], [0, FILE_CHUNK_BYTES + 1]]) {
      expect(() => receiver.append(index, new Uint8Array(size))).toThrow();
      expect(receiver.received).toBe(0);
    }
    receiver.append(0, new Uint8Array(FILE_CHUNK_BYTES));
    expect(() => receiver.append(0, new Uint8Array(3))).toThrow();
    expect(() => receiver.append(1, new Uint8Array(4))).toThrow();
    expect(receiver.received).toBe(FILE_CHUNK_BYTES);
  });
  it('bounds allocation and treats empty files as already complete', () => {
    for (const size of [-1, 1.5, NaN, MAX_FILE_BYTES + 1]) expect(() => new FileReceiver(size)).toThrow('invalid_file_size');
    const empty = new FileReceiver(0); expect(empty.received).toBe(0);
    expect(() => empty.append(0, new Uint8Array())).toThrow();
  });
});
