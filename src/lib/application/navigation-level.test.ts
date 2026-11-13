import { describe, expect, it } from 'vitest';
import { PageNavigation, type HistoryPort } from './page-navigation';
import { navigationLevel, type NavigationView } from './navigation-level';
const root: NavigationView = { screen:'account', layer:'', view:'chats', pane:'chat', peer:'contact', card:'', settings:'overview', gallery:'' };
describe('hierarchical navigation', () => {
  it('closes one viewer level after many photos, then returns to all chats, including repeated opens', () => {
    const entries: unknown[] = [{}]; let at = 0; const restored: NavigationView[] = [];
    const history: HistoryPort = { get state() { return entries[at]; },
      pushState(s) { entries.splice(++at); entries.push(s); }, replaceState(s) { entries[at] = s; },
      back() { if (at > 0) nav.pop(entries[--at]); },
      go(delta) { at += delta; nav.pop(entries[at]); } };
    const nav = new PageNavigation(history, (r: NavigationView) => restored.push(r), () => {}, () => 'test', navigationLevel);
    const list = {...root,pane:'list',peer:''}; nav.start(list); nav.visit(root);
    for (let cycle=0;cycle<4;cycle++) {
      for (let photo=0;photo<25;photo++) nav.visit({...root,gallery:`private-photo-${cycle}-${photo}`});
      expect(entries).toHaveLength(4);
      // The native modal consumes Back/cancel without emitting popstate.
      nav.backTo(route=>!route.gallery,root);
      expect(restored.at(-1)).toEqual(root);
    }
    nav.back(); expect(restored.at(-1)).toEqual(list);
    expect(JSON.stringify(entries)).not.toContain('private-photo');
    // A real browser history traversal also closes media in a single step.
    nav.visit(root); nav.visit({...root,gallery:'last-photo'}); nav.back();
    expect(restored.at(-1)).toEqual(root); nav.back(); expect(restored.at(-1)).toEqual(list);
  });
  it('skips settings tabs: detail → settings menu → the same chat', () => {
    const entries: unknown[] = [{}]; let at = 0; const restored: NavigationView[] = [];
    const history: HistoryPort = { get state() { return entries[at]; },
      pushState(s) { entries.splice(++at); entries.push(s); }, replaceState(s) { entries[at] = s; },
      back() { if (at > 0) nav.pop(entries[--at]); } };
    const nav = new PageNavigation(history, (r: NavigationView) => restored.push(r), () => {}, () => 'test', navigationLevel);
    nav.start(root); const settings = { ...root, view:'profile' }; nav.visit(settings);
    for (const section of ['account', 'security', 'connection', 'files', 'application']) nav.visit({ ...settings, settings:section });
    expect(entries).toHaveLength(4);
    nav.back(); expect(restored.at(-1)).toEqual(settings);
    nav.back(); expect(restored.at(-1)).toEqual(root);
    expect(JSON.stringify(entries)).not.toContain('contact');
  });
  it('keeps overlay and mobile-list levels separate, but replaces contact/subtab changes', () => {
    expect(navigationLevel(root)).not.toBe(navigationLevel({ ...root, pane:'list' }));
    expect(navigationLevel(root)).toBe(navigationLevel({ ...root, peer:'other' }));
    const detail = { ...root, view:'profile', settings:'connection' };
    expect(navigationLevel(detail)).toBe(navigationLevel({ ...detail, settings:'security' }));
    expect(navigationLevel(detail)).not.toBe(navigationLevel({ ...detail, layer:'help' }));
  });
  it('returns from connecting a node through its list and connection menu to the chat', () => {
    const entries: unknown[] = [{}]; let at = 0; const restored: NavigationView[] = [];
    const history: HistoryPort = { get state() { return entries[at]; },
      pushState(s) { entries.splice(++at); entries.push(s); }, replaceState(s) { entries[at] = s; },
      back() { if (at > 0) nav.pop(entries[--at]); } };
    const nav = new PageNavigation(history, (r: NavigationView) => restored.push(r), () => {}, () => 'test', navigationLevel);
    const menu = { ...root, view:'profile' };
    const connection = { ...menu, settings:'connection', connection:'overview' };
    const nodes = { ...connection, connection:'nodes' };
    nav.start(root); nav.visit(menu); nav.visit(connection); nav.visit(nodes);
    nav.visit({ ...nodes, connection:'connect' });
    for (const expected of [nodes, connection, menu, root]) { nav.back(); expect(restored.at(-1)).toEqual(expected); }
    expect(JSON.stringify(entries)).not.toContain('contact');
  });
});
