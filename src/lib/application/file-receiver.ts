import { FILE_CHUNK_BYTES, MAX_FILE_BYTES } from '$lib/chat/file-transfer';

// Ordered reassembly only. Acceptance, storage and the final SHA-256 check are
// application decisions; no file is acknowledged before those succeed.
export class FileReceiver {
  readonly bytes: Uint8Array;
  private index = 0;
  private offset = 0;
  get nextIndex() { return this.index; }
  get received() { return this.offset; }
  constructor(size: number) {
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new Error('invalid_file_size');
    this.bytes = new Uint8Array(size);
  }
  append(index: number, chunk: Uint8Array): void {
    const remaining = this.bytes.length - this.offset;
    if (remaining <= 0 || index !== this.index || chunk.length !== Math.min(FILE_CHUNK_BYTES, remaining))
      throw new Error('invalid_file_chunk_order_or_size');
    this.bytes.set(chunk, this.offset); this.offset += chunk.length; this.index++;
  }
}
