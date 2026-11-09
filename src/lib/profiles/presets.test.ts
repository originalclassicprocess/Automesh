import { describe,expect,it } from 'vitest';
import { ALL_CHATS_VIEW, PROFILE_PRESETS, profilePreset } from './presets';
describe('profile presets, not routing automations', () => {
  it('offers five independent address templates, never an all-chats network profile', () => {
    expect(PROFILE_PRESETS.map(p => p.id)).toEqual(['personal','work','automation','incoming','outgoing']);
    expect(() => profilePreset(ALL_CHATS_VIEW)).toThrow('unknown_profile_preset');
    expect(PROFILE_PRESETS.every(p => ['personal','custom','incoming','outgoing'].includes(p.role))).toBe(true);
    expect(profilePreset('incoming').description).toContain('следующий этап');
    expect(profilePreset('automation').description).toContain('не запускает ботов');
  });
});
