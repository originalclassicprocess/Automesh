import type { ChatEntry, SavedChats, SessionChats } from './session-chats';

// A queued snapshot can predate a committed cache-link transaction. Copy only
// its canonical references before the duplicate logical blobs are removed.
// Index each peer once: scanning its history for every message is quadratic.
// The caller must check the profile/generation and serialize the storage write.
export function preserveSnapshotMediaRefs(snapshot: SavedChats, current: SessionChats): void {
  for (const peer of snapshot.order) {
    const messages = snapshot.byPeer[peer]?.messages;
    const live = current.byPeer[peer]?.messages;
    if (!messages?.length || !live?.length) continue;
    const byId = new Map<string, ChatEntry>();
    for (const row of live) {
      // Keep the first match, as Array.find did, even for malformed duplicates.
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
    for (const message of messages) {
      const row = byId.get(message.id);
      if (!message.fileDeleted && row?.mediaRef && row.file?.sha256 === message.file?.sha256)
        message.mediaRef = row.mediaRef;
    }
  }
}
