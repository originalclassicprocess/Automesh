// Keep browser keyboard control in the user's synchronous tap handler (iOS).
// The custom picker is never allowed to refocus the editable on a touch screen.
export function keyboardGap(fullHeight: number, height: number, offset: number, scale: number): number {
  return Math.abs(scale - 1) < .01 ? Math.max(0, fullHeight - height - offset) : 0;
}

export class ComposerInput {
  private node?: HTMLElement;
  private field?: HTMLTextAreaElement;
  private originalInputMode: string | null = null;
  private fullHeight = 0;
  private width = 0;
  private panelHeight = 280;
  private switching = false;
  private waitingForKeyboard = false;
  private wasMobile?: boolean;
  constructor(private isOpen: () => boolean, private setOpen: (open: boolean) => void, private onMobile?: (mobile: boolean) => void) {}
  get mobile(): boolean { return typeof window !== 'undefined' && window.matchMedia('(max-width:700px), (pointer:coarse)').matches; }
  private gap(): number {
    const v = window.visualViewport;
    return v ? keyboardGap(this.fullHeight, v.height, v.offsetTop, v.scale) : 0;
  }
  private restoreMode() {
    if (this.originalInputMode === null) this.field?.removeAttribute('inputmode');
    else this.field?.setAttribute('inputmode', this.originalInputMode);
  }
  private resize = () => {
    if (!this.node) return;
    const v = window.visualViewport;
    if (Math.abs(window.innerWidth - this.width) > 100) this.fullHeight = Math.max(window.innerHeight, v?.height ?? 0);
    this.width = window.innerWidth;
    if (!v || Math.abs(v.scale - 1) < .01) this.fullHeight = Math.max(this.fullHeight, window.innerHeight, v?.height ?? 0);
    const gap = this.gap();
    if (gap <= 100) this.waitingForKeyboard = false;
    if (gap > 100 && document.activeElement === this.field) this.panelHeight = Math.min(420, Math.max(180, gap));
    this.node.style.setProperty('--composer-panel-height', `${this.panelHeight}px`);
    const mobile = this.mobile;
    this.node.toggleAttribute('data-mobile-input', mobile);
    this.node.toggleAttribute('data-keyboard-hiding', mobile && this.isOpen() && this.waitingForKeyboard);
    if (this.wasMobile !== mobile) {
      this.wasMobile = mobile; this.onMobile?.(mobile);
      if (mobile && this.isOpen()) {
        this.field?.setAttribute('inputmode', 'none');
        if (document.activeElement === this.field) this.field?.blur();
      } else this.restoreMode();
    }
  };
  private apply(open: boolean) {
    if (!this.node || !this.field) return;
    this.node.toggleAttribute('data-panel-open', open);
    if (this.mobile && open) {
      if (document.activeElement === this.field && this.gap() > 100) this.waitingForKeyboard = true;
      this.field.setAttribute('inputmode', 'none');
      if (document.activeElement === this.field) this.field.blur();
    } else { this.waitingForKeyboard = false; this.restoreMode(); }
    this.resize();
  }
  toggle = () => {
    if (this.isOpen()) { if (this.mobile) this.keyboard(); else this.setOpen(false); return; }
    this.resize(); // Capture the real keyboard height before blurring it.
    this.setOpen(true); this.apply(true);
  };
  keyboard = () => {
    if (!this.field || this.field.disabled) return;
    const start = this.field.selectionStart, end = this.field.selectionEnd;
    this.switching = true;
    this.setOpen(false); this.apply(false);
    // A field previously focused with inputmode=none may need a fresh focus.
    if (this.mobile && document.activeElement === this.field) this.field.blur();
    this.field.focus({ preventScroll: true }); this.field.setSelectionRange(start, end);
    this.switching = false;
  };
  restoreCaret(start: number, end: number) {
    if (!this.field) return;
    if (!this.mobile || !this.isOpen()) this.field.focus({ preventScroll: true });
    this.field.setSelectionRange(start, end);
  }
  mount = (node: HTMLElement, open: boolean) => {
    this.node = node; this.field = node.querySelector('textarea') ?? undefined;
    this.originalInputMode = this.field?.getAttribute('inputmode') ?? null;
    this.fullHeight = Math.max(window.innerHeight, window.visualViewport?.height ?? 0);
    const focus = (event: FocusEvent) => { if (event.target === this.field && this.mobile && this.isOpen() && !this.switching) this.keyboard(); };
    // Sending or switching input should not accidentally dismiss an already
    // open keyboard before its height/selection can be captured.
    const pointer = (event: PointerEvent) => {
      if (event.button === 0 && (event.target as Element)?.closest?.('[data-composer-toggle], [data-composer-send]')) event.preventDefault();
    };
    node.addEventListener('focusin', focus); node.addEventListener('pointerdown', pointer);
    window.visualViewport?.addEventListener('resize', this.resize); window.addEventListener('resize', this.resize);
    this.apply(open);
    return { update: (next: boolean) => this.apply(next), destroy: () => {
      node.removeEventListener('focusin', focus); node.removeEventListener('pointerdown', pointer);
      window.visualViewport?.removeEventListener('resize', this.resize); window.removeEventListener('resize', this.resize);
      this.restoreMode(); this.node = undefined; this.field = undefined;
    } };
  };
}
