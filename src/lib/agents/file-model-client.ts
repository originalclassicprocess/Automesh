import { readFileModel } from './file-models';
import type { PortableDevice } from './portable-models';

let active: { worker: Worker; id: string; device: PortableDevice } | undefined;
let interrupt: (() => void) | undefined;

export function stopFileModel(): void {
  active?.worker.terminate();
  active = undefined;
  interrupt?.();
}

export async function generateFileModelReply(id: string, device: PortableDevice, system: string, input: string,
  signal: AbortSignal, maxTokens: number): Promise<string> {
  signal.throwIfAborted();
  if (interrupt) throw new Error('agent_file_busy');
  if (active?.id !== id || active.device !== device) stopFileModel();
  const file = active ? undefined : await readFileModel(id);
  signal.throwIfAborted();
  if (interrupt) throw new Error('agent_file_busy');
  active ??= { worker: new Worker(new URL('./file-model-worker.ts', import.meta.url), { type: 'module' }), id, device };
  const worker = active.worker;
  return new Promise((resolve, reject) => {
    function finish(error?: Error, text?: string) {
      interrupt = undefined;
      signal.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      if (error) { stopFileModel(); reject(error); }
      else resolve(text ?? '');
    }
    function cancel() { finish(new DOMException('Aborted', 'AbortError')); }
    interrupt = cancel;
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : undefined, data.text);
    worker.onerror = worker.onmessageerror = () => finish(new Error('agent_file_load_failed'));
    try { worker.postMessage({ file, device, system, input, maxTokens }); }
    catch { finish(new Error('agent_file_load_failed')); }
  });
}
