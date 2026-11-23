import type { AgentTurn } from './local-chat';

export type FilePromptFormat = { mode: 'completion' } | { mode: 'custom'; template: string };
export type FilePromptKind = 'chat' | 'phi2' | 'completion' | 'custom';
export type FileModelProgress = { stage: 'loading' } | { stage: 'generating'; format: FilePromptKind };

export const FILE_PROMPT_SLOT = '{{prompt}}';
export const MAX_FILE_PROMPT_TEMPLATE = 2048;

export function normalizeFilePromptFormat(value: unknown): FilePromptFormat | undefined {
  if (!value || typeof value !== 'object') return;
  const format = value as Partial<{ mode: string; template: string }>;
  if (format.mode === 'completion') return { mode: 'completion' };
  if (format.mode === 'custom' && typeof format.template === 'string' && format.template.length <= MAX_FILE_PROMPT_TEMPLATE &&
    format.template.includes(FILE_PROMPT_SLOT)) return { mode: 'custom', template: format.template };
}

export function normalizeFilePromptFormats(value: unknown): Record<string, FilePromptFormat> | undefined {
  if (!value || typeof value !== 'object') return;
  const entries: [string, FilePromptFormat][] = [];
  for (const [id, entry] of Object.entries(value).slice(-512)) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) continue;
    const format = normalizeFilePromptFormat(entry);
    if (format) entries.push([id, format]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function fileModelPrompt(hasChatTemplate: boolean, architecture: string | undefined, format: FilePromptFormat | undefined,
  system: string, input: string, history: AgentTurn[] = []): { kind: 'chat' } | { kind: Exclude<FilePromptKind, 'chat'>; prompt: string; stop?: string[] } {
  const text = system ? `${system}\n\n${input}` : input;
  const custom = format?.mode === 'custom' ? format.template : undefined;
  const completion = history.length ? `${history.map(turn => turn.content).join('\n\n')}\n\n${text}` : text;
  if (custom) return { kind: 'custom', prompt: custom.replaceAll(FILE_PROMPT_SLOT, () => completion) };
  if (format?.mode === 'completion') return { kind: 'completion', prompt: completion };
  if (hasChatTemplate) return { kind: 'chat' };
  if (architecture === 'phi2') {
    const previous = history.map(turn => turn.role === 'user' ? `Instruct: ${turn.content}\n` : `Output: ${turn.content}\n\n`).join('');
    return { kind: 'phi2', prompt: `${previous}Instruct: ${text}\nOutput:`, stop: ['\nInstruct:', '\nOutput:'] };
  }
  return { kind: 'completion', prompt: completion };
}
