import type { NavigationView } from './navigation-level';
// Deterministic hierarchy independent of how many sibling tabs were visited.
export function settingsParent<T extends NavigationView>(route:T):T|null {
  if (route.screen !== 'account' || route.view !== 'profile') return null;
  if (route.settings === 'connection' && route.connection && route.connection !== 'overview')
    return {...route,layer:'',connection:['connect','outgoing','incoming'].includes(route.connection) ? 'nodes' : 'overview'};
  if (route.settings === 'files' && route.media && route.media !== 'overview') return {...route,layer:'',media:'overview'};
  return route.settings !== 'overview' ? {...route,layer:'',settings:'overview',connection:'overview',media:'overview'} : null;
}
export function sameSettingsLocation(a:NavigationView,b:NavigationView):boolean {
  return a.screen===b.screen && a.view===b.view && !a.layer && !a.gallery && a.settings===b.settings &&
    (a.settings!=='connection'||a.connection===b.connection) && (a.settings!=='files'||a.media===b.media);
}
