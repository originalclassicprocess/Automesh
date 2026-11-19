import { tick } from 'svelte';

type Message = { id: string; direction: 'incoming' | 'outgoing'; localCall?: unknown };
type Position = { peer: string; messages: readonly Message[]; openToken: number };
type Anchor = { id: string; offset: number };
type View = { anchors: Anchor[]; top: number; bottom: boolean; lastId: string; total: number; pending: string[] };

// Viewport only: no message bodies, persistence, transport or receipt access.
// Callers clear these bounded, in-memory positions on lock/profile change.
export function createChatScroll(options: {
  activePeer(): string; firstUnread(peer: string): string | undefined;
  onJump(visible: boolean, incoming: number): void;
}) {
  const positions = new Map<string, View>();
  let epoch = 0, owner = 0;
  let captureCurrent: (()=>()=>void)|undefined;
  const action = (node: HTMLElement, initial: Position) => {
    const generation = epoch, instance = ++owner;
    let current = initial, alive = true, opening = true, scheduled = false, dirty = false;
    let view = positions.get(initial.peer), following = view?.bottom ?? true;
    let nodes: HTMLElement[] = [], indices = new Map<string, number>();
    const observed = new Set<Element>(), pending = new Set(view?.pending ?? []);
    const valid = () => alive && epoch === generation && owner === instance && options.activePeer() === current.peer;
    const viewportTop = () => node.getBoundingClientRect().top + node.clientTop;
    // Measure O(log n) wrappers per scroll, not the whole large conversation.
    const firstAfter = (edge: number) => {
      let low = 0, high = nodes.length;
      while (low < high) { const mid = (low + high) >>> 1;
        if (nodes[mid].getBoundingClientRect().bottom <= edge) low = mid + 1; else high = mid; }
      return low;
    };
    const readAnchors = () => {
      const top = viewportTop(), start = firstAfter(top);
      return nodes.slice(start, start + 3).map(child => ({ id: child.dataset.chatMessageId!, offset: child.getBoundingClientRect().top - top }));
    };
    const syncNodes = () => {
      const children = new Set([...node.children]);
      for (const child of observed) if (!children.has(child)) { resize.unobserve(child); observed.delete(child); }
      for (const child of children) if (!observed.has(child)) { resize.observe(child); observed.add(child); }
      nodes = [...node.querySelectorAll<HTMLElement>('[data-chat-message-id]')];
      indices = new Map(nodes.map((child, index) => [child.dataset.chatMessageId!, index]));
      for (const id of pending) if (!indices.has(id)) pending.delete(id);
    };
    const remember = () => {
      if (!valid() || !node.clientHeight || opening) return;
      const passed = firstAfter(viewportTop() + node.clientHeight + 1);
      for (const id of pending) if (following || (indices.get(id) ?? Infinity) < passed) pending.delete(id);
      view = { anchors: readAnchors(), top: node.scrollTop, bottom: following,
        lastId: current.messages.at(-1)?.id ?? '', total: current.messages.length, pending: [...pending] };
      positions.delete(current.peer); positions.set(current.peer, view);
      if (positions.size > 32) positions.delete(positions.keys().next().value!);
      options.onJump(!following && node.scrollHeight - node.clientHeight > 24, pending.size);
    };
    const collect = (previousId: string, previousTotal: number) => {
      const messages = current.messages, present = new Set(messages.map(m => m.id));
      for (const id of pending) if (!present.has(id)) pending.delete(id);
      const start = previousId ? messages.findIndex(m => m.id === previousId) : previousTotal === 0 ? -1 : -2;
      // A removed tail/backfilled history is not evidence of a new message.
      if (start === -2 || previousId && start < 0) return;
      for (let i = start + 1; i < messages.length; i++)
        if (messages[i].direction === 'incoming' && !messages[i].localCall) pending.add(messages[i].id);
    };
    const restore = (saved: View) => {
      const anchor = saved.anchors.find(a => indices.has(a.id));
      if (anchor) node.scrollTop += nodes[indices.get(anchor.id)!].getBoundingClientRect().top - viewportTop() - anchor.offset;
      else node.scrollTop = saved.top;
    };
    const layout = () => {
      if (!valid() || !node.clientHeight) return;
      if (opening) {
        if (view && !view.bottom) restore(view);
        else {
          const unread = options.firstUnread(current.peer), index = unread ? indices.get(unread) : undefined;
          if (index !== undefined) node.scrollTop += nodes[index].getBoundingClientRect().top - viewportTop() - 10;
          else node.scrollTop = node.scrollHeight;
        }
        opening = false;
      } else if (following) node.scrollTop = node.scrollHeight;
      else if (view) restore(view);
      following = node.scrollHeight - node.scrollTop - node.clientHeight <= 24;
      remember();
    };
    const schedule = () => {
      if (scheduled) return; scheduled = true;
      void tick().then(() => { scheduled = false; if (valid()) { if (dirty) { syncNodes(); dirty = false; } layout(); } });
    };
    const onScroll = () => {
      if (!valid() || opening || !node.clientHeight) return;
      following = node.scrollHeight - node.scrollTop - node.clientHeight <= 24;
      remember();
    };
    captureCurrent=()=>{
      remember();const saved=view;
      return()=>{if(saved&&valid()){view=saved;following=saved.bottom;opening=false;layout();}};
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    const resize = new ResizeObserver(layout);
    resize.observe(node); syncNodes();
    const mutation = new MutationObserver(() => { if (!valid()) return; syncNodes(); dirty = false; layout(); });
    mutation.observe(node, { childList: true });
    if (view) collect(view.lastId, view.total);
    schedule();
    return {
      update(next: Position) {
        if (!alive || epoch !== generation || owner !== instance) return;
        if (next.peer !== current.peer) {
          current = next; view = positions.get(next.peer); following = view?.bottom ?? true;
          pending.clear(); for (const id of view?.pending ?? []) pending.add(id);
          if (view) collect(view.lastId, view.total);
          opening = true; dirty = true; options.onJump(false, 0); schedule(); return;
        }
        const old = current; current = next;
        if (next.messages.length !== old.messages.length || next.messages.at(-1)?.id !== old.messages.at(-1)?.id) {
          collect(old.messages.at(-1)?.id ?? '', old.messages.length); dirty = true;
        }
        if (next.openToken !== old.openToken) { view = positions.get(next.peer); opening = true; }
        schedule();
      },
      destroy() {
        alive = false; resize.disconnect(); mutation.disconnect(); node.removeEventListener('scroll', onScroll);
        nodes = []; indices.clear(); observed.clear(); pending.clear();
        if (owner === instance && epoch === generation) {captureCurrent=undefined;options.onJump(false, 0);}
      }
    };
  };
  return Object.assign(action, { checkpoint(){return captureCurrent?.()??(()=>{});},clear() { epoch++; positions.clear();captureCurrent=undefined; options.onJump(false, 0); } });
}
