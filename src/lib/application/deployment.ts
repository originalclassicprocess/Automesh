import { deploymentDefaults } from '../../../nodes/packages/deployment/src/defaults.js';
export { deploymentDefaults };

// Resolve at use time, not module initialization (SSR and cached PWA shells).
// A custom deployment shares its own address, never another operator's domain.
export function applicationOrigin(pageUrl?: string): string {
  const url = new URL(pageUrl ?? (typeof location === 'undefined' ? deploymentDefaults.appOrigin : location.href));
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('invalid_app_origin');
  return url.origin;
}
