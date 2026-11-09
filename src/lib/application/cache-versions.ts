const PREFIX = 'mesh-autonomy-shell-';

// Never remove another app's caches, live-tab versions, or newer installations.
// Unknown/legacy/suspended tabs conservatively keep all old app caches.
export function obsoleteCaches(names: string[], current: string, clients: Array<string | null>): string[] {
  const index = names.indexOf(current);
  if (index < 0 || clients.some(version => version === null)) return [];
  const needed = new Set(clients.map(version => `${PREFIX}${version}`)); needed.add(current);
  return names.slice(0, index).filter(name => name.startsWith(PREFIX) && !needed.has(name));
}
