export type NavigationView = { screen: string; layer: string; view: string; pane: string;
  peer: string; card: string; settings: string; gallery: string; connection?:string; media?:string };
// Only used for in-memory comparisons; nothing here is written to browser history.
export function navigationLevel(route: NavigationView): string {
  if (route.screen !== 'account') return `${route.screen}:${route.layer}`;
  let level = route.view === 'profile' ? (route.settings === 'overview' ? 'settings' : 'settings-detail')
    : route.view === 'chats' ? `chats:${route.pane}` : `${route.view}:${route.card}`;
  if (route.view === 'profile' && route.settings === 'connection' && route.connection && route.connection !== 'overview') {
    level = ['connect','outgoing','incoming'].includes(route.connection) ? 'settings-subdetail' : 'settings-subsection';
  }
  if (route.view === 'profile' && route.settings === 'files' && route.media && route.media !== 'overview') level = 'settings-subsection';
  return JSON.stringify([level, route.layer ? 'overlay' : '', route.gallery ? 'gallery' : '']);
}
