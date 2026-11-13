import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxController, type TextSender } from './outbox';
import { deliveryAttempt } from './delivery-issues';
import { emptySessionChats, recordSentMessage, setContactState, setDeliveryStatus, updateConversation } from '$lib/chat/session-chats';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
function fixture(options: {authorize?(peer:string):Promise<void>;issue?(peer:string,id:string,code:import('./delivery-issues').DeliveryIssue|undefined,error?:unknown):void} = {}) {
  vi.useFakeTimers();
  let state = recordSentMessage(emptySessionChats(), 'peer', {
    id: 'message', from: 'me', text: 'hello', timestamp: 1, direction: 'outgoing', delivery: 'queued',
  });
  state = setContactState(state, 'peer', 'accepted');
  state = updateConversation(state, 'peer', value => ({ ...value, connection: 'connected' }));
  let sender: TextSender = { send: vi.fn(async () => {}) };
  const persist = vi.fn();
  const outbox = new OutboxController({ state: () => state, setState: value => { state = value; }, sender: () => sender, persist, ...options });
  return { outbox, persist, get state() { return state; }, set state(value) { state = value; },
    get sender() { return sender; }, set sender(value) { sender = value; } };
}
describe('outbox independent of UI and transport implementation', () => {
  it('never replays imported history on reconnect, even when its old status is queued', async () => {
    const f = fixture(); f.state.byPeer.peer.messages[0].importedFromDevice = true;
    await f.outbox.reconnect('peer', f.sender); await vi.advanceTimersByTimeAsync(120000);
    expect(f.sender.send).not.toHaveBeenCalled(); f.outbox.reset();
  });
  it('does not send cancellation requests or terminal node outcomes through direct retry', async()=>{
    for(const nodeQueue of ['canceling','canceled','expired'] as const){
      const f=fixture();f.state.byPeer.peer.messages[0].nodeQueue=nodeQueue;
      await f.outbox.flush('peer',f.sender);await vi.advanceTimersByTimeAsync(120000);
      expect(f.sender.send).not.toHaveBeenCalled();f.outbox.reset();
    }
  });
  it('gives each message its own retry deadline without replaying the queue on every flush', async () => {
    const f = fixture();
    await f.outbox.flush('peer', f.sender);
    await vi.advanceTimersByTimeAsync(1000);
    f.state = recordSentMessage(f.state, 'peer', { id: 'second', from: 'me', text: 'second', timestamp: 2,
      direction: 'outgoing', delivery: 'queued' });
    await f.outbox.flush('peer', f.sender);
    await f.outbox.flush('peer', f.sender);
    expect(f.sender.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(11000);
    expect(f.sender.send).toHaveBeenCalledTimes(3);
    expect(f.sender.send).toHaveBeenLastCalledWith('hello', 'peer', 'message');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.sender.send).toHaveBeenCalledTimes(4);
    expect(f.sender.send).toHaveBeenLastCalledWith('second', 'peer', 'second');
    // The next attempt is 24 seconds after EACH previous attempt.
    await vi.advanceTimersByTimeAsync(22999);
    expect(f.sender.send).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.sender.send).toHaveBeenCalledTimes(5);
    f.outbox.reset();
  });
  it('does not turn simultaneous missing receipts into a full-queue retry for each message', async () => {
    const f = fixture();
    for (let i = 0; i < 9; i++) f.state = recordSentMessage(f.state, 'peer', {
      id: `batch-${i}`, from: 'me', text: `${i}`, timestamp: i + 2, direction: 'outgoing', delivery: 'queued',
    });
    await f.outbox.flush('peer', f.sender);
    await vi.advanceTimersByTimeAsync(12000);
    expect(f.sender.send).toHaveBeenCalledTimes(20);
    expect(vi.getTimerCount()).toBe(10);
    f.outbox.reset();
  });
  it('keeps a confirmed message clear of a late transport failure', async () => {
    const issue = vi.fn(), f = fixture({ issue });
    f.sender.send = vi.fn(async () => {
      f.state = setDeliveryStatus(f.state, 'peer', 'message', 'delivered');
      f.outbox.acknowledge('peer', 'message');
      throw new Error('channel_closed');
    });
    await f.outbox.flush('peer', f.sender);
    expect(f.state.byPeer.peer.messages[0].delivery).toBe('delivered');
    expect(issue).not.toHaveBeenCalledWith('peer', 'message', 'direct_unavailable', expect.anything());
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rechecks whether a message still belongs to primary delivery after awaiting authorization', async () => {
    const f = fixture({ authorize: async () => {
      f.state = updateConversation(f.state, 'peer', c => ({ ...c, messages: c.messages.map(m => ({ ...m, deviceMessage: true })) }));
    } });
    await f.outbox.flush('peer', f.sender);
    expect(f.sender.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retries immediately on a fresh connection without waiting for the previous backoff', async () => {
    const f = fixture();
    await f.outbox.flush('peer', f.sender);
    await vi.advanceTimersByTimeAsync(12000);
    expect(f.sender.send).toHaveBeenCalledTimes(2);
    f.state = updateConversation(f.state, 'peer', c => ({ ...c, connection: 'offline' }));
    f.state = updateConversation(f.state, 'peer', c => ({ ...c, connection: 'connected' }));
    await f.outbox.reconnect('peer', f.sender);
    expect(f.sender.send).toHaveBeenCalledTimes(3);
    f.outbox.reset();
  });
  it('drains a retry that becomes due while a different send is still running', async () => {
    const f = fixture();
    await f.outbox.flush('peer', f.sender);
    f.state = recordSentMessage(f.state, 'peer', { id: 'slow', from: 'me', text: 'slow', timestamp: 2,
      direction: 'outgoing', delivery: 'queued' });
    let release!: () => void;
    f.sender.send = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockResolvedValue(undefined);
    const sending = f.outbox.flush('peer', f.sender);
    await vi.advanceTimersByTimeAsync(12000);
    expect(f.sender.send).toHaveBeenCalledTimes(1);
    release(); await sending; await Promise.resolve();
    expect(f.sender.send).toHaveBeenCalledTimes(2);
    expect(f.sender.send).toHaveBeenLastCalledWith('hello', 'peer', 'message');
    f.outbox.reset();
  });
  it('does not lose a reconnect notification while the old channel is finishing a failed send', async () => {
    const f = fixture(); let reject!: (error: Error) => void;
    f.sender.send = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }))
      .mockResolvedValue(undefined);
    const old = f.outbox.flush('peer', f.sender);
    await f.outbox.reconnect('peer', f.sender);
    reject(new Error('channel_closed')); await old; await Promise.resolve();
    expect(f.sender.send).toHaveBeenCalledTimes(2);
    f.outbox.reset();
  });
  it('does not revoke courier fallback when a direct retry immediately follows the missing receipt',async()=>{
    const f=fixture({issue:(peer,id,code,error)=>{f.state=updateConversation(f.state,peer,c=>({...c,messages:c.messages.map(m=>m.id===id?{...m,...deliveryAttempt(m,code,error)}:m)}));}});
    await f.outbox.flush('peer',f.sender);await vi.advanceTimersByTimeAsync(12000);
    expect(f.sender.send).toHaveBeenCalledTimes(2);
    expect(f.state.byPeer.peer.messages[0].directFallback).toBe(true);
    expect(f.state.byPeer.peer.messages[0].delivery).toBe('sent');f.outbox.reset();
  });
  it('never sends until the initial durable save is complete, or replays imported history',async()=>{
    const f=fixture(); f.state=setDeliveryStatus(f.state,'peer','message','saving');
    await f.outbox.flush('peer',f.sender);expect(f.sender.send).not.toHaveBeenCalled();
    f.state=setDeliveryStatus(f.state,'peer','message','queued');await f.outbox.flush('peer',f.sender);
    expect(f.sender.send).toHaveBeenCalledTimes(1);f.outbox.reset();
    f.state=updateConversation(f.state,'peer',c=>({...c,messages:c.messages.map(m=>({...m,delivery:'queued',restoredFromBackup:true}))}));
    await f.outbox.flush('peer',f.sender);expect(f.sender.send).toHaveBeenCalledTimes(1);
  });
  it('holds a known disabled primary without losing the saved job or exposing raw errors',async()=>{
    const issue=vi.fn(),f=fixture({authorize:async()=>{throw new Error('primary_disabled');},issue});
    await f.outbox.flush('peer',f.sender);expect(f.sender.send).not.toHaveBeenCalled();
    expect(f.state.byPeer.peer.messages[0].delivery).toBe('queued');
    expect(issue).toHaveBeenLastCalledWith('peer','message','primary_disabled',expect.objectContaining({message:'primary_disabled'}));
    await vi.advanceTimersByTimeAsync(12000);
    expect(issue).not.toHaveBeenCalledWith('peer','message','direct_receipt_timeout');f.outbox.reset();
  });
  it('signals a fallback after a lost direct receipt and preserves a real node-storage confirmation',async()=>{
    const issue=vi.fn(),f=fixture({issue});await f.outbox.flush('peer',f.sender);
    f.state=setDeliveryStatus(f.state,'peer','message','stored');await vi.advanceTimersByTimeAsync(12000);
    expect(issue).toHaveBeenCalledWith('peer','message','direct_receipt_timeout');
    expect(f.state.byPeer.peer.messages[0].delivery).toBe('stored');
    expect(f.sender.send).toHaveBeenLastCalledWith('hello','peer','message');f.outbox.reset();
  });
  it('does not send a late authorization result after lock or a receipt',async()=>{
    let release!:()=>void;const f=fixture({authorize:()=>new Promise<void>(resolve=>release=resolve)});
    const attempt=f.outbox.flush('peer',f.sender);f.outbox.reset();release();await attempt;expect(f.sender.send).not.toHaveBeenCalled();
    const again=f.outbox.flush('peer',f.sender);f.state=setDeliveryStatus(f.state,'peer','message','delivered');release();await again;
    expect(f.sender.send).not.toHaveBeenCalled();f.outbox.reset();
  });
  it('never sends file placeholders as text or schedules text retries for them', async () => {
    const f = fixture();
    f.state = recordSentMessage(f.state, 'peer', { id: 'file', from: 'me', text: '', timestamp: 2,
      direction: 'outgoing', delivery: 'stored', fileStatus: 'queued',
      file: { id: 'file', name: 'image.gif', size: 12, mime: 'image/gif', sha256: '0'.repeat(64) } });
    await f.outbox.flush('peer', f.sender);
    expect(f.sender.send).toHaveBeenCalledTimes(1);
    expect(f.sender.send).toHaveBeenCalledWith('hello', 'peer', 'message');
    expect(f.state.byPeer.peer.messages[1].delivery).toBe('stored');
    f.state = setDeliveryStatus(f.state, 'peer', 'message', 'delivered'); f.outbox.acknowledge('peer', 'message');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.sender.send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    f.outbox.reset();
  });
  it('preserves rich message details on initial send and offline retry', async () => {
    const f = fixture(); const details = { allowForwardAttribution: false };
    f.state = updateConversation(f.state, 'peer', current => ({ ...current, messages: current.messages.map(message => ({ ...message, details })) }));
    await f.outbox.flush('peer', f.sender);
    expect(f.sender.send).toHaveBeenLastCalledWith('hello', 'peer', 'message', details);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.sender.send).toHaveBeenLastCalledWith('hello', 'peer', 'message', details);
    f.outbox.reset();
  });
  it('serializes sends and retries the same message ID until a receipt arrives', async () => {
    const f = fixture();
    await Promise.all([f.outbox.flush('peer', f.sender), f.outbox.flush('peer', f.sender)]);
    expect(f.sender.send).toHaveBeenCalledTimes(1);
    expect(f.state.byPeer.peer.messages[0].delivery).toBe('sent');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.sender.send).toHaveBeenCalledTimes(2);
    expect(f.sender.send).toHaveBeenLastCalledWith('hello', 'peer', 'message');
    f.state = setDeliveryStatus(f.state, 'peer', 'message', 'delivered'); f.outbox.acknowledge('peer', 'message');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.sender.send).toHaveBeenCalledTimes(2);
  });
  it('retries queued messages after a temporary send failure', async () => {
    const f = fixture(); f.sender.send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    await f.outbox.flush('peer', f.sender);
    expect(f.state.byPeer.peer.messages[0].delivery).toBe('queued');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.state.byPeer.peer.messages[0].delivery).toBe('sent');
  });
  it('does not overwrite a receipt that arrives during sending', async () => {
    const f = fixture();
    f.sender.send = vi.fn(async () => { f.state = setDeliveryStatus(f.state, 'peer', 'message', 'read'); });
    await f.outbox.flush('peer', f.sender);
    expect(f.state.byPeer.peer.messages[0].delivery).toBe('read');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops retrying when blocked, offline or reset', async () => {
    const f = fixture(); await f.outbox.flush('peer', f.sender);
    f.state = setContactState(f.state, 'peer', 'blocked');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.sender.send).toHaveBeenCalledTimes(1);
    f.outbox.reset(); expect(vi.getTimerCount()).toBe(0);
    f.state = setContactState(f.state, 'peer', 'accepted');
    f.state = updateConversation(f.state, 'peer', value => ({ ...value, connection: 'offline' }));
    await f.outbox.flush('peer', f.sender); expect(f.sender.send).toHaveBeenCalledTimes(1);
  });
  it('ignores completion of a previous session even if it uses the same peer', async () => {
    const f = fixture(); let release!: () => void;
    f.sender.send = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const old = f.outbox.flush('peer', f.sender);
    f.outbox.reset(); f.state = setDeliveryStatus(f.state, 'peer', 'message', 'queued');
    f.sender = { send: vi.fn(async () => {}) }; await f.outbox.flush('peer', f.sender);
    const timerCount = vi.getTimerCount(); release(); await old;
    expect(f.state.byPeer.peer.messages[0].delivery).toBe('sent');
    expect(vi.getTimerCount()).toBe(timerCount);
    f.outbox.reset();
  });
});
