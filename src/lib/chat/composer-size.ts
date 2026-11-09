// Keep one line idle, grow as text is entered, then scroll rather than squeeze
// the entire chat out of a short phone viewport.
export function composerHeight(scrollHeight: number, lineHeight: number, verticalPadding: number, viewportHeight: number): number {
  const minimum = lineHeight + verticalPadding;
  const maximum = Math.max(minimum, Math.min(120, viewportHeight * .2));
  return Math.ceil(Math.min(maximum, Math.max(minimum, scrollHeight)));
}

export function autoSizeComposer(node: HTMLTextAreaElement, _draft: string) {
  const resize = () => {
    if (!node.isConnected) return;
    const style = getComputedStyle(node);
    const line = parseFloat(style.lineHeight) || 24;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    node.style.height = '0px';
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    node.style.height = `${composerHeight(node.scrollHeight + 2, line, padding, viewport)}px`;
  };
  let width = node.clientWidth;
  let frame = 0;
  // Height changes must not retrigger sizing in a ResizeObserver loop.
  const widths = new ResizeObserver(() => { if (node.clientWidth !== width) {
    width = node.clientWidth; cancelAnimationFrame(frame);
    // Writing height inside the observer delivery can cause Safari/Chromium
    // resize-loop warnings when a breakpoint changes the composer columns.
    frame = requestAnimationFrame(resize);
  } });
  widths.observe(node); node.addEventListener('input', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();
  return { update() { queueMicrotask(resize); }, destroy() {
    widths.disconnect(); cancelAnimationFrame(frame); node.removeEventListener('input', resize);
    window.visualViewport?.removeEventListener('resize', resize);
  } };
}
