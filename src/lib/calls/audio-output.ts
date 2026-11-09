export interface OutputDevice { deviceId: string; label: string; kind: string }
export interface OutputPorts {
  sink?: (id: string) => Promise<void>;
  choose?: () => Promise<OutputDevice>;
  enumerate?: () => Promise<OutputDevice[]>;
  active(): boolean;
}
export type OutputResult = { ok: true; label: string } | { ok: false; message: string };
export const systemOutput = 'Выход устройства';
export const outputUnavailable = 'Браузер не позволяет выбирать аудиовыход. Используйте настройки звука устройства или подключите гарнитуру. Переключение «громкая связь / разговорный динамик» может быть недоступно.';
const failure = (error: unknown): OutputResult => {
  const name = error instanceof Error ? error.name : '';
  return { ok: false, message: name === 'NotAllowedError' ? 'Выбор аудиовыхода не разрешён. Текущий выход не изменён.'
    : name === 'NotFoundError' ? 'Аудиоустройство недоступно. Выберите другой выход.'
    : name === 'AbortError' ? 'Переключение отменено. Попробуйте ещё раз.' : 'Не удалось переключить аудиовыход. Попробуйте ещё раз.' };
};
// Local to one call/audio element. Device IDs never enter history, diagnostics,
// signaling or storage. No additional microphone capture or automatic routing.
export class CallAudioOutput {
  private disposed = false;
  private busy = false;
  private devices = new Map<string, OutputDevice>();
  constructor(private readonly ports: OutputPorts) {}
  supported(): boolean { return typeof this.ports.sink === 'function'; }
  canChoose(): boolean { return this.supported() && typeof this.ports.choose === 'function'; }
  private active(): boolean { return !this.disposed && this.ports.active(); }
  async list(): Promise<OutputDevice[]> {
    if (!this.active() || !this.supported() || !this.ports.enumerate) return [];
    try {
      const values = await this.ports.enumerate();
      if (!this.active()) return [];
      this.devices.clear();
      for (const value of values.slice(0, 64)) {
        if (value.kind !== 'audiooutput' || !value.deviceId || value.deviceId === 'default' || this.devices.has(value.deviceId)) continue;
        this.devices.set(value.deviceId, { ...value, label: value.label.trim().slice(0, 160) || `Аудиовыход ${this.devices.size + 1}` });
      }
      return [...this.devices.values()];
    } catch { return []; }
  }
  async select(id?: string): Promise<OutputResult | null> {
    if (!this.active() || this.busy) return null;
    if (!this.supported()) return { ok: false, message: outputUnavailable };
    this.busy = true;
    try {
      let value: OutputDevice;
      if (id === '') value = { kind: 'audiooutput', deviceId: '', label: systemOutput };
      else if (id !== undefined) {
        const device = this.devices.get(id);
        if (!device) return { ok: false, message: 'Аудиоустройство недоступно. Обновите список выходов.' };
        value = device;
      } else {
        if (!this.ports.choose) return { ok: false, message: outputUnavailable };
        // Invoke synchronously from the button gesture, before any awaits.
        value = await this.ports.choose();
        if (value.kind !== 'audiooutput' || !value.deviceId) throw new Error('invalid_output');
      }
      if (!this.active()) return null;
      await this.ports.sink!(value.deviceId);
      if (!this.active()) return null;
      return { ok: true, label: value.label.trim().slice(0, 160) || 'Выбранный аудиовыход' };
    } catch (error) { return this.active() ? failure(error) : null; }
    finally { this.busy = false; }
  }
  dispose(): void { this.disposed = true; this.devices.clear(); }
}
