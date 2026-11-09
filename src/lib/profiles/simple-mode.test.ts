import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ProfileSwitcher from './ProfileSwitcher.svelte';
import ProfilesPanel from './ProfilesPanel.svelte';
import { PROFILE_FEATURES } from './features';
import ProfileIdentity from './ProfileIdentity.svelte';
import UnlockPasswordField from '../vault/UnlockPasswordField.svelte';

describe('simple profile interface', () => {
  it('combines the pixel avatar, nickname and profile without a generic glyph', () => {
    const html = render(ProfileIdentity, { props: { avatar: '/public.svg', nickname: 'Ник', profile: 'Рабочий', onOpen() {} } }).body;
    expect(html).toContain('<img'); expect(html).toContain('Ник'); expect(html).toContain('Рабочий'); expect(html).not.toContain('◫');
  });
  it('lists communication profiles in the own card, hiding the technical root and archived profiles', () => {
    const entries = ['main', 'personal', 'custom', 'custom'].map((role, index) => ({ id: `p${index}`, accountId: `example${index}`,
      role: role as 'main' | 'personal' | 'custom', index, name: ['SECRET ROOT', 'Личный', 'Рабочий', 'Архив'][index], archived: index === 3, createdAt: 1 }));
    const html = render(ProfileSwitcher, { props: { inline: true, profiles: entries, activeId:'p1', trusted:true, onSwitch:async () => false, onManage() {} } }).body;
    expect(html).toContain('Личный'); expect(html).toContain('Рабочий'); expect(html).toContain('текущий');
    expect(html).not.toContain('SECRET ROOT'); expect(html).not.toContain('Архив'); expect(html).not.toContain('type="password"');
  });
  it('allows current-password autofill without imposing the new-password policy on existing accounts', () => {
    const html = render(UnlockPasswordField, { props: { id:'profile-password', value:'' } }).body;
    expect(html).toContain('type="password"'); expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('name="password"'); expect(html).not.toContain('minlength'); expect(html).not.toContain('Сгенерировать');
  });
  it('keeps advanced inbox disabled by an immutable build policy', () => {
    expect(PROFILE_FEATURES.advancedInbox).toBe(false);
    expect(Object.isFrozen(PROFILE_FEATURES)).toBe(true);
  });
  it('does not advertise the aggregate inbox or its technical address in the switcher', () => {
    const main = { id: 'technical', accountId: 'never-display-owner', index: 0, role: 'main' as const, name: 'Все чаты', archived: false, createdAt: 1 };
    const html = render(ProfileSwitcher, { props: { profiles: [main],activeId: main.id,trusted: true,allChats: true,
      onSwitch: async () => false,onManage() {} } }).body;
    expect(html).toContain('Выберите профиль');
    expect(html).not.toContain('Все чаты'); expect(html).not.toContain(main.accountId);
  });
  it('describes separate ordinary profiles rather than a shared inbox in settings', () => {
    const html = render(ProfilesPanel, { props: { accountId: 'local-only',nickname: '',trusted: true } }).body;
    expect(html).toContain('Каждый профиль — отдельный адрес со своими чатами');
    expect(html).not.toContain('Все чаты'); expect(html).not.toContain('Подтвердить доступ');
  });
});
