import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import { setLanguage } from '$lib/i18n/language';
import AgentSettings from './AgentSettings.svelte';
import AgentChatControls from './AgentChatControls.svelte';
import { emptyAgentSettings } from './model';

const action = () => {};
describe('account AI interface', () => {
  it('renders localized provider settings and leaves the reply limit empty by default', () => {
    setLanguage('en');
    const html = render(AgentSettings, { props: { settings: emptyAgentSettings(), busy: false, working: false, notice: '', example: '', keyPresent: false, automatic: false, save: async () => true, test: async () => true, stop: action, forgetKey: action, revokeAuto: action } }).body;
    expect(html).toContain('Enable AI');
    expect(html).not.toContain('Requests per contact per session');
    expect(html).toContain('Built-in browser model');
    expect(html).toContain('Local engine (PC)');
    expect(html).toContain('Remote API');
  });
  it('renders a single composer button indicating auto-replies are on', () => {
    setLanguage('en');
    const html = render(AgentChatControls, { props: { working: false, disabled: false, automatic: true, notice: '', toggleAuto: action } }).body;
    expect(html).toContain('AI auto-replies');
    expect(html).toContain('Auto-replies on');
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="false"');
  });
});
