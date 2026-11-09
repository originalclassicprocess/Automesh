// Ignore composition/repeat and gestures already handled by a native control.
export function isAppEscape(event: Pick<KeyboardEvent, 'key' | 'repeat' | 'isComposing' | 'defaultPrevented' | 'altKey' | 'ctrlKey' | 'metaKey'>): boolean {
  return event.key === 'Escape' && !event.repeat && !event.isComposing &&
    !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey;
}
