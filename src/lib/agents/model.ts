import { portableModelId, type PortableDevice } from './portable-models';
import { generatePortableReply, stopPortableModel } from './portable-client';
import { generateFileModelReply, stopFileModel } from './file-model-client';
import { normalizeFilePromptFormats, type FileModelProgress, type FilePromptFormat } from './file-model-prompt';
import type { AgentTurn } from './local-chat';

export type AgentSettings = {
  enabled: boolean;
  backend: 'file' | 'portable' | 'browser' | 'local' | 'cloud';
  endpoint: string;
  model: string;
  instructions: string;
  portableDevice?: PortableDevice;
  legacyModel?: string;
  fileFormats?: Record<string, FilePromptFormat>;
  replyLimit?: number;
};

export const emptyAgentSettings = (): AgentSettings => ({
  enabled: false, backend: 'file', endpoint: '', model: '', instructions: '', portableDevice: 'wasm',
});

export function normalizeAgentSettings(value: unknown): AgentSettings {
  const raw = value && typeof value === 'object' ? value as Partial<AgentSettings> : {};
  const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const backend = raw.backend === 'portable' || raw.backend === 'browser' || raw.backend === 'local' || raw.backend === 'cloud' ? raw.backend : 'file';
  const fileFormats = normalizeFilePromptFormats(raw.fileFormats);
  return {
    enabled: raw.enabled === true,
    backend,
    endpoint: backend === 'local' || backend === 'cloud' ? text(raw.endpoint, 2048) : '',
    model: backend === 'portable' ? portableModelId(raw.model) : text(raw.model, 256), instructions: text(raw.instructions, 1024),
    ...(typeof raw.replyLimit === 'number' && Number.isSafeInteger(raw.replyLimit) && raw.replyLimit > 0 ? { replyLimit: raw.replyLimit } : {}),
    ...(backend === 'portable' || backend === 'file' ? { portableDevice: raw.portableDevice === 'webgpu' ? 'webgpu' as const : 'wasm' as const } : {}),
    ...(typeof raw.legacyModel === 'string' && raw.legacyModel ? { legacyModel: portableModelId(raw.legacyModel) } : {}),
    ...(fileFormats ? { fileFormats } : {}),
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
  if (next.backend !== 'local' && next.backend !== 'cloud') return '';
  return entered.trim() || (previous.backend === next.backend && previous.endpoint === next.endpoint ? existing : '');
}

type BrowserSession = {
  prompt(input: string, options: { signal: AbortSignal }): Promise<string>;
  destroy(): void;
};
type BrowserModel = {
  availability(): Promise<string>;
  create(options: { initialPrompts?: ({ role: 'system'; content: string } | AgentTurn)[]; signal: AbortSignal }): Promise<BrowserSession>;
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

async function apiError(response: Response): Promise<Error> {
  const { status } = response;
  // A provider's error message can echo secrets or prompt text. Only use
  // known error codes to select an application-owned message.
  const data = await readResponse(response).catch(() => null) as { error?: { code?: unknown; type?: unknown } } | null;
  const code = data?.error?.code ?? data?.error?.type;
  if (status === 401) return new Error('agent_api_key_rejected');
  if (status === 403) return new Error(code === 'unsupported_country_region_territory' ? 'agent_api_region' : 'agent_api_forbidden');
  if (status === 404) return new Error(code === 'model_not_found' ? 'agent_api_model_missing' : 'agent_api_endpoint_missing');
  if (status === 429) {
    if (code === 'credit_balance_exhausted') return new Error('agent_api_credits');
    if (['billing_hard_limit_reached', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded'].some(limit => code === limit) ||
        code === 'insufficient_quota' || data?.error?.type === 'insufficient_quota') return new Error('agent_api_quota');
    if (code === 'rate_limit_exceeded' || code === 'slow_down' || data?.error?.type === 'rate_limit_error') return new Error('agent_api_rate_limit');
    return new Error('agent_api_limit');
  }
  if (status === 400 || status === 422) return new Error('agent_api_invalid_request');
  if (status >= 500) return new Error('agent_api_service_unavailable');
  return new Error('agent_request_failed');
}

export async function generateAgentReply(settings: AgentSettings, prompt: string, key: string, signal: AbortSignal,
  request: typeof fetch = fetch, options: { allowBrowserDownload?: boolean; radio?: boolean; onFileProgress?: (value: FileModelProgress) => void; localHistory?: AgentTurn[] } = {}): Promise<string> {
  signal.throwIfAborted();
  if (options.localHistory && (settings.backend === 'local' || settings.backend === 'cloud')) throw new Error('agent_chat_requires_local_model');
  const system = settings.instructions;
  const input = prompt.slice(0, 4000);
  const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: input }];
  let result: unknown;
  if (settings.backend !== 'file') stopFileModel();
  if (settings.backend !== 'portable') stopPortableModel();
  if (settings.backend === 'file') {
    result = await generateFileModelReply(settings.model, settings.portableDevice ?? 'wasm', system, input, signal,
      options.radio ? 48 : 128, settings.fileFormats?.[settings.model], options.onFileProgress, options.localHistory);
  } else if (settings.backend === 'portable') {
    result = await generatePortableReply(portableModelId(settings.model), settings.portableDevice ?? 'wasm', system, input, signal, options.localHistory);
  } else if (settings.backend === 'browser') {
    const model = browserModel();
    const availability = await modelAvailability();
    if (!model || availability === 'unavailable') throw new Error('agent_browser_unavailable');
    if (options.allowBrowserDownload === false && availability !== 'available') throw new Error('agent_browser_download_disabled');
    signal.throwIfAborted();
    const initialPrompts = [...(system ? [{ role: 'system' as const, content: system }] : []), ...(options.localHistory ?? [])];
    const session = await model.create({ ...(initialPrompts.length ? { initialPrompts } : {}), signal });
    try { signal.throwIfAborted(); result = await session.prompt(input, { signal }); }
    finally { session.destroy(); }
  } else {
    const url = modelEndpoint(settings);
    const response = await request(url, {
      method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: settings.model, messages, max_tokens: options.radio ? 64 : 96, stream: false }),
    }).catch(() => {
      signal.throwIfAborted();
      throw new Error('agent_api_unreachable');
    });
    if (!response.ok) throw await apiError(response);
    const data = await readResponse(response) as { choices?: { message?: { content?: unknown } }[] } | null;
    result = data?.choices?.[0]?.message?.content;
  }
  signal.throwIfAborted();
  if (typeof result !== 'string' || !result.trim()) throw new Error('agent_response_invalid');
  if (options.localHistory) return result.trim().slice(0, 1200);
  const lines = result.trim().split(/\n+/).map(line => line.trim()).filter(Boolean);
  return [...new Set(lines)].join('\n').slice(0, 1200);
}
