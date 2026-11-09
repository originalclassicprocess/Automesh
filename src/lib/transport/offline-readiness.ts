import { version } from '$app/environment';

export async function offlineReadiness(): Promise<'ready' | 'missing' | 'outdated' | 'unknown'> {
  if (!navigator.serviceWorker?.controller) return 'missing';
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => finish('unknown'), 2_000);
    const finish = (result: 'ready' | 'missing' | 'outdated' | 'unknown') => {
      clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(result);
    };
    channel.port1.onmessage = (event) => {
      if (event.data?.type === 'mesh-offline-status') finish(event.data.complete !== true ? 'missing' :
        event.data.version !== version ? 'outdated' : 'ready');
    };
    try { navigator.serviceWorker.controller!.postMessage({ type: 'mesh-offline-status' }, [channel.port2]); }
    catch { finish('unknown'); }
  });
}
