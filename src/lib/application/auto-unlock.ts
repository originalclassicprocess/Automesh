// Debounce expensive PBKDF2 attempts; only one attempt runs at a time.
// No password verifier/hash is cached. An edit invalidates a late result.
export class AutoUnlock {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  private running = false;
  constructor(private readonly attempt: (password: string, current: () => boolean) => Promise<void>) {}
  cancel(): void { clearTimeout(this.timer); this.timer = undefined; this.revision++; }
  schedule(password: string): void {
    this.cancel();
    if (!password) return;
    const revision = this.revision;
    const run = async () => {
      if (revision !== this.revision) return;
      if (this.running) { this.timer = setTimeout(() => void run(), 200); return; }
      this.timer = undefined;
      this.running = true;
      try { await this.attempt(password, () => revision === this.revision); }
      finally { this.running = false; }
    };
    this.timer = setTimeout(() => void run(), 700);
  }
}
