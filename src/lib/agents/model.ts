import type { ChatEntry } from '$lib/chat/session-chats';
import { DEFAULT_PORTABLE_MODEL, portableModelId, type PortableDevice } from './portable-models';
import { generatePortableReply } from './portable-client';

export type AgentSettings = {
  enabled: boolean;
  backend: 'portable' | 'browser' | 'local' | 'cloud';
  endpoint: string;
  model: string;
  instructions: string;
  portableDevice?: PortableDevice;
};

export const emptyAgentSettings = (): AgentSettings => ({
  enabled: false, backend: 'portable', endpoint: '', model: DEFAULT_PORTABLE_MODEL, instructions: '', portableDevice: 'wasm',
});

export function normalizeAgentSettings(value: unknown): AgentSettings {
  const raw = value && typeof value === 'object' ? value as Partial<AgentSettings> : {};
  const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const backend = raw.backend === 'browser' || raw.backend === 'local' || raw.backend === 'cloud' ? raw.backend : 'portable';
  return {
    enabled: raw.enabled === true,
    backend,
    endpoint: backend === 'portable' || backend === 'browser' ? '' : text(raw.endpoint, 2048),
    model: backend === 'portable' ? portableModelId(raw.model) : text(raw.model, 256), instructions: text(raw.instructions, 1024),
    ...(backend === 'portable' ? { portableDevice: raw.portableDevice === 'webgpu' ? 'webgpu' as const : 'wasm' as const } : {}),
  };
}

// No discovery, proxy, redirects or credentials in URLs. Requests go only to
// the endpoint explicitly configured by the account owner.
export function modelEndpoint(settings: AgentSettings): string {
  let url: URL;
  try { url = new URL(settings.endpoint); } catch { throw new Error('agent_endpoint_invalid'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || url.search ||
      (settings.backend === 'local' ? !loopback || !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:')) {
    throw new Error('agent_endpoint_invalid');
  }
  if (!settings.model) throw new Error('agent_model_required');
  return url.href;
}

// A session key is bound to the exact endpoint/backend selected by the owner.
// Editing the model name may reuse it; changing providers never does.
export function agentKeyFor(previous: AgentSettings, next: AgentSettings, existing: string, entered: string): string {
  if (next.backend === 'browser' || next.backend === 'portable') return '';
  return entered.trim() || (previous.backend === next.backend && previous.endpoint === next.endpoint ? existing : '');
}

// A small, bounded context from exactly one chat, never other chats, files,
// ephemeral content, device metadata or keys.
export function replyContext(messages: readonly ChatEntry[]): string {
  const lines: string[] = [];
  for (let i = messages.length - 1; i >= Math.max(0, messages.length - 64) && lines.length < 6; i--) {
    const m = messages[i];
    if (!m.text.trim() || m.file || m.localCall || m.details?.ephemeral || m.details?.ephemeralOpened ||
        m.details?.pin || m.details?.edit || m.details?.reaction || m.details?.media || m.details?.contactCard || m.details?.radioContact) continue;
    lines.push(`${m.direction === 'incoming' ? 'Contact' : 'Me'}: ${m.text.slice(0, 600)}`);
  }
  return lines.reverse().join('\n');
}

export function commandPrompt(text: string): string | null {
  const match = /^\/ai\s+([\s\S]+)$/.exec(text.trim());
  return match ? match[1].trim().slice(0, 1200) || null : null;
}

type BrowserSession = {
  prompt(input: string, options: { signal: AbortSignal }): Promise<string>;
  destroy(): void;
};
type BrowserModel = {
  availability(): Promise<string>;
  create(): Promise<BrowserSession>;
};
const browserModel = () => (globalThis as typeof globalThis & { LanguageModel?: BrowserModel }).LanguageModel;
export async function modelAvailability(): Promise<string> {
  try { return await browserModel()?.availability() ?? 'unavailable'; }
  catch { return 'unavailable'; }
}

async function readResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('agent_response_invalid');
  let size = 0, text = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) throw new Error('agent_response_invalid');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function generateAgentReply(settings: AgentSettings, prompt: string, key: string, signal: AbortSignal,
  request: typeof fetch = fetch, options: { allowBrowserDownload?: boolean } = {}): Promise<string> {
  signal.throwIfAborted();
  const system = 'You are a chat participant. Reply briefly in the language of the contact. Output plain text only. ' + settings.instructions;
  const input = prompt.slice(0, 4000);
  let result: unknown;
  if (settings.backend === 'portable') {
    result = await generatePortableReply(portableModelId(settings.model), settings.portableDevice ?? 'wasm', system, input, signal);
  } else if (settings.backend === 'browser') {
    const model = browserModel();
    const availability = await modelAvailability();
    if (!model || availability === 'unavailable') throw new Error('agent_browser_unavailable');
    if (options.allowBrowserDownload === false && availability !== 'available') throw new Error('agent_browser_download_disabled');
    signal.throwIfAborted();
    const session = await model.create();
    try { signal.throwIfAborted(); result = await session.prompt(`${system}\n\n${input}`, { signal }); }
    finally { session.destroy(); }
  } else {
    const url = modelEndpoint(settings);
    const response = await request(url, {
      method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: settings.model, messages: [{ role: 'system', content: system }, { role: 'user', content: input }], max_tokens: 160, stream: false }),
    });
    if (!response.ok) throw new Error('agent_request_failed');
    const data = await readResponse(response) as { choices?: { message?: { content?: unknown } }[] } | null;
    result = data?.choices?.[0]?.message?.content;
  }
  signal.throwIfAborted();
  if (typeof result !== 'string' || !result.trim()) throw new Error('agent_response_invalid');
  return result.trim().slice(0, 1200);
}
