type Options = { canBegin(): boolean; onBegin(): void };

// A touch hold selects a message; normal taps, links, controls and scrolling
// retain their behavior. The release click must not open the held attachment
// or immediately toggle the just-selected message back off.
export function selectionGesture(node: HTMLElement, initial: Options) {
  let options = initial, timer: ReturnType<typeof setTimeout> | undefined;
  let pointer: number | undefined, x = 0, y = 0, held = false, suppressClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  const targetAllowed = (event: Event, media = false) => {
    const target = event.target as Element | null;
    const control = target?.closest?.('button,a,input,textarea,select,video,audio,[contenteditable="true"]');
    return !control || media && control.matches('button.message-image');
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
    held = true; suppressClick = true; options.onBegin();
  };
  const down = (event: PointerEvent) => {
    cancel(); clearTimeout(clickTimer); suppressClick = false;
    if (event.pointerType !== 'touch' || !event.isPrimary || event.button !== 0 || !options.canBegin() || !targetAllowed(event, true)) return;
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
    if (held) { event.preventDefault(); event.stopPropagation(); clickTimer = setTimeout(() => { suppressClick = false; }, 750); }
    cancel();
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; clearTimeout(clickTimer);
  };
  const context = (event: Event) => {
    if (pointer === undefined || !targetAllowed(event, true)) return;
    if (!held) begin();
    if (held) event.preventDefault();
  };
  const double = (event: Event) => {
    if (options.canBegin() && targetAllowed(event)) { event.preventDefault(); options.onBegin(); }
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up, true);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', context);
  node.addEventListener('dblclick', double);
  return {
    update(next: Options) { options = next; if (!options.canBegin()) { clearTimeout(timer); timer = undefined; } },
    destroy() {
      cancel(); clearTimeout(clickTimer);
      node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up, true); node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('click', click, true); node.removeEventListener('contextmenu', context); node.removeEventListener('dblclick', double);
      window.removeEventListener('scroll', cancel, true); window.removeEventListener('blur', cancel);
    }
  };
}
