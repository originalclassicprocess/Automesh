// Reserve a receive slot BEFORE any cache/storage/network await. Keep ownership
// through hashing and durable commit; an old callback cannot release a new job.
export type FileReceiveLease<T> = { key: string; owner: T; phase: 'preparing' | 'receiving' | 'committing'; touched: number };
export class FileReceiveSlots<T> {
  private readonly jobs = new Map<string, FileReceiveLease<T>>();
  constructor(private readonly limit = 2) {}
  get size() { return this.jobs.size; }
  has(key: string) { return this.jobs.has(key); }
  keys(): ReadonlySet<string> { return new Set(this.jobs.keys()); }
  get(key: string) { return this.jobs.get(key); }
  reserve(key: string, owner: T, external = 0, now = Date.now()): FileReceiveLease<T> | undefined {
    if (this.jobs.has(key) || this.jobs.size + external >= this.limit) return;
    const lease: FileReceiveLease<T> = { key, owner, phase: 'preparing', touched: now };
    this.jobs.set(key, lease); return lease;
  }
  current(lease: FileReceiveLease<T>): boolean { return this.jobs.get(lease.key) === lease; }
  release(lease: FileReceiveLease<T>): void { if (this.current(lease)) this.jobs.delete(lease.key); }
  cancel(key: string): void { this.jobs.delete(key); }
  clear(): void { this.jobs.clear(); }
  stalled(owner: T, now = Date.now(), delay = 30_000): FileReceiveLease<T>[] {
    return [...this.jobs.values()].filter(job => job.owner === owner && job.phase === 'receiving' && now - job.touched >= delay);
  }
}
