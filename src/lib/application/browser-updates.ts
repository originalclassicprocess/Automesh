import { base } from '$app/paths';
import { version } from '$app/environment';
import { AppUpdater, type AppUpdateState, type UpdatePort } from './app-update';

type WorkerTarget = { worker: ServiceWorker; registration: ServiceWorkerRegistration; version: string };
type WorkerStatus = { version: string; complete: boolean };

export async function workerStatus(worker: ServiceWorker): Promise<WorkerStatus | null> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (value: WorkerStatus | null) => {
      clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(value);
    };
    const timer = setTimeout(() => finish(null), 3000);
    channel.port1.onmessage = event => {
      const data = event.data;
      if (data?.type === 'mesh-offline-status' && typeof data.version === 'string')
        finish({ version: data.version, complete: data.complete === true });
    };
    try { worker.postMessage({ type: 'mesh-offline-status' }, [channel.port2]); }
    catch { finish(null); }
  });
}

function installed(worker: ServiceWorker): Promise<void> {
  if (['installed', 'activating', 'activated'].includes(worker.state)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer); worker.removeEventListener('statechange', changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {
      if (['installed', 'activating', 'activated'].includes(worker.state)) finish();
      else if (worker.state === 'redundant') finish(new Error('Обновление не скачалось полностью. Рабочая копия сохранена.'));
    };
    const timer = setTimeout(() => finish(new Error('Подготовка обновления затянулась. Повторите проверку.')), 60_000);
    worker.addEventListener('statechange', changed); changed();
  });
}

export function browserUpdatePort(): UpdatePort<WorkerTarget> {
  return {
    currentVersion: version,
    async latestVersion() {
      if (!navigator.serviceWorker) throw new Error('updates_unavailable');
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${base}/_app/version.json`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('version_unavailable');
        const value = (await response.json()).version;
        if (typeof value !== 'string' || !value.length || value.length > 128) throw new Error('invalid_version');
        return value;
      } catch { throw new Error('Не удалось проверить сайт. Сохранённое приложение остаётся доступным.'); }
      finally { clearTimeout(timer); }
    },
    async prepare(expected) {
      const registration = await navigator.serviceWorker.getRegistration(`${base}/`);
      if (!registration) throw new Error('updates_unavailable');
      await registration.update();
      if (registration.installing) await installed(registration.installing);
      const worker = registration.waiting ?? registration.active;
      if (!worker) throw new Error('Офлайн-копия ещё устанавливается. Повторите проверку.');
      const status = await workerStatus(worker);
      if (!status || !status.complete || status.version !== expected)
        throw new Error('Сайт и офлайн-копия ещё не совпадают. Повторите проверку после завершения обновления сайта.');
      const controlling = navigator.serviceWorker.controller ? await workerStatus(navigator.serviceWorker.controller) : null;
      return { ...status, reloadNeeded: controlling?.version !== expected,
        target: { worker, registration, version: expected } };
    },
    async activate(target) {
      const status = await workerStatus(target.worker);
      if (!status?.complete || status.version !== target.version || target.worker.state === 'redundant')
        throw new Error('Подготовленная копия больше не доступна. Повторите проверку обновлений.');
      if (target.worker.state !== 'activated') {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timer); target.worker.removeEventListener('statechange', changed);
            error ? reject(error) : resolve();
          };
          const changed = () => {
            if (target.worker.state === 'activated') finish();
            else if (target.worker.state === 'redundant') finish(new Error('Обновление изменилось. Повторите проверку.'));
          };
          const timer = setTimeout(() => finish(new Error('Обновление пока не активировано. Рабочая копия сохранена.')), 10_000);
          target.worker.addEventListener('statechange', changed);
          target.worker.postMessage({ type: 'mesh-activate-update' }); changed();
        });
      }
    },
    reload: () => location.reload(),
  };
}

export function createBrowserUpdater(changed: (state: AppUpdateState) => void) {
  const updater = new AppUpdater(browserUpdatePort(), changed);
  // Answer only the worker's narrow cache-lifetime question. No account data.
  const reportVersion = (event: MessageEvent) => {
    if (event.data?.type === 'mesh-app-version' && event.ports[0])
      event.ports[0].postMessage({ type: 'mesh-app-version', version });
  };
  navigator.serviceWorker?.addEventListener('message', reportVersion);
  return { updater, dispose: () => {
    updater.dispose(); navigator.serviceWorker?.removeEventListener('message', reportVersion);
  } };
}
