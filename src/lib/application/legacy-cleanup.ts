// Narrow, best-effort migration. Never parse logs or touch account/history keys.
export function removeLegacyBrowserLogs(storage: () => Pick<Storage, 'removeItem'>): void {
  try { storage().removeItem('debugLogs'); }
  catch { /* Restricted storage must not prevent login. */ }
}
