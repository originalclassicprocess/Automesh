import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectionGesture } from './message-selection-gesture';

class Card extends EventTarget {
  control: { matches(selector: string): boolean } | null = null;
  closest() { return this.control; }
}
function pointer(node: Card, type: string, extra: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 100, clientY: 100, ...extra });
  node.dispatchEvent(event); return event;
}
function fixture(control: 'media' | 'button' | 'link' | null = null) {
  const node = new Card(), win = new EventTarget(); vi.stubGlobal('window', win);
  node.control = control ? { matches: selector => control === 'media' && selector === 'button.message-image' } : null;
  let allowed = true;
  const begin = vi.fn(() => { allowed = false; });
  const action = selectionGesture(node as unknown as HTMLElement, { canBegin: () => allowed, onBegin: begin });
  return { node, win, begin, action, allow: (value: boolean) => { allowed = value; } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('touch message selection boundary', () => {
  it('selects on a stationary hold, then consumes release and attachment click only once', () => {
    const f = fixture('media'), open = vi.fn();
    pointer(f.node, 'pointerdown'); vi.advanceTimersByTime(450); expect(f.begin).toHaveBeenCalledOnce();
    expect(pointer(f.node, 'pointerup').defaultPrevented).toBe(true);
    f.node.addEventListener('click', open);
    expect(pointer(f.node, 'click', { detail: 1 }).defaultPrevented).toBe(true); expect(open).not.toHaveBeenCalled();
    pointer(f.node, 'pointerdown'); pointer(f.node, 'pointerup'); pointer(f.node, 'click', { detail: 1 });
    expect(open).toHaveBeenCalledOnce(); f.action.destroy();
  });
  it('leaves a short media tap available for opening the image', () => {
    const f = fixture('media'); pointer(f.node, 'pointerdown'); vi.advanceTimersByTime(200);
    expect(pointer(f.node, 'pointerup').defaultPrevented).toBe(false); expect(pointer(f.node, 'click', { detail: 1 }).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(500); expect(f.begin).not.toHaveBeenCalled(); f.action.destroy();
  });
  it.each(['movement', 'scroll', 'cancel', 'blur', 'multitouch'])('cancels the hold on %s without blocking scrolling', reason => {
    const f = fixture(); pointer(f.node, 'pointerdown'); vi.advanceTimersByTime(150);
    if (reason === 'movement') expect(pointer(f.node, 'pointermove', { clientY: 125 }).defaultPrevented).toBe(false);
    if (reason === 'scroll') f.win.dispatchEvent(new Event('scroll'));
    if (reason === 'cancel') pointer(f.node, 'pointercancel');
    if (reason === 'blur') f.win.dispatchEvent(new Event('blur'));
    if (reason === 'multitouch') pointer(f.node, 'pointerdown', { pointerId: 2, isPrimary: false });
    vi.advanceTimersByTime(800); expect(f.begin).not.toHaveBeenCalled(); f.action.destroy();
  });
  it.each(['button', 'link'] as const)('leaves a %s and its native context menu alone', control => {
    const f = fixture(control); pointer(f.node, 'pointerdown'); vi.advanceTimersByTime(600);
    expect(pointer(f.node, 'contextmenu').defaultPrevented).toBe(false); expect(f.begin).not.toHaveBeenCalled(); f.action.destroy();
  });
  it('does not turn mouse presses into touch holds and retains desktop double-click selection', () => {
    const f = fixture(); pointer(f.node, 'pointerdown', { pointerType: 'mouse' }); vi.advanceTimersByTime(600); expect(f.begin).not.toHaveBeenCalled();
    expect(pointer(f.node, 'contextmenu').defaultPrevented).toBe(false); pointer(f.node, 'dblclick'); expect(f.begin).toHaveBeenCalledOnce(); f.action.destroy();
  });
  it('avoids a duplicate native context menu after a touch hold', () => {
    const f = fixture(); pointer(f.node, 'pointerdown'); vi.advanceTimersByTime(450);
    expect(pointer(f.node, 'contextmenu').defaultPrevented).toBe(true); expect(f.begin).toHaveBeenCalledOnce(); f.action.destroy();
  });
  it('checks current busy/selection state and cancels work after unmount', () => {
    const f = fixture(); pointer(f.node, 'pointerdown'); f.allow(false); vi.advanceTimersByTime(600); expect(f.begin).not.toHaveBeenCalled();
    f.allow(true); pointer(f.node, 'pointerdown'); f.action.destroy(); vi.advanceTimersByTime(600); expect(f.begin).not.toHaveBeenCalled();
    pointer(f.node, 'dblclick'); expect(f.begin).not.toHaveBeenCalled();
  });
  it('cancels a second finger arriving outside this message, and listens globally only during a hold', () => {
    const f=fixture(),listen=vi.spyOn(f.win,'addEventListener'),remove=vi.spyOn(f.win,'removeEventListener');
    expect(listen).not.toHaveBeenCalled();pointer(f.node,'pointerdown');expect(listen).toHaveBeenCalledTimes(3);
    const other=new Event('pointerdown');Object.assign(other,{pointerId:2,isPrimary:false});f.win.dispatchEvent(other);
    vi.advanceTimersByTime(600);expect(f.begin).not.toHaveBeenCalled();expect(remove).toHaveBeenCalledWith('scroll',expect.any(Function),true);f.action.destroy();
  });
});
