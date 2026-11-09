// Accept real local files only. Dragging a link/text must never fetch a URL.
export function isFileDrag(data: Pick<DataTransfer, 'types'> | null): boolean {
  return !!data && Array.from(data.types).includes('Files');
}

export function droppedFiles(data: Pick<DataTransfer, 'types' | 'files'> | null): File[] {
  return isFileDrag(data) ? Array.from(data!.files) : [];
}

export function installFileDrop(node: HTMLElement, options: { canDrop(): boolean; target(): string; onFiles(files: File[]): void; onActive(active: boolean): void }) {
  let depth = 0, target = '';
  const reset = () => { depth = 0; target = ''; options.onActive(false); };
  const enter = (event: DragEvent) => {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (!depth) target = options.target();
    depth++;
    options.onActive(options.canDrop());
  };
  const over = (event: DragEvent) => {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = options.canDrop() ? 'copy' : 'none';
  };
  const leave = () => { depth = Math.max(0, depth - 1); if (!depth) reset(); };
  const drop = (event: DragEvent) => {
    if (!isFileDrag(event.dataTransfer)) return;
    // Even a disabled drop must not navigate this tab to a local file.
    const destination = target;
    event.preventDefault(); event.stopPropagation(); reset();
    if (destination && destination === options.target() && options.canDrop()) {
      const files = droppedFiles(event.dataTransfer);
      if (files.length) options.onFiles(files);
    }
  };
  node.addEventListener('dragenter', enter); node.addEventListener('dragover', over);
  node.addEventListener('dragleave', leave); node.addEventListener('drop', drop);
  window.addEventListener('dragend', reset); window.addEventListener('blur', reset);
  return { destroy() {
    node.removeEventListener('dragenter', enter); node.removeEventListener('dragover', over);
    node.removeEventListener('dragleave', leave); node.removeEventListener('drop', drop);
    window.removeEventListener('dragend', reset); window.removeEventListener('blur', reset); reset();
  } };
}
