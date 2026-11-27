import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { createChatScroll } from './chat-scroll';

class Observer {
  static all: Observer[] = [];
  targets = new Set<unknown>();
  constructor(readonly callback: () => void) { Observer.all.push(this); }
  observe(target: unknown) { this.targets.add(target); }
  unobserve(target: unknown) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  fire() { if (this.targets.size) this.callback(); }
}
class Root extends EventTarget {
  clientHeight = 300; clientTop = 1; reads = 0; queries = 0; private top = 0;
  children: Array<{ dataset: { chatMessageId: string }; height: number; getBoundingClientRect(): { top: number; bottom: number } }> = [];
  get scrollHeight() { return this.children.reduce((sum, c) => sum + c.height, 0); }
  get scrollTop() { return this.top; }
  set scrollTop(top: number) { this.top = Math.max(0, Math.min(top, Math.max(0, this.scrollHeight - this.clientHeight))); }
  getBoundingClientRect() { return { top: 20, bottom: 20 + this.clientHeight + 2 }; }
  querySelectorAll() { this.queries++; return this.children; }
  child(id: string, height = 100) {
    const child = { dataset: { chatMessageId: id }, height, getBoundingClientRect: () => {
      this.reads++; const top = 21 - this.scrollTop + this.children.slice(0, this.children.indexOf(child)).reduce((sum, c) => sum + c.height, 0);
      return { top, bottom: top + child.height };
    } }; return child;
  }
  userScroll(top: number) { this.scrollTop = top; this.dispatchEvent(new Event('scroll')); }
}
const messages = (n = 12) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, direction: 'incoming' as 'incoming' | 'outgoing' }));
const settle = async () => { await tick(); await Promise.resolve(); };
function fixture(n = 12, unread?: string) {
  vi.stubGlobal('ResizeObserver', Observer); vi.stubGlobal('MutationObserver', Observer);
  let peer = 'a'; const jump = vi.fn();
  const manage = createChatScroll({ activePeer: () => peer, firstUnread: () => unread, onJump: jump });
  const mount = (items = messages(n), name = 'a') => {
    peer = name; const root = new Root(); root.children = items.map(m => root.child(m.id));
    const state = { peer: name, messages: items, openToken: 1 };
    const start = Observer.all.length;
    const action = manage(root as unknown as HTMLElement, state);
    return { root, state, action, resize: Observer.all[start], mutation: Observer.all[start + 1],
      async update(next: typeof items) { root.children = next.map(m => root.children.find(c => c.dataset.chatMessageId === m.id) ?? root.child(m.id)); action.update({ ...state, messages: next }); state.messages = next; await settle(); } };
  };
  return { manage, mount, jump, setPeer: (value: string) => { peer = value; } };
}
afterEach(() => { Observer.all = []; vi.unstubAllGlobals(); });

