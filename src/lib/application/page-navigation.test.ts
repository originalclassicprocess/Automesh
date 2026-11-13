import { describe, expect, it, vi } from 'vitest';
import { PageNavigation, historyPageState, type HistoryPort } from './page-navigation';
function fixture() {
  const entries: unknown[] = [{ framework: 'preserved' }]; let position = 0;
  const history: HistoryPort = {
    get state() { return entries[position]; },
    pushState(state) { entries.splice(++position); entries.push(state); },
    replaceState(state) { entries[position] = state; },
    back() { if (position > 0) nav.pop(entries[--position]); },
    go(delta) { position = Math.max(0, Math.min(entries.length - 1, position + delta)); nav.pop(entries[position]); },
  };
  const restore = vi.fn(); const rootBack = vi.fn();
  const nav = new PageNavigation<string>(history, restore, rootBack, () => 'opaque-session');
  return { nav, history, entries, restore, rootBack };
}
describe('in-app browser Back', () => {
  it('waits for modal history traversal before another action and preserves the parent marker', async () => {
    const entries:unknown[]=[{}];let at=0,popped:unknown;
    const restore=vi.fn(),go=vi.fn((delta:number)=>{at+=delta;popped=entries[at];});
    const history:HistoryPort={get state(){return entries[at];},pushState(s){entries.splice(++at);entries.push(s);},
      replaceState(s){entries[at]=s;},back(){go(-1);},go};
    const nav=new PageNavigation(history,restore,()=>{},()=> 'test');
    nav.start('list');nav.visit('chat');const parent=history.state;nav.visit('viewer');
    nav.backTo(r=>r==='chat','chat');const done=vi.fn();const settled=nav.settled().then(done);
    nav.replace('chat');expect(history.state).toEqual(parent);
    nav.returnToRoot('list');expect(go).toHaveBeenCalledTimes(1);
    await Promise.resolve();expect(done).not.toHaveBeenCalled();
    nav.pop(popped);await settled;expect(done).toHaveBeenCalledOnce();expect(restore).toHaveBeenLastCalledWith('chat');
    nav.back();const closed=nav.settled();nav.clear();await closed;
  });
  it('returns straight to all chats, discards gallery snapshots and keeps root Back guarded', () => {
    const f = fixture(); f.nav.start('chats'); f.nav.visit('conversation'); f.nav.visit('gallery'); f.nav.visit('media-details');
    const discarded = f.history.state;
    f.nav.returnToRoot('chats'); expect(f.restore).toHaveBeenLastCalledWith('chats');
    f.nav.back(); expect(f.rootBack).toHaveBeenCalledOnce();
    f.nav.pop(discarded); expect(f.restore).toHaveBeenLastCalledWith('chats');
  });
  it('collapses branched history using positions, not monotonically increasing route IDs', () => {
    const f = fixture(); f.nav.start('chats'); f.nav.visit('first-chat'); f.nav.visit('gallery'); f.nav.back();
    f.nav.visit('second-gallery'); f.nav.back(); f.nav.visit('third-gallery');
    f.nav.returnToRoot('chats'); expect(f.restore).toHaveBeenLastCalledWith('chats');
    f.nav.back(); expect(f.rootBack).toHaveBeenCalledOnce();
    f.nav.rearmRoot(); f.nav.visit('new-chat'); f.nav.returnToRoot('chats');
    f.nav.back(); expect(f.rootBack).toHaveBeenCalledTimes(2);
  });
  it('returns through prior views and only then offers leaving the root', () => {
    const f = fixture(); f.nav.start('chats'); f.nav.visit('contact'); f.nav.visit('settings');
    f.nav.back(); expect(f.restore).toHaveBeenLastCalledWith('contact');
    f.nav.back(); expect(f.restore).toHaveBeenLastCalledWith('chats'); expect(f.rootBack).not.toHaveBeenCalled();
    f.nav.back(); expect(f.rootBack).toHaveBeenCalledOnce(); expect(f.nav.back()).toBe(false);
  });
  it('does not create a Back trap when the UI records the restored root', () => {
    const f = fixture(); f.nav.start('chats'); f.nav.back();
    f.nav.visit('chats'); expect(f.entries).toHaveLength(2); expect(f.nav.back()).toBe(false);
  });
  it('keeps framework state but never stores private snapshot contents', () => {
    const f = fixture(); f.nav.start('chats'); f.nav.visit('contact:private-id-and-message');
    expect(f.history.state).toMatchObject({ framework: 'preserved' });
    expect(JSON.stringify(f.entries)).not.toContain('private-id-and-message');
  });
  it('does not restore the account after clear or from unrelated history', () => {
    const f = fixture(); f.nav.start('chats'); f.nav.visit('contact');
    const old = f.history.state; f.nav.clear(); f.nav.pop(old);
    expect(f.restore).not.toHaveBeenCalled();
    f.nav.start('new'); f.nav.pop({ automeshPage: { session: 'foreign', index: 1 } });
    expect(f.restore).not.toHaveBeenCalled();
  });
  it('deduplicates repeated UI updates, not intentional return navigation', () => {
    const f = fixture(); f.nav.start('chats'); f.nav.visit('contact'); f.nav.visit('contact');
    expect(f.entries).toHaveLength(3); f.nav.visit('chats'); expect(f.entries).toHaveLength(4);
  });
  it('protects the sign-in root and navigates through recovery and password setup', () => {
    const f = fixture(); f.nav.start('entry'); f.nav.visit('import'); f.nav.visit('setPin');
    f.nav.back(); expect(f.restore).toHaveBeenLastCalledWith('import');
    f.nav.back(); expect(f.restore).toHaveBeenLastCalledWith('entry');
    f.nav.back(); expect(f.rootBack).toHaveBeenCalledOnce();
    // The second system Back is allowed; a later first Back is guarded again.
    expect(f.nav.back()).toBe(false); f.nav.rearmRoot();
    f.nav.back(); expect(f.rootBack).toHaveBeenCalledTimes(2);
  });
  it('normalizes a closed modal on pop without a Back/Forward trap', () => {
    const f = fixture(); f.nav.start('chats'); f.nav.visit('settings'); f.nav.visit('modal');
    f.nav.back(); f.nav.replace('settings');
    f.nav.back(); expect(f.restore).toHaveBeenLastCalledWith('chats');
    f.nav.visit('new-chat'); expect(f.restore).toHaveBeenLastCalledWith('chats');
    f.nav.back(); expect(f.restore).toHaveBeenLastCalledWith('chats');
  });
  it('holds the current view during an asynchronous destructive operation', () => {
    const f = fixture(); f.nav.start('chats'); f.nav.visit('delete-confirm');
    const old = f.history.state; f.nav.stay();
    expect(f.history.state).toEqual(old);
    f.nav.clear(); f.nav.rearmRoot(); f.nav.stay();
    expect(f.nav.back()).toBe(false);
  });
  it('does not enqueue multiple browser Back operations on rapid Escape presses', () => {
    const f = fixture(); f.history.back = vi.fn(); f.nav.start('chats'); f.nav.visit('settings');
    f.nav.back(); f.nav.back();
    expect(f.history.back).toHaveBeenCalledOnce();
    f.nav.pop(f.entries[1]); f.nav.back();
    expect(f.history.back).toHaveBeenCalledTimes(2);
  });
  it('uses framework-wrapped popstate payloads instead of stale reactive state', () => {
    const f = fixture(); f.nav.start('entry'); const entry = f.entries[1]; f.nav.visit('import');
    f.nav.pop(historyPageState({ frameworkIndex:42, frameworkAppState:entry }));
    expect(f.restore).toHaveBeenLastCalledWith('entry');
    expect(historyPageState(null)).toBeUndefined();
    expect(historyPageState({ frameworkIndex:42 })).toBeUndefined();
    expect(historyPageState(entry)).toEqual(entry);
  });
});
