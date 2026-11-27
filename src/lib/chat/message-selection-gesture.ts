type Options = { canBegin(): boolean; onBegin(): void; conversation?: boolean };

// A touch hold selects a message; normal taps, links, controls and scrolling
// retain their behavior. The release click must not open the held attachment
// or immediately toggle the just-selected message back off.
export function selectionGesture(node: HTMLElement, initial: Options) {
  let options = initial, timer: ReturnType<typeof setTimeout> | undefined;
  let pointer: number | undefined, x = 0, y = 0, held = false, suppressClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  const finishClickGuard = () => {
    suppressClick = false;
    clearTimeout(clickTimer);
    window.removeEventListener('click', click, true);
    window.removeEventListener('pointerdown', finishClickGuard, true);
  };
  const targetAllowed = (event: Event, media = false) => {
    const target = event.target as Element | null;
    const control = target?.closest?.('button,a,input,textarea,select,video,audio,[contenteditable="true"]');
    return !control || options.conversation && control === node || media && control.matches('button.message-image');
  };
  const cancel = () => {
    clearTimeout(timer); timer = undefined; pointer = undefined; held = false;
    window.removeEventListener('scroll', cancel, true); window.removeEventListener('blur', cancel);
    window.removeEventListener('pointerdown', otherPointer, true);
  };
  const otherPointer = (event: PointerEvent) => { if (event.pointerId !== pointer) cancel(); };
  const begin = () => {
    clearTimeout(timer); timer = undefined;
    if (pointer === undefined || !options.canBegin()) return;
    held = true; suppressClick = true;
    if (!options.conversation) options.onBegin();
  };
  const down = (event: PointerEvent) => {
    cancel(); finishClickGuard();
    if ((!options.conversation && event.pointerType !== 'touch') || !event.isPrimary || event.button !== 0 || !options.canBegin() || !targetAllowed(event, true)) return;
    pointer = event.pointerId; x = event.clientX; y = event.clientY;
    window.addEventListener('scroll', cancel, true); window.addEventListener('blur', cancel);
    window.addEventListener('pointerdown', otherPointer, true);
    timer = setTimeout(begin, 450);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId === pointer && Math.hypot(event.clientX - x, event.clientY - y) > 10) cancel();
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    const showMenu = held && options.conversation && options.canBegin();
    if (held) {
      event.preventDefault(); event.stopPropagation();
      clickTimer = setTimeout(finishClickGuard, 750);
      if (showMenu) {
        // Browsers may retarget the release click into a newly opened dialog.
        window.addEventListener('click', click, true);
        window.addEventListener('pointerdown', finishClickGuard, true);
      }
    }
    cancel();
    // Opening under a finger before pointerup can turn release into a click
    // on an action in the dialog. Keep the row under the gesture until release.
    if (showMenu) options.onBegin();
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault(); event.stopImmediatePropagation(); finishClickGuard();
  };
  const context = (event: Event) => {
    if (options.conversation && options.canBegin() && targetAllowed(event)) {
      event.preventDefault();
      if (!held) {
        if (pointer !== undefined) begin();
        else options.onBegin();
      }
      return;
    }
    if (pointer === undefined || !targetAllowed(event, true)) return;
    if (!held) begin();
    if (held) event.preventDefault();
  };
  const double = (event: Event) => {
    if (!options.conversation && options.canBegin() && targetAllowed(event)) { event.preventDefault(); options.onBegin(); }
  };
  const contextKey = (event: KeyboardEvent) => {
    if (options.conversation && options.canBegin() && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      options.onBegin();
    }
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up, true);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', context);
  node.addEventListener('dblclick', double);
  node.addEventListener('keydown', contextKey);
  return {
    update(next: Options) { options = next; if (!options.canBegin()) { clearTimeout(timer); timer = undefined; } },
    destroy() {
      cancel(); finishClickGuard();
      node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up, true); node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('click', click, true); node.removeEventListener('contextmenu', context); node.removeEventListener('dblclick', double);
      node.removeEventListener('keydown', contextKey);
      window.removeEventListener('scroll', cancel, true); window.removeEventListener('blur', cancel);
    }
  };
}
