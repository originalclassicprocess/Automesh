import { accountFromMnemonic } from '../application/account';
import { openBrowserProfileBundle } from './browser';
import type { ProfileRegistry } from '../core/profiles';

// Called only after password authentication of the root vault. Never silently
// omit a corrupt registry: exporting a seed-only file would lose profile metadata.
export async function readProfilesForBackup(seed: Uint8Array, accountId: string,
  isCurrent: () => boolean, factory?: IDBFactory): Promise<ProfileRegistry | undefined> {
  const account = await accountFromMnemonic(new TextDecoder('utf-8', { fatal: true }).decode(seed));
  let bundle: Awaited<ReturnType<typeof openBrowserProfileBundle>> | undefined;
  try {
    if (!isCurrent() || account.accountId !== accountId) throw new Error('profile_session_changed');
    bundle = await openBrowserProfileBundle({ root: account.identitySeed, scope: accountId, trusted: true, isCurrent, factory });
    try { return await bundle.read(); }
    catch (error) { if (error instanceof Error && error.message === 'profile_registry_missing') return undefined; throw error; }
  } finally { bundle?.close(); account.identitySeed.fill(0); account.provider.dispose(); }
}