describe('stable conversation viewport', () => {
  it('opens at unread on first entry, otherwise follows the end', async () => {
    const f = fixture(12, 'm4'), a = f.mount(); await settle(); expect(a.root.scrollTop).toBe(390);
    expect(f.jump).toHaveBeenLastCalledWith(true, 0);
    const g = fixture(), b = g.mount(); await settle(); expect(b.root.scrollTop).toBe(900);
  });
  it('holds the visible message offset when images above grow or shrink', async () => {
    const f = fixture(), a = f.mount(); await settle(); a.root.userScroll(350);
    a.root.children[0].height += 240; a.resize.fire(); expect(a.root.scrollTop).toBe(590);
    a.root.children[0].height -= 170; a.resize.fire(); expect(a.root.scrollTop).toBe(420);
    a.root.clientHeight = 230; a.resize.fire(); expect(a.root.scrollTop).toBe(420);
  });
  it('counts only new incoming messages while reading, without moving the viewport', async () => {
    const f = fixture(), a = f.mount(); await settle(); a.root.userScroll(350);
    const next = [...a.state.messages, { id: 'out', direction: 'outgoing' as const }, { id: 'in1', direction: 'incoming' as const }, { id: 'in2', direction: 'incoming' as const }];
    const before = JSON.stringify(next); await a.update(next);
    expect(a.root.scrollTop).toBe(350); expect(f.jump).toHaveBeenLastCalledWith(true, 2); expect(JSON.stringify(next)).toBe(before);
    await a.update([...next]); expect(f.jump).toHaveBeenLastCalledWith(true, 2);
    a.root.userScroll(a.root.scrollHeight); expect(f.jump).toHaveBeenLastCalledWith(false, 0);
    a.root.children[0].height += 50; a.resize.fire(); expect(a.root.scrollTop).toBe(1250);
  });
  it('follows incoming messages only while already at the end, including short chats', async () => {
    const f = fixture(4), a = f.mount(); await settle(); a.root.userScroll(0); expect(f.jump).toHaveBeenLastCalledWith(true, 0);
    await a.update([...a.state.messages, { id: 'new', direction: 'incoming' }]); expect(a.root.scrollTop).toBe(0); expect(f.jump).toHaveBeenLastCalledWith(true, 1);
    a.root.userScroll(a.root.scrollHeight); await a.update([...a.state.messages, { id: 'new2', direction: 'incoming' }]);
    expect(a.root.scrollTop).toBe(300); expect(f.jump).toHaveBeenLastCalledWith(false, 0);
  });
  it('restores per-chat anchors after unmount and counts arrivals while away', async () => {
    const f = fixture(), a = f.mount(); await settle(); a.root.userScroll(350); a.action.destroy();
    const b = f.mount(messages(15), 'b'); await settle(); b.root.userScroll(800); b.action.destroy();
    const back = f.mount([...messages(), { id: 'new', direction: 'incoming' }]); back.root.children[0].height += 150; await settle();
    expect(back.root.scrollTop).toBe(500); expect(f.jump).toHaveBeenLastCalledWith(true, 1);
    back.action.destroy(); const again = f.mount(messages(15), 'b'); await settle(); expect(again.root.scrollTop).toBe(800);
  });
  it('does not treat older backfill, outgoing messages or deleted pending messages as new', async () => {
    const f = fixture(), a = f.mount(); await settle(); a.root.userScroll(350);
    await a.update([{ id: 'old', direction: 'incoming' }, ...a.state.messages]); expect(a.root.scrollTop).toBe(450); expect(f.jump).toHaveBeenLastCalledWith(true, 0);
    await a.update([...a.state.messages, { id: 'new', direction: 'incoming' }]); expect(f.jump).toHaveBeenLastCalledWith(true, 1);
    await a.update(a.state.messages.filter(m => m.id !== 'new')); expect(f.jump).toHaveBeenLastCalledWith(true, 0);
  });
  it('keeps an adjacent anchor if the first visible message is removed', async () => {
    const f = fixture(), a = f.mount(); await settle(); a.root.userScroll(350);
    await a.update(a.state.messages.filter(m => m.id !== 'm3')); expect(a.root.scrollTop).toBe(250);
  });
  it('honors a user scroll that interrupts a queued follow-to-bottom', async () => {
    const f = fixture(), a = f.mount(); await settle();
    const next = [...a.state.messages, { id: 'new', direction: 'incoming' as const }];
    a.root.children.push(a.root.child('new')); a.action.update({ ...a.state, messages: next });
    a.root.userScroll(350); await settle(); expect(a.root.scrollTop).toBe(350); expect(f.jump).toHaveBeenLastCalledWith(true, 1);
  });
  it('preserves movement before the scroll event while an earlier image grows', async () => {
    const f = fixture(), a = f.mount(); await settle(); a.root.userScroll(350);
    a.root.scrollTop = 415;
    a.root.children[0].height += 100;
    a.resize.fire();
    expect(a.root.scrollTop).toBe(515);
    a.root.scrollTop = 440;
    a.resize.fire();
    expect(a.root.scrollTop).toBe(440);
  });
  it('stops following as soon as the user scrolls away from the bottom', async () => {
    const f = fixture(), a = f.mount(); await settle();
    a.root.scrollTop = 890;
    a.resize.fire();
    expect(a.root.scrollTop).toBe(890);
    a.root.dispatchEvent(new Event('scroll'));
    await a.update([...a.state.messages, { id:'later', direction:'incoming' }]);
    expect(a.root.scrollTop).toBe(890);
  });
  it('waits while hidden and restores when the phone chat pane becomes visible', async () => {
    const f = fixture(), a = f.mount(); a.root.clientHeight = 0; await settle(); expect(a.root.scrollTop).toBe(0);
    a.root.clientHeight = 300; a.resize.fire(); expect(a.root.scrollTop).toBe(900);
    a.root.userScroll(350); a.root.clientHeight = 0; a.resize.fire();
    a.root.clientHeight = 300; a.action.update({ ...a.state, openToken: 2 }); await settle(); expect(a.root.scrollTop).toBe(350);
  });
  it('forgets metadata on lock/profile switch and cancels stale queued work', async () => {
    const f = fixture(), a = f.mount(); await settle(); a.root.userScroll(350); f.manage.clear();
    a.resize.fire(); a.root.userScroll(100); a.action.destroy();
    const b = f.mount(); f.manage.clear(); const calls = f.jump.mock.calls.length; await settle(); expect(f.jump).toHaveBeenCalledTimes(calls); b.action.destroy();
    const c = f.mount(); await settle(); expect(c.root.scrollTop).toBe(900);
  });
  it('unobserves removed rows and releases observers on destruction', async () => {
    const f = fixture(), a = f.mount(); await settle(); const removed = a.root.children[0];
    a.root.children.shift(); a.mutation.fire(); expect(a.resize.targets.has(removed)).toBe(false);
    a.action.destroy(); expect(a.resize.targets.size).toBe(0); expect(a.mutation.targets.size).toBe(0);
  });
  it('measures logarithmically on scroll in a 10,000-message history', async () => {
    const f = fixture(10000), a = f.mount(); await settle(); a.root.reads = 0; a.root.queries = 0;
    a.root.userScroll(500000); expect(a.root.reads).toBeLessThan(40); expect(a.root.queries).toBe(0);
  });
  it('supports a linked-device view reusing the same DOM for another peer',async()=>{
    const f=fixture(),a=f.mount();await settle();a.root.userScroll(350);
    const other=messages().map(m=>({...m,id:'b'+m.id}));f.setPeer('b');a.root.children=other.map(m=>a.root.child(m.id));
    a.action.update({peer:'b',messages:other,openToken:2});await settle();expect(a.root.scrollTop).toBe(900);
    f.setPeer('a');a.root.children=messages().map(m=>a.root.child(m.id));a.action.update({...a.state,openToken:3});await settle();expect(a.root.scrollTop).toBe(350);
  });
  it('returns from a search jump to its anchored place even after an image resized',async()=>{
    const f=fixture(),a=f.mount();await settle();a.root.userScroll(350);const restore=f.manage.checkpoint();
    a.root.userScroll(800);a.root.children[0].height+=150;a.resize.fire();restore();expect(a.root.scrollTop).toBe(500);
    f.manage.clear();a.root.userScroll(0);restore();expect(a.root.scrollTop).toBe(0);
  });
});
