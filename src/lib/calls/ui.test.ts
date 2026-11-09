import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import CallPanel from './CallPanel.svelte';
import { idleCall } from './controller';
import { callLabel, callTime } from './presentation';
describe('voice call interface', () => {
  const actions = { onAccept() {}, onEnd() {}, onMute() {}, onDismiss() {}, onChat() {} };
  it('keeps idle UI empty and gives incoming actions accessible names', () => {
    expect(render(CallPanel, { props: { view: idleCall(), stream: null, name: 'Контакт', ...actions } }).body).not.toContain('call-strip');
    const html = render(CallPanel, { props: { view: { ...idleCall(), id: crypto.randomUUID(), peer: 'peer', phase: 'incoming' }, stream: null, name: '<script>bad</script>', ...actions } }).body;
    expect(html).toContain('Принять звонок'); expect(html).toContain('Отклонить звонок'); expect(html).toContain('Входящий голосовой звонок');
    expect(html).not.toContain('<script>bad</script>');
  });
  it('shows finite human-readable errors and a safe nonnegative clock', () => {
    expect(callLabel({ ...idleCall(), phase: 'ended', reason: 'microphone' })).toBe('Микрофон недоступен');
    expect(callTime(1000, 62000)).toBe('1:01'); expect(callTime(1000, 0)).toBe('0:00');
  });
  it('renders the recorded end duration, not a continuing wall clock', () => {
    const view = { ...idleCall(), id: crypto.randomUUID(), phase: 'ended' as const, started: 1000, ended: 18000, reason: 'finished' as const };
    const html = render(CallPanel, { props: { view, stream: null, name: 'Контакт', ...actions } }).body;
    expect(html).toContain('0:17'); expect(html).toContain('Звонок завершён');
  });
});
