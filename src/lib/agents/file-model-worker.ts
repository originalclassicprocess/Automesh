import { Wllama } from '@wllama/wllama';
import wasm from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import compatWasm from '@wllama/wllama-compat/wasm/wllama.wasm?url';

type Prompt = { file?: File; device: 'wasm' | 'webgpu'; system: string; input: string; maxTokens: number };
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
        n_gpu_layers: data.device === 'webgpu' ? 999 : 0
      });
      if (!engine.getChatTemplate()) throw new Error('agent_file_template_missing');
    }
    stage = 'agent_file_run_failed';
    const answer = await engine!.createChatCompletion({
      messages: [
        ...(data.system ? [{ role: 'system' as const, content: data.system }] : []),
        { role: 'user', content: data.input }
      ],
      stream: false,
      max_tokens: data.maxTokens,
    });
    self.postMessage({ text: answer.choices[0]?.message.content });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    self.postMessage({ error: ['agent_file_gpu_unavailable', 'agent_file_template_missing'].includes(code) ? code : stage });
  }
};
