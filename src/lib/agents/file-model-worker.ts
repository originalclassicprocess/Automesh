import { Wllama } from '@wllama/wllama';
import wasm from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import compatWasm from '@wllama/wllama-compat/wasm/wllama.wasm?url';
import { fileModelPrompt, type FilePromptFormat } from './file-model-prompt';

type Prompt = { file?: File; device: 'wasm' | 'webgpu'; system: string; input: string; maxTokens: number; format?: FilePromptFormat };
let engine: Wllama | undefined;

self.onmessage = async ({ data }: MessageEvent<Prompt>) => {
  let stage = 'agent_file_run_failed';
  try {
    if (data.file) {
      if (data.device === 'webgpu' && !await navigator.gpu?.requestAdapter()) throw new Error('agent_file_gpu_unavailable');
      stage = 'agent_file_load_failed';
      engine = new Wllama({ default: new URL(wasm, self.location.href).href }, { suppressNativeLog: true });
      engine.setCompat({ wasm: new URL(compatWasm, self.location.href).href });
      await engine.loadModel([data.file], {
        n_ctx: 2048, n_parallel: 1, n_batch: 128, n_ubatch: 128,
        warmup: false,
        n_gpu_layers: data.device === 'webgpu' ? 999 : 0
      });
    }
    const model = engine!;
    const prompt = fileModelPrompt(!!model.getChatTemplate(), model.getModelMetadata().meta['general.architecture'],
      data.format, data.system, data.input);
    stage = 'agent_file_run_failed';
    self.postMessage({ progress: { stage: 'generating', format: prompt.kind } });
    const options = { stream: false as const, max_tokens: data.maxTokens };
    if (prompt.kind === 'chat') {
      const answer = await model.createChatCompletion({
        ...options,
        messages: [
          ...(data.system ? [{ role: 'system' as const, content: data.system }] : []),
          { role: 'user', content: data.input }
        ],
      });
      self.postMessage({ text: answer.choices[0]?.message.content });
    } else {
      const answer = await model.createCompletion({ ...options, prompt: prompt.prompt, stop: prompt.stop });
      self.postMessage({ text: answer.choices[0]?.text });
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    self.postMessage({ error: code === 'agent_file_gpu_unavailable' ? code : stage });
  }
};
