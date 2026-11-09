export type HistoryPort = {
  readonly state: unknown;
  pushState(state: unknown, unused: string): void;
  replaceState(state: unknown, unused: string): void;
  back(): void;
  go?(delta: number): void;
};
type Marker = { session: string; index: number };
const KEY = 'automeshPage';

// Frameworks wrap application state in their own history record. Use the actual
// popstate payload, not a reactive page store that may still describe the view
// we are leaving. Do not depend on a private SvelteKit property name.
export function historyPageState(state: unknown): unknown {
  if (!state || typeof state !== 'object') return undefined;
  const record = state as Record<string, unknown>;
  if (record[KEY]) return record;
  return Object.values(record).find(value => value && typeof value === 'object' && KEY in value);
}

// History contains opaque positions only, never contacts, messages or secrets.
// Snapshots live only in this tab and are discarded when the account closes.
export class PageNavigation<T> {
  private routes = new Map<number, T>();
  private current = 1;
  private next = 2;
  private root: T | undefined;
  private active = false;
  private backPending = false;
  private session = '';
  private trail: number[] = [];
  constructor(private history: HistoryPort, private restore: (route: T) => void,
    private rootBack: () => void, private id: () => string = () => crypto.randomUUID(),
    private group?: (route: T) => string) {}
  private write(index: number, replace: boolean): void {
    const previous = this.history.state;
    const state = previous && typeof previous === 'object' ? { ...previous } : {};
    const marked = { ...state, [KEY]: { session: this.session, index } };
    this.history[replace ? 'replaceState' : 'pushState'](marked, '');
  }
  start(root: T): void {
    this.clear(); this.active = true; this.root = root; this.session = this.id();
    this.current = 1; this.next = 2;
    this.trail = [0, 1];
    this.write(0, true); // first Back at the root stays in the application
    this.routes.set(0, root); this.routes.set(1, root); this.write(1, false);
  }
  visit(route: T): void {
    if (!this.active) return;
    const previous = this.routes.get(this.current);
    if (JSON.stringify(previous) === JSON.stringify(route)) return;
    // Tabs within one hierarchy level update the current entry, not the Back stack.
    if (previous !== undefined && this.group && this.group(previous) === this.group(route)) {
      this.replace(route); return;
    }
    this.trail = this.trail.slice(0, this.trail.lastIndexOf(this.current) + 1);
    this.current = this.next++;
    this.trail.push(this.current);
    this.routes.set(this.current, route); this.write(this.current, false);
  }
  // Normalize a restored view without creating another Back entry (for example,
  // a dismissed modal or an expired account-creation screen).
  replace(route: T): void {
    if (!this.active) return;
    this.routes.set(this.current, route); this.write(this.current, true);
  }
  // Explicit "all chats" is a hierarchy jump, not a replay of visited media.
  // Invalidate discarded snapshots, including browser Forward, then collapse
  // to the guarded root. Indices are opaque IDs, NOT physical history offsets.
  returnToRoot(root: T): void {
    if (!this.active) return;
    const position = this.trail.lastIndexOf(this.current);
    this.root = root;
    for (const index of this.routes.keys()) this.routes.set(index, root);
    this.restore(root);
    if (position > 1 && this.history.go) {
      this.backPending = true;
      this.history.go(1 - position);
    } else this.replace(root);
  }
  stay(): void { this.backPending = false; if (this.active) this.write(this.current, false); }
  rearmRoot(): void {
    if (!this.active || this.current !== 0 || this.root === undefined) return;
    this.current = 1; this.routes.set(1, this.root); this.write(1, false);
    this.trail = [0, 1];
  }
  pop(state: unknown): void {
    this.backPending = false;
    if (!this.active || !state || typeof state !== 'object') return;
    const marker = (state as Record<string, unknown>)[KEY] as Marker | undefined;
    if (!marker || marker.session !== this.session || !Number.isInteger(marker.index)) return;
    this.current = marker.index;
    const route = this.routes.get(this.current) ?? this.root;
    if (route !== undefined) this.restore(route);
    if (marker.index === 0) this.rootBack();
  }
  back(): boolean {
    if (!this.active || this.current === 0) return false;
    if (this.backPending) return true;
    this.backPending = true;
    this.history.back(); return true;
  }
  // A hierarchy button chooses a parent, not the last visited sibling tab.
  // Reuse a real ancestor entry when present; otherwise replace this entry.
  // Discarded Forward snapshots must not reopen the closed settings branch.
  backTo(match: (route:T) => boolean, fallback:T): void {
    if (!this.active || this.backPending) return;
    const position = this.trail.lastIndexOf(this.current);
    let ancestor = -1;
    for (let i=position-1;i>=1;i--) {
      const route=this.routes.get(this.trail[i]);
      if (route !== undefined && match(route)) { ancestor=i;break; }
    }
    const target=ancestor < 0 ? fallback : this.routes.get(this.trail[ancestor])!;
    for (const index of this.trail.slice(ancestor < 0 ? position : ancestor+1)) this.routes.set(index,target);
    this.restore(target);
    if (ancestor >= 0 && this.history.go) { this.backPending=true;this.history.go(ancestor-position); }
    else this.replace(target);
  }
  // Old browser entries cannot restore an unlocked view after lock/logout.
  clear(): void { this.routes.clear(); this.trail = []; this.root = undefined; this.active = false; this.backPending = false; }
}
