import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { isRoutineConnectionNotice } from './connection-notice';
import ConnectionNotice from './ConnectionNotice.svelte';
describe('compact connection notices',()=> {
  it('collapses expected direct connection states but not actionable errors',()=> {
    expect(isRoutineConnectionNotice('Собеседник не ответил. Выберите чат, чтобы повторить подключение.')).toBe(true);
    expect(isRoutineConnectionNotice('Сообщения ждут появления собеседника в сети.')).toBe(true);
    for (const error of ['', 'Сообщение слишком длинное (максимум 64 КБ).', 'Не удалось сохранить историю', 'Нода не доступна', 'network_failed']) expect(isRoutineConnectionNotice(error)).toBe(false);
  });
  it('uses an accessible compact button and no visible full-width paragraph by default',()=> {
    const text = 'Сообщения ждут появления собеседника в сети.';
    const html = render(ConnectionNotice,{props:{text,onRetry:()=>{}}}).body;
    expect(html).toContain('Состояние прямого соединения: подробнее'); expect(html).toContain('role="status"');
    expect(html).toContain(text); expect(html).not.toContain('<dialog'); expect(html).not.toMatch(/<p(?:\s|>)/);
  });
});
