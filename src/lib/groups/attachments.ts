import { bytesToBase64 } from 'ts-mls';
import { FILE_CHUNK_BYTES, sha256Hex, type FileOffer } from '$lib/chat/file-transfer';
import { epochOf, groupAudience, type GroupEntry, type GroupRoom } from './storage';
import type { GroupFileFrame, GroupTransport } from './protocol';

export const groupFileStorageId = (group: string, hash: string) => `group-file:${group}:${hash}`;
const REQUEST_TIMEOUT = 12_000;
const CONCURRENT_TRANSFERS = 2;

export type GroupFileStore = {
  read(group: string, hash: string): Promise<Uint8Array | null>;
  write(group: string, hash: string, bytes: Uint8Array): Promise<void>;
};
export type GroupFilePayload = Pick<FileOffer, 'name' | 'mime' | 'details'> & { bytes: Uint8Array };
export type StagedGroupFile = { group: string; hash: string; bytes: Uint8Array };

type FileEntry = GroupEntry & { file: NonNullable<GroupEntry['file']> };
type Reference = Pick<GroupFileFrame, 'group' | 'hash' | 'request' | 'epoch'>;
type Pending = Reference & {
  peer: string;
  bytes: Uint8Array;
  offset: number;
  timer?: ReturnType<typeof setTimeout>;
  finish(success: boolean): void;
};

export class GroupAttachments {
  private pending = new Map<string, Pending>();
  private downloads = new Map<string, Promise<void>>();
  private sharing = new Set<string>();
  private closed = false;

  constructor(private readonly port: {
    self: string;
    room(id: string): GroupRoom | undefined;
    active(): boolean;
    allowed(peer: string): boolean;
    transport: GroupTransport;
    files: GroupFileStore;
    trackTransfer?(group: string, hash: string): () => void;
  }) {}

  private entry(group: string, hash: string, peer?: string, epoch?: number): { room: GroupRoom; entry: FileEntry } | undefined {
    if (this.closed || !this.port.active()) return;
    const room = this.port.room(group);
    if (!room?.mls || room.departed || room.leaving || (room.plan && !room.plan.key) || !room.members.includes(this.port.self) ||
        (epoch !== undefined && epochOf(room) !== epoch)) return;
    const entry = room.entries.find(message => message.hash === hash);
    if (!entry?.file) return;
    const audience = groupAudience(room, entry);
    if (!audience.includes(this.port.self) || (peer !== undefined &&
      (!room.members.includes(peer) || !audience.includes(peer) || !this.port.allowed(peer) || !this.port.transport.ready(peer)))) return;
    return { room, entry:entry as FileEntry };
  }

  async read(group: string, hash: string): Promise<Uint8Array | null> {
    const current = this.entry(group, hash);
    if (!current) return null;
    const bytes = await this.port.files.read(group, hash);
    if (bytes && bytes.length === current.entry.file.size && await sha256Hex(bytes) === current.entry.file.sha256 && this.entry(group, hash)) return bytes;
    bytes?.fill(0);
    return null;
  }

  obtain(group: string, hash: string): Promise<void> {
    const id = groupFileStorageId(group, hash);
    const existing = this.downloads.get(id);
    if (existing) return existing;
    if (this.downloads.size >= CONCURRENT_TRANSFERS) return Promise.reject(new Error('group_file_busy'));
    const transfer = this.fetch(group, hash).finally(() => this.downloads.delete(id));
    this.downloads.set(id, transfer);
    return transfer;
  }

