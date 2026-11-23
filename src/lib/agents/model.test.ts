import { describe, expect, it, vi } from 'vitest';
import { agentKeyFor, emptyAgentSettings, generateAgentReply, modelEndpoint, normalizeAgentSettings } from './model';

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
  it('keeps the reply limit off unless a positive integer was explicitly saved', () => {
    for (const replyLimit of [undefined, 0, -1, 1.5, '20']) {
      expect(normalizeAgentSettings({ replyLimit })).not.toHaveProperty('replyLimit');
    }
    expect(normalizeAgentSettings({ replyLimit: 20 }).replyLimit).toBe(20);
  });
  it('sends only the bounded prompt to the configured API and rejects redirects', async () => {
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: ' test reply ' } }] })));
    const settings = { ...emptyAgentSettings(), backend: 'cloud' as const, endpoint: 'https://example.test/v1/chat/completions', model: 'small' };
    const signal = new AbortController().signal;
    expect(await generateAgentReply(settings, 'hello', 'test-key', signal, request)).toBe('test reply');
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(settings.endpoint);
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal, headers: { Authorization: 'Bearer test-key' } });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'small', max_tokens: 96, messages: [
      { role: 'user', content: 'hello' },
    ] });
  });
  it('rejects aborted and oversized model responses', async () => {
    const settings = { ...emptyAgentSettings(), backend: 'cloud' as const, endpoint: 'https://example.test/v1', model: 'small' };
    const controller = new AbortController(); controller.abort();
    const request = vi.fn(async () => new Response('x'.repeat(65537)));
    await expect(generateAgentReply(settings, 'hello', '', controller.signal, request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    await expect(generateAgentReply(settings, 'hello', '', new AbortController().signal, request)).rejects.toThrow('agent_response_invalid');
  });
  it.each([
    [401, 'invalid_api_key', 'agent_api_key_rejected'],
    [403, 'unsupported_country_region_territory', 'agent_api_region'],
    [403, 'permission_denied', 'agent_api_forbidden'],
    [404, 'model_not_found', 'agent_api_model_missing'],
    [404, null, 'agent_api_endpoint_missing'],
    [429, 'insufficient_quota', 'agent_api_quota'],
    [429, 'credit_balance_exhausted', 'agent_api_credits'],
    [429, 'project_spend_limit_exceeded', 'agent_api_quota'],
    [429, 'organization_spend_limit_exceeded', 'agent_api_quota'],
    [429, 'organization_usage_limit_exceeded', 'agent_api_quota'],
    [429, 'rate_limit_exceeded', 'agent_api_rate_limit'],
    [429, 'slow_down', 'agent_api_rate_limit'],
    [429, null, 'agent_api_limit'],
    [400, 'unsupported_parameter', 'agent_api_invalid_request'],
    [503, null, 'agent_api_service_unavailable'],
  ])('maps HTTP %i and %s without exposing the provider body', async (status, code, message) => {
    const settings = { ...emptyAgentSettings(), backend: 'cloud' as const, endpoint: 'https://example.test/v1/chat/completions', model: 'small' };
    const body = code ? JSON.stringify({ error: { code, message: 'Never display this provider response' } }) : 'Non-JSON response';
    const request = vi.fn(async () => new Response(body, { status }));
    await expect(generateAgentReply(settings, 'hello', 'test-key', new AbortController().signal, request)).rejects.toEqual(new Error(message));
  });
  it('separates an unreachable API from cancellation', async () => {
    const settings = { ...emptyAgentSettings(), backend: 'cloud' as const, endpoint: 'https://example.test/v1/chat/completions', model: 'small' };
    const controller = new AbortController();
    const request = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(generateAgentReply(settings, 'hello', '', controller.signal, request)).rejects.toThrow('agent_api_unreachable');
    const cancelRequest = vi.fn(async () => { controller.abort(); throw controller.signal.reason; });
    await expect(generateAgentReply(settings, 'hello', '', controller.signal, cancelRequest)).rejects.toMatchObject({ name: 'AbortError' });
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
  it('keeps the separate chat local even if an API source was selected', async () => {
    const request = vi.fn();
    for (const backend of ['cloud', 'local'] as const) {
      const settings = { ...emptyAgentSettings(), backend, enabled: true };
      await expect(generateAgentReply(settings, 'Local message', '', new AbortController().signal, request,
        { localHistory: [] })).rejects.toThrow('agent_chat_requires_local_model');
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('gives the on-device browser model previous turns of the separate chat', async () => {
    const create = vi.fn(async () => ({ prompt: async () => 'Still blue.\n\n **Follow-up**', destroy: () => {} }));
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
    try {
      const localHistory = [{ role: 'user' as const, content: 'Sky color?' }, { role: 'assistant' as const, content: 'Blue.' }];
      const result = await generateAgentReply({ ...emptyAgentSettings(), backend: 'browser' }, 'At noon?', '', new AbortController().signal, vi.fn(), { localHistory });
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ initialPrompts: localHistory }));
      expect(result).toBe('Still blue.\n\n **Follow-up**');
    } finally { vi.unstubAllGlobals(); }
  });
});
