import { microphoneNotice, type AppNotice } from '$lib/application/notices';
export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 300;
const formats = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/ogg'];
export function recordingFormat(supported: (mime: string) => boolean): string { return formats.find(supported) ?? ''; }
export function audioExtension(mime: string): string { return ({ 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg' } as Record<string,string>)[mime.split(';')[0].trim()] ?? ''; }
export type VoiceState = { phase: 'idle' | 'requesting' | 'recording' | 'stopping' | 'review' | 'sending'; seconds: number; level: number; notice: AppNotice | null; blob: Blob | null };
export type VoiceMeter = { sample(): number; close(): void };
export type RecordingPort = { getStream(): Promise<MediaStream>; supported(mime:string): boolean; recorder(stream:MediaStream,mime:string): MediaRecorder; meter?(stream: MediaStream): VoiceMeter | undefined };

// Temporary audio only; confirmation queues the file, never implies delivery.
export class VoiceRecorder {
  private stream?: MediaStream; private recorder?: MediaRecorder; private meter?: VoiceMeter;
  private chunks: Blob[] = []; private bytes = 0; private generation = 0; private reviewRequested = false;
  private disposed = false; private started = 0; private timer?: ReturnType<typeof setInterval>; private stopTimer?: ReturnType<typeof setTimeout>;
  state: VoiceState = { phase:'idle', seconds:0, level:0, notice:null, blob:null };
  constructor(private port:RecordingPort, private changed:(state:VoiceState)=>void, private clip:(blob:Blob,extension:string)=>Promise<boolean>) {}
  private set(patch:Partial<VoiceState>) { this.state = {...this.state,...patch}; if (!this.disposed) this.changed(this.state); }
  private release() {
    clearInterval(this.timer); this.timer = undefined;
    clearTimeout(this.stopTimer); this.stopTimer = undefined;
    try { this.meter?.close(); } catch { /* optional meter cannot block microphone release */ } this.meter = undefined;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = undefined;
  }
  private fail(message:string) { this.cancel(); this.set({ notice:{message,durationMs:0,kind:'error'} }); }
  clearNotice() { this.set({ notice:null }); }
  async start(): Promise<void> {
    if (this.disposed || this.state.phase !== 'idle') return;
    const generation = ++this.generation; this.set({ phase:'requesting',seconds:0,level:0,notice:null,blob:null });
    try {
      const mime = recordingFormat(value => this.port.supported(value)); if (!mime) throw new Error('recording_unsupported');
      const stream = await this.port.getStream();
      if (this.disposed || generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const recorder = this.port.recorder(stream,mime); this.recorder = recorder;
      this.chunks = []; this.bytes = 0; this.reviewRequested = false;
      recorder.ondataavailable = event => {
        if (generation !== this.generation || !event.data.size) return;
        this.bytes += event.data.size;
        if (this.bytes > MAX_VOICE_BYTES) { this.fail('Запись слишком большая. Сообщение не отправлено.'); return; }
        this.chunks.push(event.data);
      };
      recorder.onerror = () => { if (generation === this.generation) this.fail('Запись прервалась. Сообщение не отправлено.'); };
      recorder.onstop = () => {
        if (generation !== this.generation || this.disposed) return;
        const blob = new Blob(this.chunks,{type:recorder.mimeType || mime}), requested = this.reviewRequested;
        this.chunks = []; this.release(); this.recorder = undefined; this.generation++;
        recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
        if (!requested) { this.fail('Запись прервалась. Сообщение не отправлено.'); return; }
        if (!audioExtension(blob.type)) { this.fail('Формат записи не поддерживается. Сообщение не отправлено.'); return; }
        if (!blob.size) { this.fail('Запись пустая. Попробуйте ещё раз.'); return; }
        this.set({ phase:'review',blob,level:0,notice:null });
      };
      for (const track of stream.getTracks()) track.onended = () => { if (generation === this.generation && this.state.phase === 'recording') this.fail('Микрофон отключился. Сообщение не отправлено.'); };
      recorder.start(1000); this.started = Date.now();
      try { this.meter = this.port.meter?.(stream); } catch { /* optional level indicator */ }
      this.set({phase:'recording'});
      this.timer = setInterval(() => {
        let level = 0; try { level = this.meter?.sample() ?? 0; } catch { /* recording still works */ }
        const seconds = Math.min(MAX_VOICE_SECONDS,Math.floor((Date.now()-this.started)/1000));
        this.set({seconds,level:Number.isFinite(level) ? Math.max(0,Math.min(1,level)) : 0});
        if (seconds >= MAX_VOICE_SECONDS) this.stopForReview();
      },250);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.cancel(); this.set({notice:microphoneNotice(error)});
    }
  }
  stopForReview() {
    if (this.state.phase !== 'recording' || !this.recorder) return;
    this.reviewRequested = true; clearInterval(this.timer); this.set({phase:'stopping',level:0});
    try {
      const generation = this.generation;
      this.recorder.stop(); this.release();
      if (this.generation === generation) this.stopTimer = setTimeout(() => { if (this.generation === generation) this.fail('Не удалось завершить запись. Сообщение не отправлено.'); },10000);
    } catch { this.fail('Не удалось завершить запись. Сообщение не отправлено.'); }
  }
  async sendPreview(): Promise<boolean> {
    const blob = this.state.blob;
    if (this.disposed || this.state.phase !== 'review' || !blob) return false;
    const generation = this.generation; this.set({phase:'sending',notice:null});
    let accepted = false; try { accepted = await this.clip(blob,audioExtension(blob.type)); } catch { /* keep preview for retry */ }
    if (this.disposed || generation !== this.generation) return false;
    if (accepted) { this.cancel(); return true; }
    this.set({phase:'review',notice:{message:'Не удалось добавить запись в очередь. Можно повторить отправку.',durationMs:0,kind:'error'}});
    return false;
  }
  interrupt() { if (this.state.phase === 'recording' || this.state.phase === 'stopping') this.fail('Запись прервалась. Сообщение не отправлено.'); else if (this.state.phase === 'requesting') this.cancel(); }
  cancel() {
    this.generation++; this.reviewRequested = false;
    if (this.recorder) { this.recorder.ondataavailable = null; this.recorder.onstop = null; this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') { try { this.recorder.stop(); } catch { /* release tracks regardless */ } } }
    this.recorder = undefined; this.chunks = []; this.bytes = 0; this.release();
    this.set({phase:'idle',seconds:0,level:0,blob:null,notice:null});
  }
  dispose() { this.disposed = true; this.cancel(); }
}
