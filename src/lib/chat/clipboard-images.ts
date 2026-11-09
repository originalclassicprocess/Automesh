const supported = new Set(['image/png','image/jpeg','image/webp','image/heic','image/heif','image/avif']);
// Read only the user-initiated paste event. Never request broad clipboard
// permission, inspect HTML, fetch pasted URLs, or send before confirmation.
export function clipboardImages(data: Pick<DataTransfer,'items' | 'files'> | null): File[] {
  if (!data) return [];
  const fromItems = Array.from(data.items ?? []).filter(item => item.kind === 'file' && supported.has(item.type.toLowerCase())).map(item => item.getAsFile()).filter((file): file is File => !!file);
  return (fromItems.length ? fromItems : Array.from(data.files ?? [])).filter(file => supported.has(file.type.toLowerCase()));
}
export function pastedText(value: string, inserted: string, start: number, end: number): string {
  return value.slice(0,start) + inserted + value.slice(end);
}
