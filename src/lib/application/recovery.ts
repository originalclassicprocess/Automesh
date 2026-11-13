type Work = () => unknown | Promise<unknown>;
type Lane = {
  next?: Work;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  done: Promise<void>;
  finish(): void;
};

// Foreground/network events are hints, not requests to rebuild the account.
// Coalesce bursts, retain one trailing hint, and keep transports independent.
export class RecoveryController {
  private lanes = new Map<string, Lane>();
  constructor(private readonly delay = 200) {}

  request(name: string, work: Work): Promise<void> {
    let lane = this.lanes.get(name);
    if (!lane) {
      let finish!: () => void;
      const done = new Promise<void>(resolve => { finish = resolve; });
      lane = { running: false, done, finish };
      this.lanes.set(name, lane);
    }
    lane.next = work;
    if (!lane.running && !lane.timer) this.schedule(name, lane);
    return lane.done;
  }

  private schedule(name: string, lane: Lane): void {
    lane.timer = setTimeout(() => { lane.timer = undefined; void this.run(name, lane); }, this.delay);
  }

  private async run(name: string, lane: Lane): Promise<void> {
    if (this.lanes.get(name) !== lane) return;
    const work = lane.next; lane.next = undefined; lane.running = true;
    try { await work?.(); }
    catch { /* Each lane owns its status; a failed listener cannot gate queues. */ }
    finally {
      lane.running = false;
      if (this.lanes.get(name) === lane) {
        if (lane.next) this.schedule(name, lane);
        else { this.lanes.delete(name); lane.finish(); }
      }
    }
  }

  // Active operations retain their own session guards/abort signals. Their late
  // completions cannot remove or delay work belonging to a new unlocked session.
  reset(): void {
    for (const lane of this.lanes.values()) { clearTimeout(lane.timer); lane.finish(); }
    this.lanes.clear();
  }
}
