export const DEFAULT_AUTO_LOCK_MINUTES = 15;

export function normalizeAutoLockMinutes(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1440
    ? value : DEFAULT_AUTO_LOCK_MINUTES;
}

export function autoLockIsDue(lastActivity: number, now: number, minutes: number): boolean {
  const duration = normalizeAutoLockMinutes(minutes);
  return duration > 0 && now - lastActivity >= duration * 60_000;
}

export function readReceiptsForMode(trusted: boolean, preference = true): boolean {
  return trusted && preference;
}