  private async fetch(group: string, hash: string): Promise<void> {
    const current = this.entry(group, hash);
    if (!current) throw new Error('group_file_unavailable');
    const saved = await this.read(group, hash);
    if (saved) { saved.fill(0); return; }
    const { room, entry } = current;
    const epoch = epochOf(room);
    const peers = [...new Set([entry.from, entry.route?.peer ?? entry.from, ...room.members])];
    const bytes = new Uint8Array(entry.file.size);
    try {
      if (!bytes.length && await sha256Hex(bytes) === entry.file.sha256 && this.entry(group, hash, undefined, epoch)) {
        await this.port.files.write(group, hash, bytes);
        return;
      }
      for (const peer of peers) {
        if (!this.entry(group, hash, undefined, epoch)) break;
        if (peer === this.port.self || !this.entry(group, hash, peer, epoch)) continue;
        const ref = { group, hash, epoch, request:crypto.randomUUID() };
        if (!await this.request(peer, ref, bytes)) continue;
        if (await sha256Hex(bytes) !== entry.file.sha256) continue;
        const latest = this.entry(group, hash, undefined, epoch);
        if (!latest?.room.members.includes(peer) || !this.port.allowed(peer)) continue;
        await this.port.files.write(group, hash, bytes);
        return;
      }
      throw new Error('group_file_unavailable');
    } finally { bytes.fill(0); }
  }

  private request(peer: string, ref: Reference, bytes: Uint8Array): Promise<boolean> {
    return new Promise(resolve => {
      const pending: Pending = { ...ref, peer, bytes, offset:0, finish:success => {
        clearTimeout(pending.timer);
        this.pending.delete(ref.request);
        resolve(success);
      } };
      this.pending.set(ref.request, pending);
      pending.timer = setTimeout(() => pending.finish(false), REQUEST_TIMEOUT);
      void this.port.transport.send(peer, { ...ref, type:'file-request' }).catch(() => pending.finish(false));
    });
  }

  receive(peer: string, frame: GroupFileFrame): void {
    if (frame.type === 'file-request') { void this.share(peer, frame); return; }
    const pending = this.pending.get(frame.request);
    if (!pending || pending.peer !== peer || pending.group !== frame.group || pending.hash !== frame.hash ||
      pending.epoch !== frame.epoch || !this.entry(frame.group, frame.hash, peer, frame.epoch)) return;
    if (frame.type === 'file-unavailable') { pending.finish(false); return; }
    if (frame.type !== 'file-part' || frame.index !== pending.offset / FILE_CHUNK_BYTES) return;
    const remaining = pending.bytes.length - pending.offset;
    const text = atob(frame.data);
    if (text.length !== Math.min(remaining, FILE_CHUNK_BYTES)) { pending.finish(false); return; }
    for (let i = 0; i < text.length; i++) pending.bytes[pending.offset + i] = text.charCodeAt(i);
    pending.offset += text.length;
    if (pending.offset === pending.bytes.length) pending.finish(true);
    else {
      clearTimeout(pending.timer);
      pending.timer = setTimeout(() => pending.finish(false), REQUEST_TIMEOUT);
    }
  }

  private async share(peer: string, frame: GroupFileFrame): Promise<void> {
    const { group, hash, epoch, request } = frame;
    if (!this.entry(group, hash, peer, epoch)) return;
    if (this.sharing.has(peer) || this.sharing.size >= CONCURRENT_TRANSFERS) {
      await this.port.transport.send(peer, { group, hash, epoch, request, type:'file-unavailable' }).catch(() => {});
      return;
    }
    this.sharing.add(peer);
    let bytes: Uint8Array | null = null;
    let stop: (() => void) | undefined;
    try {
      bytes = await this.read(group, hash);
      if (!bytes && this.entry(group, hash, peer, epoch))
        await this.port.transport.send(peer, { group, hash, epoch, request, type:'file-unavailable' });
      if (!bytes) return;
      for (let offset = 0; offset < bytes.length; offset += FILE_CHUNK_BYTES) {
        if (!this.entry(group, hash, peer, epoch)) break;
        if (!offset) stop = this.port.trackTransfer?.(group, hash);
        await this.port.transport.send(peer, { group, hash, epoch, request, type:'file-part', index:offset / FILE_CHUNK_BYTES,
          data:bytesToBase64(bytes.subarray(offset, offset + FILE_CHUNK_BYTES)) });
      }
    } catch { /* The recipient can try again after the direct route recovers. */ }
    finally { stop?.(); bytes?.fill(0); this.sharing.delete(peer); }
  }

  peerOffline(peer: string): void {
    for (const pending of this.pending.values()) if (pending.peer === peer) pending.finish(false);
  }

  close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) pending.finish(false);
  }
}
