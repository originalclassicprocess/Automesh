import type { FileOffer } from '$lib/chat/file-transfer';
import type { AttachmentManifest } from './attachment-crypto';
export type CourierFileIO = {
  load(peer: string, id: string): Promise<Uint8Array | null>;
  offer(peer: string, offer: FileOffer, timestamp: number, courier: string): void;
  accepted(peer: string, id: string): boolean;
  progress(peer: string, id: string, bytes: number, uploading: boolean): void;
  complete(peer: string, id: string, bytes: Uint8Array): Promise<void>;
  savePart(peer: string, id: string, index: number, bytes: Uint8Array): Promise<void>;
  loadPart(peer: string, id: string, index: number): Promise<Uint8Array | null>;
  cleanup(peer: string, id: string, chunks: number): Promise<void>;
};
export const manifestContent = (m: AttachmentManifest) => (m.offer.details?.ephemeral ? '\u0000automesh-attachment-v2:' : '\u0000automesh-attachment-v1:') + JSON.stringify(m);
