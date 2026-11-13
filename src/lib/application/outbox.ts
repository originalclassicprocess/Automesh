import { setDeliveryStatus, type ChatEntry, type SessionChats } from '$lib/chat/session-chats';
import type { MessageDetails } from '$lib/chat/message-details';
import { deliveryIssueForError, type DeliveryIssue } from './delivery-issues';
import { localOutgoing, pendingText } from './delivery-work';

export interface TextSender { send(text: string, peer: string, messageId: string, details?: MessageDetails): Promise<void> }
type OutboxPort<T> = {
  state(): SessionChats;
  setState(state: SessionChats): void;
  sender(): T | null;
  persist(): unknown;
  authorize?(peer: string): Promise<void>;
  issue?(peer: string, id: string, issue: DeliveryIssue | undefined, error?: unknown): void;
};

// Application-level retry policy. No browser/UI/concrete transport dependency.
export class OutboxController<T extends TextSender> {
  private epoch = 0;
  private flushing = new Map<string, T>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private attempts = new Map<string, number>();
  private reconnecting = new Set<string>();
  constructor(private readonly port: OutboxPort<T>) {}
  private key(peer: string, id: string) { return `${peer}:${id}`; }
  private pending(message: ChatEntry | undefined): message is ChatEntry {
    return pendingText(message);
  }
  private ready(peer: string, message: ChatEntry | undefined): message is ChatEntry {
    return this.pending(message) && !this.timers.has(this.key(peer, message.id));
  }
  private current(peer: string, sender: T, epoch: number) {
    const conversation = this.port.state().byPeer[peer];
    return this.epoch === epoch && this.port.sender() === sender && conversation?.connection === 'connected' &&
      conversation.contact !== 'blocked' && conversation.contact !== 'pending';
  }
  acknowledge(peer: string, id: string): void {
    const key = this.key(peer, id);
    clearTimeout(this.timers.get(key)); this.timers.delete(key); this.attempts.delete(key);
  }
  reset(): void {
    this.epoch++;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.attempts.clear(); this.flushing.clear(); this.reconnecting.clear();
  }
  // A newly authenticated channel need not wait for the failed channel's backoff.
  // Normal flushes (new messages, consent, UI wakeups) retain each message's timer.
  reconnect(peer: string, sender: T): Promise<void> {
    if (!this.current(peer, sender, this.epoch)) return Promise.resolve();
    if (this.flushing.has(peer)) { this.reconnecting.add(peer); return Promise.resolve(); }
    for (const key of this.attempts.keys()) if (key.startsWith(`${peer}:`)) {
      clearTimeout(this.timers.get(key)); this.timers.delete(key); this.attempts.delete(key);
    }
    return this.flush(peer, sender);
  }
  private retry(peer: string, id: string, sender: T, epoch: number): void {
    const key = this.key(peer, id); clearTimeout(this.timers.get(key));
    const attempts = (this.attempts.get(key) ?? 0) + 1; this.attempts.set(key, attempts);
    const delay = Math.min(12_000 * 2 ** Math.min(attempts - 1, 4), 120_000);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      if (!this.current(peer, sender, epoch)) return;
      const latest = this.port.state().byPeer[peer].messages.find(m => m.id === id);
      if (this.pending(latest)) {
        if (latest?.delivery === 'sent' || latest?.delivery === 'stored') { this.port.issue?.(peer,id,'direct_receipt_timeout'); this.persist(); }
        // If another send is running, its finally block drains newly due work.
        // Do not advance backoff merely because a different message is in flight.
        void this.flush(peer, sender);
      } else this.acknowledge(peer, id);
    }, delay));
  }
  private delivery(peer: string, id: string, value: 'sending' | 'sent' | 'queued'): void {
    if (this.port.state().byPeer[peer]?.messages.find(m => m.id === id)?.delivery === 'stored') return;
    this.port.setState(setDeliveryStatus(this.port.state(), peer, id, value));
  }
  private persist(): void { void Promise.resolve(this.port.persist()).catch(() => {}); }
  async flush(peer: string, sender: T): Promise<void> {
    const epoch = this.epoch;
    if (this.flushing.has(peer) || !this.current(peer, sender, epoch)) return;
    this.flushing.set(peer, sender);
    let failed = false;
    try {
      const pending = this.port.state().byPeer[peer].messages.filter(message => this.ready(peer, message));
      for (const message of pending) {
        if (!this.current(peer, sender, epoch)) break;
        const current = this.port.state().byPeer[peer].messages.find(entry => entry.id === message.id);
        if (!this.ready(peer, current)) continue;
        try {
          if (this.port.authorize) await this.port.authorize(peer);
          if (!this.current(peer,sender,epoch)) return;
          const ready = this.port.state().byPeer[peer].messages.find(m => m.id === message.id);
          if (!this.ready(peer, ready)) continue;
          this.port.issue?.(peer,message.id,undefined);
          this.delivery(peer, message.id, 'sending');
          if (ready.details) await sender.send(ready.text, peer, ready.id, ready.details);
          else await sender.send(ready.text, peer, ready.id);
          if (this.epoch !== epoch || this.port.sender() !== sender) return;
          const latest = this.port.state().byPeer[peer]?.messages.find(entry => entry.id === message.id);
          if (!localOutgoing(latest) || latest.delivery === 'delivered' || latest.delivery === 'read' || latest.file) {
            this.acknowledge(peer, message.id); continue;
          }
          this.delivery(peer, message.id, 'sent'); this.persist();
          this.retry(peer, message.id, sender, epoch);
        } catch (error) {
          if (this.epoch !== epoch || this.port.sender() !== sender) return;
          const latest = this.port.state().byPeer[peer]?.messages.find(entry => entry.id === message.id);
          // A receipt can arrive on another route while send() is still pending.
          // Its confirmed result wins over a late rejection from the old channel.
          if (!localOutgoing(latest) || latest.delivery === 'delivered' || latest.delivery === 'read' || latest.file) {
            this.acknowledge(peer, message.id); continue;
          }
          this.delivery(peer, message.id, 'queued');
          this.port.issue?.(peer,message.id,deliveryIssueForError(error,'direct_unavailable'),error); this.persist();
          if (this.current(peer, sender, epoch)) this.retry(peer, message.id, sender, epoch);
          failed = true; break;
        }
      }
    } finally {
      if (this.epoch === epoch && this.flushing.get(peer) === sender) {
        this.flushing.delete(peer);
        const reconnect = this.reconnecting.delete(peer);
        if (reconnect && this.current(peer, sender, epoch)) {
          void this.reconnect(peer, sender);
        } else if (!failed && this.current(peer, sender, epoch) && this.port.state().byPeer[peer].messages.some(message =>
            this.ready(peer, message))) {
          queueMicrotask(() => { void this.flush(peer, sender); });
        }
      }
    }
  }
}
