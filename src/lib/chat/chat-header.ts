export function otherUnreadCount(rows: Record<string, { unread: number }>, active: string): number {
  return Object.entries(rows).reduce((sum, [peer, row]) => sum + (peer !== active && Number.isSafeInteger(row.unread) && row.unread > 0 ? row.unread : 0), 0);
}
