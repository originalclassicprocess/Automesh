// Serialize durable snapshots so slower writes cannot overwrite newer state.
// A failed write is reported to its caller, but does not poison the next write.
export class SerializedWrites {
  private tail: Promise<unknown> = Promise.resolve();
  enqueue<T>(write: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => {}).then(write);
    this.tail = result.catch(() => {});
    return result;
  }
  async settled(): Promise<void> { await this.tail; }
}
