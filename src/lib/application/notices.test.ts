import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountNotice, microphoneNotice, NoticeTimer } from './notices';
import NotificationToast from './NotificationToast.svelte';
import { render } from 'svelte/server';
afterEach(()=>vi.useRealTimers());
describe('bounded transient notices',()=> {
  it('expires known confirmations but retains unknown and data-loss errors',()=> {
    expect(accountNotice('Ссылка на контакт скопирована.').durationMs).toBe(3000);
    expect(accountNotice('Файлы переданы браузеру для скачивания. Сохранение на диск управляется браузером.').durationMs).toBe(3000);
    for (const text of ['Не удалось сохранить локальную историю.','Сообщение не отправлено.','Не удалось изменить пароль. Старый пароль сохранён.','new unknown status']) expect(accountNotice(text).durationMs).toBe(0);
  });
  it('provides short permission/device/format notices with optional details',()=> {
    const denied = microphoneNotice(new DOMException('untrusted long browser text','NotAllowedError'));
    expect(denied.message).toBe('Разрешите микрофон в браузере.'); expect(denied.durationMs).toBe(7000); expect(denied.message).not.toContain('untrusted');
    expect(microphoneNotice(new DOMException('','NotFoundError')).message).toBe('Микрофон не найден.');
    expect(microphoneNotice(new Error('recording_unsupported')).message).toContain('не поддерживается');
    expect(microphoneNotice(new Error('unknown')).message).toBe('Микрофон недоступен.');
  });
  it('dismisses only the notice and cancels obsolete timers on replacement/disposal',()=> {
    vi.useFakeTimers(); const dismissed = vi.fn(), timer = new NoticeTimer(dismissed);
    timer.update(3000); vi.advanceTimersByTime(2000); timer.update(7000); vi.advanceTimersByTime(1000); expect(dismissed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(6000); expect(dismissed).toHaveBeenCalledOnce();
    timer.update(3000); timer.dispose(); vi.advanceTimersByTime(3000); expect(dismissed).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('pauses while reading details/focused and never times out critical notices',()=> {
    vi.useFakeTimers(); const dismissed=vi.fn(), timer=new NoticeTimer(dismissed);
    timer.update(7000,true); vi.advanceTimersByTime(10000); expect(dismissed).not.toHaveBeenCalled();
    timer.update(7000); vi.advanceTimersByTime(6000); expect(dismissed).not.toHaveBeenCalled();
    timer.update(0); vi.advanceTimersByTime(10000); expect(dismissed).not.toHaveBeenCalled(); timer.dispose();
  });
  it('renders the short text with a close button and keeps long details collapsed',()=> {
    const notice=microphoneNotice(new DOMException('','NotAllowedError'));
    const html=render(NotificationToast,{props:{notice,onClose:()=>{}}}).body;
    expect(html).toContain(notice.message); expect(html).toContain('Подробнее'); expect(html).toContain('Закрыть уведомление');
    expect(html).not.toContain(notice.details); expect(html).toContain('role="alert"');
  });
});
