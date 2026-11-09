import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PasswordField from './PasswordField.svelte';
import EntryAbout from '$lib/application/EntryAbout.svelte';

describe('password and entry UI', () => {
  it('preserves password manager attributes, offers generation and starts masked', () => {
    const html = render(PasswordField, { props: { value: '', id: 'new', required: true } }).body;
    expect(html).toContain('type="password"'); expect(html).toContain('autocomplete="new-password"');
    expect(html).toContain('minlength="10"'); expect(html).toContain('Сгенерировать');
    expect(html).toContain('aria-describedby="new-strength"'); expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Пароль никуда не'); expect(html).not.toContain('Чем длиннее');
    expect(html).toContain('aria-label="Показать пароль"'); expect(html).toContain('<svg');
    expect(html).not.toMatch(/>Показать</);
  });
  it('puts security, recovery and technical explanations inside a collapsed details element', () => {
    const html = render(EntryAbout).body;
    expect(html).toContain('<details'); expect(html).not.toMatch(/<details[^>]*\sopen(?:\s|>|=)/);
    expect(html).toContain('Об аккаунте и связи'); expect(html).toContain('Сид (seed-фраза) восстанавливает доступ');
    expect(html).toContain('Справка: ключи и шифрование'); expect(html).toContain('подмены приложения');
    expect(html).toContain('Поддержка не восстанавливает секреты');
  });
});
