import type { ProfileRole } from '../core/profiles';

export const ALL_CHATS_VIEW = 'all-chats'; // UI view, never a signing identity or stored profile ID.
export const PROFILE_PRESETS = [
  { id: 'personal', name: 'Личный', role: 'personal', description: 'Для друзей и обычного общения.' },
  { id: 'work', name: 'Рабочий', role: 'custom', description: 'Отдельный адрес для рабочих контактов.' },
  { id: 'automation', name: 'Автоматизация', role: 'custom', description: 'Адрес для уведомлений и сервисов. Сам по себе не запускает ботов.' },
  { id: 'incoming', name: 'Входящие', role: 'incoming', description: 'Адрес для обращений. Автопереадресация и особые правила ответа — следующий этап.' },
  { id: 'outgoing', name: 'Исходящие', role: 'outgoing', description: 'Отдельный адрес для начала переписки. Ответы пока остаются в этом профиле.' },
] as const satisfies readonly { id: string; name: string; role: Exclude<ProfileRole, 'main'>; description: string }[];
export type ProfilePresetId = typeof PROFILE_PRESETS[number]['id'];
export function profilePreset(id: string) {
  const preset = PROFILE_PRESETS.find(p => p.id === id);
  if (!preset) throw new Error('unknown_profile_preset');
  return preset;
}
