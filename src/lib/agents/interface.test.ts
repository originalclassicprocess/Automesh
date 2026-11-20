import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import { setLanguage } from '$lib/i18n/language';
import AgentSettings from './AgentSettings.svelte';
import AgentChatControls from './AgentChatControls.svelte';
import { emptyAgentSettings } from './model';

const action = () => {};
describe('account AI interface', () => {
  it('renders localized settings actions and clearly shows disabled state', () => {
    setLanguage('en');
    const html = render(AgentSettings, { props: { settings: emptyAgentSettings(), busy: false, working: false, notice: '', keyPresent: false, automatic: false, save: async () => true, test: async () => true, stop: action, forgetKey: action, revokeAuto: action } }).body;
    expect(html).toContain('AI for this account');
    expect(html).toContain('Disabled');
    expect(html).toContain('Browser model');
    expect(html).toContain('Local engine (PC)');
    expect(html).toContain('Cloud API');
  });
  it('renders a compact chat toolbar with remaining automatic replies', () => {
    setLanguage('en');
    const html = render(AgentChatControls, { props: { working: false, disabled: false, canDraft: true, automatic: true, remaining: 7, notice: '', draft: action, stop: action, toggleAuto: action } }).body;
    expect(html).toContain('AI assistant');
    expect(html).toContain('/ai · 7');
    expect(html).toContain('aria-expanded="false"');
  });
});
