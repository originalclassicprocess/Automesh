import { describe, expect, it, vi } from 'vitest';
import { agentKeyFor, commandPrompt, emptyAgentSettings, generateAgentReply, modelEndpoint, normalizeAgentSettings, replyContext } from './model';
import type { ChatEntry } from '$lib/chat/session-chats';

describe('account AI model adapters', () => {
  it('defaults off and never retains credentials or automatic permissions', () => {
    expect(normalizeAgentSettings(undefined)).toEqual(emptyAgentSettings());
    const settings = normalizeAgentSettings({ enabled: true, backend: 'cloud', endpoint: 'https://example.test/v1/chat/completions', model: 'small', apiKey: 'secret', autoPeer: 'peer' });
    expect(settings.enabled).toBe(true);
    expect(settings).not.toHaveProperty('apiKey');
    expect(settings).not.toHaveProperty('autoPeer');
  });
  it.each(['http://example.test/v1', 'https://user:pass@example.test/v1', 'https://example.test/v1?key=secret', 'file:///secret'])('rejects unsafe cloud endpoint %s', endpoint => {
    expect(() => modelEndpoint({ ...emptyAgentSettings(), backend: 'cloud', model: 'small', endpoint })).toThrow('agent_endpoint_invalid');
  });
  it('accepts loopback local endpoints and rejects non-loopback HTTP', () => {
    const settings = { ...emptyAgentSettings(), backend: 'local' as const, model: 'small', endpoint: 'http://127.0.0.1:11434/v1/chat/completions' };
    expect(modelEndpoint(settings)).toBe(settings.endpoint);
    expect(() => modelEndpoint({ ...settings, endpoint: 'http://192.168.1.10:11434/v1' })).toThrow();
  });
  it('keeps an in-memory key on the same provider only, never forwards it to a changed endpoint', () => {
    const previous = { ...emptyAgentSettings(), backend: 'cloud' as const, endpoint: 'https://example.test/v1/chat/completions', model: 'small' };
    expect(agentKeyFor(previous, { ...previous, model: 'other' }, 'old-key', '')).toBe('old-key');
    expect(agentKeyFor(previous, { ...previous, endpoint: 'https://other.test/v1' }, 'old-key', '')).toBe('');
    expect(agentKeyFor(previous, { ...previous, backend: 'local' }, 'old-key', '')).toBe('');
    expect(agentKeyFor(previous, { ...previous, endpoint: 'https://other.test/v1' }, 'old-key', 'new-key')).toBe('new-key');
  });
  it('uses only explicit bounded commands and does not interpret AI replies as commands', () => {
    expect(commandPrompt('/ai hello')).toBe('hello');
    expect(commandPrompt('[AI] /ai hello')).toBeNull();
    expect(commandPrompt('/ai ')).toBeNull();
    expect(commandPrompt('/ai ' + 'a'.repeat(2000))).toHaveLength(1200);
  });
  it('bounds chat history and excludes ephemeral content and non-text messages', () => {
    const entry = (text: string, extra: Partial<ChatEntry> = {}): ChatEntry => ({ direction: 'incoming', id: text, from: 'peer', text, timestamp: 1, ...extra });
    const context = replyContext([
      entry('oldest'), ...Array.from({ length: 6 }, (_, i) => entry('text ' + i)),
      entry('secret', { details: { ephemeral: { seconds: 10, allowDownload: false } } }),
      entry('pinned', { details: { pin: { targetId: null, revision: 1 } } }),
    ]);
    expect(context).not.toContain('secret'); expect(context).not.toContain('pinned'); expect(context).not.toContain('oldest');
    expect(context.split('\n')).toHaveLength(6);
  });
  it('sends only the bounded prompt to the configured API and rejects redirects', async () => {
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: ' test reply ' } }] })));
    const settings = { ...emptyAgentSettings(), backend: 'cloud' as const, endpoint: 'https://example.test/v1/chat/completions', model: 'small' };
    const signal = new AbortController().signal;
    expect(await generateAgentReply(settings, 'hello', 'test-key', signal, request)).toBe('test reply');
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(settings.endpoint);
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal, headers: { Authorization: 'Bearer test-key' } });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'small', max_tokens: 160, messages: [{ role: 'system' }, { role: 'user', content: 'hello' }] });
  });
  it('rejects aborted and oversized model responses', async () => {
    const settings = { ...emptyAgentSettings(), backend: 'cloud' as const, endpoint: 'https://example.test/v1', model: 'small' };
    const controller = new AbortController(); controller.abort();
    const request = vi.fn(async () => new Response('x'.repeat(65537)));
    await expect(generateAgentReply(settings, 'hello', '', controller.signal, request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    await expect(generateAgentReply(settings, 'hello', '', new AbortController().signal, request)).rejects.toThrow('agent_response_invalid');
  });
  it('uses the on-device browser session without a fetch and releases model resources', async () => {
    const destroy = vi.fn(), prompt = vi.fn(async () => 'local reply');
    const request = vi.fn();
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => ({ prompt, destroy }) });
    try {
      expect(await generateAgentReply({ ...emptyAgentSettings(), backend: 'browser' }, 'hello', '', new AbortController().signal, request)).toBe('local reply');
      expect(prompt).toHaveBeenCalled(); expect(destroy).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not start a model download when the account limits internet access', async () => {
    const create = vi.fn();
    vi.stubGlobal('LanguageModel', { availability: async () => 'downloadable', create });
    try {
      await expect(generateAgentReply({ ...emptyAgentSettings(), backend: 'browser' }, 'hello', '', new AbortController().signal, vi.fn(), { allowBrowserDownload: false })).rejects.toThrow('agent_browser_download_disabled');
      expect(create).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
