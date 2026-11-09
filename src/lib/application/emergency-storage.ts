export type EmergencyStoragePort = {
  announce(): void;
  stop(): void;
  drain(): Promise<void>;
  clearHistory(): Promise<void>;
  clearCoreState?(): Promise<void>;
  clearProfiles?(): Promise<void>;
  clearVault(): void;
  clearCache(): Promise<void>;
};
// Always try all categories, even after an individual storage API failure.
// Cancellation of active sessions happens synchronously, before yielding.
export async function eraseApplicationData(port: EmergencyStoragePort): Promise<string[]> {
  const failed: string[] = [];
  try { port.announce(); } catch { failed.push('координация вкладок'); }
  try { port.stop(); } catch { failed.push('завершение сеансов'); }
  try { await port.drain(); } catch { failed.push('фоновые записи'); }
  try { await port.clearHistory(); } catch { failed.push('история и вложения'); }
  try { await port.clearCoreState?.(); } catch { failed.push('состояние ядра'); }
  try { await port.clearProfiles?.(); } catch { failed.push('профили'); }
  try { port.clearVault(); } catch { failed.push('сейф'); }
  try { await port.clearCache(); } catch { failed.push('офлайн-кэш'); }
  return failed;
}
