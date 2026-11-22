import { describe, expect, it } from 'vitest';
import { fileModelPrompt, normalizeFilePromptFormats } from './file-model-prompt';

describe('GGUF prompt formats', () => {
  it('prefers the chat template from the file and handles models without it', () => {
    expect(fileModelPrompt(true, 'phi2', undefined, '', 'Question')).toEqual({ kind: 'chat' });
    expect(fileModelPrompt(false, 'phi2', undefined, '', 'Question')).toMatchObject({ kind: 'phi2', prompt: 'Instruct: Question\nOutput:' });
    expect(fileModelPrompt(false, 'llama', undefined, '', 'Question')).toEqual({ kind: 'completion', prompt: 'Question' });
  });

  it('allows a per-model override and inserts the prompt literally', () => {
    const custom = { mode: 'custom' as const, template: 'Question: {{prompt}}\nAnswer:' };
    expect(fileModelPrompt(true, 'llama', custom, 'Keep it short.', '$& {{prompt}}')).toEqual({
      kind: 'custom', prompt: 'Question: Keep it short.\n\n$& {{prompt}}\nAnswer:',
    });
    expect(fileModelPrompt(true, 'llama', { mode: 'completion' }, '', 'Question')).toEqual({ kind: 'completion', prompt: 'Question' });
  });

  it('restores independent formats and ignores malformed entries', () => {
    const first = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const second = '00000000-0000-4000-8000-000000000000';
    expect(normalizeFilePromptFormats({
      [first]: { mode: 'custom', template: 'Q: {{prompt}}\nA:' }, [second]: { mode: 'completion' },
      invalid: { mode: 'completion' }, '12345678-0000-4000-8000-000000000000': { mode: 'custom', template: 'Missing marker' },
    })).toEqual({ [first]: { mode: 'custom', template: 'Q: {{prompt}}\nA:' }, [second]: { mode: 'completion' } });
  });
});
