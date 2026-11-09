import { afterEach, describe, expect, it, vi } from 'vitest';
import { composerHeight } from './composer-size';
import { otherUnreadCount } from './chat-header';
import { droppedFiles, installFileDrop, isFileDrag } from './file-drop';

afterEach(() => vi.unstubAllGlobals());
describe('compact chat controls', () => {
  it('counts unread messages from other conversations only', () => {
    expect(otherUnreadCount({ current: { unread: 10 }, a: { unread: 3 }, b: { unread: 2 }, invalid: { unread: -1 } }, 'current')).toBe(5);
    expect(otherUnreadCount({}, '')).toBe(0);
  });
  it('grows from one line but leaves space in a short viewport', () => {
    expect(composerHeight(10, 24, 18, 700)).toBe(42);
    expect(composerHeight(100, 24, 18, 700)).toBe(100);
    expect(composerHeight(600, 24, 18, 700)).toBe(120);
    expect(composerHeight(600, 24, 18, 300)).toBe(60);
    expect(composerHeight(600, 24, 18, 100)).toBe(42);
  });
  it('extracts multiple files but never treats links or text as uploads', () => {
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
    expect(droppedFiles({ types: ['Files'], files: files as unknown as FileList })).toEqual(files);
    expect(isFileDrag({ types: ['text/uri-list'] })).toBe(false);
    expect(droppedFiles({ types: ['text/plain'], files: files as unknown as FileList })).toEqual([]);
    expect(droppedFiles(null)).toEqual([]);
  });
});

function setup(allowed = true) {
  const node = new EventTarget(); const win = new EventTarget(); vi.stubGlobal('window', win);
  let target = 'first';
  const onFiles = vi.fn(), onActive = vi.fn();
  const action = installFileDrop(node as unknown as HTMLElement, { canDrop: () => allowed, target: () => target, onFiles, onActive });
  const data = { types: ['Files'], files: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')], dropEffect: '' };
  const dispatch = (name: string, transfer = data) => {
    const event = new Event(name, { cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: transfer });
    node.dispatchEvent(event); return event;
  };
  return { node, win, action, dispatch, data, onFiles, onActive, changeTarget() { target = 'second'; } };
}
describe('file drop event boundary', () => {
  it('enqueues once on release, not during hover, and cleans up listeners', () => {
    const fixture = setup();
    fixture.dispatch('dragenter'); fixture.dispatch('dragover');
    expect(fixture.data.dropEffect).toBe('copy'); expect(fixture.onFiles).not.toHaveBeenCalled();
    expect(fixture.dispatch('drop').defaultPrevented).toBe(true);
    expect(fixture.onFiles).toHaveBeenCalledExactlyOnceWith(fixture.data.files);
    fixture.action.destroy(); fixture.dispatch('dragenter'); fixture.dispatch('drop');
    expect(fixture.onFiles).toHaveBeenCalledTimes(1);
  });
  it('blocks navigation on a disabled file drop without adding a message', () => {
    const fixture = setup(false); fixture.dispatch('dragenter'); fixture.dispatch('dragover');
    expect(fixture.data.dropEffect).toBe('none'); expect(fixture.dispatch('drop').defaultPrevented).toBe(true);
    expect(fixture.onFiles).not.toHaveBeenCalled(); fixture.action.destroy();
  });
  it('does not send to a different conversation if the target changes during dragging', () => {
    const fixture = setup(); fixture.dispatch('dragenter'); fixture.changeTarget(); fixture.dispatch('drop');
    expect(fixture.onFiles).not.toHaveBeenCalled(); fixture.action.destroy();
  });
  it('does not flicker on child boundaries and clears a cancelled drag', () => {
    const fixture = setup(); fixture.dispatch('dragenter'); fixture.dispatch('dragenter'); fixture.dispatch('dragleave');
    expect(fixture.onActive).toHaveBeenLastCalledWith(true);
    fixture.win.dispatchEvent(new Event('blur')); expect(fixture.onActive).toHaveBeenLastCalledWith(false);
    fixture.dispatch('drop'); expect(fixture.onFiles).not.toHaveBeenCalled(); fixture.action.destroy();
  });
});
