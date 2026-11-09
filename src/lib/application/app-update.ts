export type AppUpdateState = {
  phase: 'idle' | 'checking' | 'downloading' | 'current' | 'available' | 'applying' | 'error' | 'unsupported';
  message: string;
  nextVersion?: string;
};
export type PreparedUpdate<T> = { version: string; complete: boolean; reloadNeeded: boolean; target: T };
export interface UpdatePort<T> {
  currentVersion: string;
  latestVersion(): Promise<string>;
  prepare(version: string): Promise<PreparedUpdate<T>>;
  activate(target: T): Promise<void>;
  reload(): void;
}

// Only the explicitly requesting tab is reloaded. Other tabs keep their code.
export class AppUpdater<T> {
  private target: PreparedUpdate<T> | null = null;
  private disposed = false;
  state: AppUpdateState = { phase: 'idle', message: 'Обновления ещё не проверены.' };
  constructor(private readonly port: UpdatePort<T>, private readonly changed: (state: AppUpdateState) => void) {}
  private set(state: AppUpdateState) { this.state = state; if (!this.disposed) this.changed(state); }
  dispose() { this.disposed = true; this.target = null; }
  async check(): Promise<void> {
    if (this.disposed || ['checking', 'downloading', 'applying'].includes(this.state.phase)) return;
    this.target = null; this.set({ phase: 'checking', message: 'Проверяем версию на сайте…' });
    try {
      const version = await this.port.latestVersion();
      if (this.disposed) return;
      this.set({ phase: 'downloading', message: 'Подготавливаем полную офлайн-копию…', nextVersion: version });
      const prepared = await this.port.prepare(version);
      if (this.disposed) return;
      if (!prepared.complete || prepared.version !== version) throw new Error('Обновление ещё не сохранено полностью. Повторите проверку позже.');
      this.target = prepared;
      this.set({ phase: version !== this.port.currentVersion || prepared.reloadNeeded ? 'available' : 'current',
        message: version !== this.port.currentVersion || prepared.reloadNeeded
          ? 'Новая копия готова. Можно обновить эту вкладку.' : 'Установлена актуальная версия. Офлайн-копия готова.', nextVersion: version });
    } catch (error) {
      if (this.disposed) return;
      this.set({ phase: error instanceof Error && error.message === 'updates_unavailable' ? 'unsupported' : 'error',
        message: error instanceof Error && error.message !== 'updates_unavailable' ? error.message :
          'Обновление офлайн-копии доступно в production-версии с поддержкой PWA.' });
    }
  }
  async apply(beforeReload: () => Promise<string | null>): Promise<void> {
    if (this.disposed || this.state.phase !== 'available' || !this.target) return;
    const target = this.target;
    this.set({ phase: 'applying', message: 'Завершаем сохранение и готовим обновление…', nextVersion: target.version });
    try {
      const blocked = await beforeReload();
      if (this.disposed) return;
      if (blocked) { this.set({ phase: 'available', message: blocked, nextVersion: target.version }); return; }
      await this.port.activate(target.target);
      if (!this.disposed) this.port.reload();
    } catch (error) {
      if (!this.disposed) this.set({ phase: 'error', message: error instanceof Error ? error.message :
        'Не удалось обновить приложение. Старая копия не удалена.' });
    }
  }
}
