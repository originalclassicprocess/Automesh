import type { TransportMessage } from './transport';
import { encodeMessage, decodeMessage } from '../message/transport-codec';
import { base64, unbase64 } from '../node/offline-crypto';
import { INTRODUCTION_MAX_BYTES } from '../../../nodes/packages/protocol/src/introduction.js';

export type IntroductionWire = { peer: string; route: string; kind: 'open' | 'frame' | 'unavailable'; frame?: string };
export interface IntroductionPort {
  route(peer: string): Promise<string>;
  send(peer: string, route: string, frame?: string): void;
  listen(handler: (event: IntroductionWire) => void): () => void;
  closed(handler: (route: string) => void): () => void;
}

// Shares authenticated signaling sockets, never their WebRTC peer state.
export class IntroductionRelay {
  private routes = new Map<string, string>();
  private pending = new Map<string, Promise<void>>();
  private removers: Array<() => void>;
  private stopped = false;
  private messages: Array<(message: TransportMessage) => void> = [];
  private peers: Array<(peer: string, joined: boolean) => void> = [];
  private opens: Array<(peer: string) => void> = [];
  constructor(private port: IntroductionPort, private self: string, private allowed: (peer: string) => boolean) {
    this.removers = [port.listen(event => {
      if (this.stopped || !this.allowed(event.peer) || event.peer === this.self) return;
      let route = this.routes.get(event.peer);
      if (event.kind === 'unavailable') { if (route === event.route) this.release(event.peer); return; }
      // Keep a live session pinned. A late frame from another listener cannot replace it.
      if (route && route !== event.route) {
        // Simultaneous opens on different shared signalings converge on the
        // lower Account ID's route; delayed DATA never replaces a session.
        if (event.kind !== 'open' || this.self < event.peer) return;
        this.release(event.peer); route = undefined;
      }
      let message: TransportMessage | undefined;
      if (event.kind === 'frame') {
        try {
          if (typeof event.frame !== 'string' || event.frame.length > INTRODUCTION_MAX_BYTES * 4 / 3) return;
          const bytes = unbase64(event.frame!);
          if (bytes.length > INTRODUCTION_MAX_BYTES) return;
          message = decodeMessage(bytes);
          if (message.from !== event.peer || message.to !== self) return;
        } catch { return; }
      }
      if (!route) {
        if (this.routes.size >= 32) return;
        this.activate(event.peer, event.route);
        if (event.kind === 'open') {
          try { this.port.send(event.peer, event.route); } catch { this.release(event.peer); }
        }
      } else if (event.kind === 'open') for (const cb of this.opens) cb(event.peer);
      if (message && this.routes.get(event.peer) === event.route) for (const cb of this.messages) cb(message);
    }), port.closed(route => {
      for (const [peer, current] of this.routes) if (current === route) this.release(peer);
    })];
  }
  onMessage(cb: (message: TransportMessage) => void) { this.messages.push(cb); }
  onPeer(cb: (peer: string, joined: boolean) => void) { this.peers.push(cb); }
  onOpen(cb: (peer: string) => void) { this.opens.push(cb); }
  has(peer: string) { return this.routes.has(peer); }
  async connect(peer: string): Promise<void> {
    if (this.stopped || !this.allowed(peer)) throw Error('introduction_forbidden');
    if (this.routes.has(peer)) return;
    const pending = this.pending.get(peer); if (pending) return pending;
    if (this.routes.size + this.pending.size >= 32) throw Error('introduction_limit');
    const work = (async () => {
      const route = await this.port.route(peer);
      if (this.stopped || !this.allowed(peer)) throw Error('introduction_forbidden');
      if (this.routes.has(peer)) return;
      this.activate(peer, route);
      try { this.port.send(peer, route); } catch (e) { this.release(peer); throw e; }
    })().finally(() => { if (this.pending.get(peer) === work) this.pending.delete(peer); });
    this.pending.set(peer, work); return work;
  }
  private activate(peer: string, route: string) {
    this.routes.set(peer, route); for (const cb of this.peers) cb(peer, true);
  }
  async send(message: TransportMessage) {
    const route = this.routes.get(message.to);
    if (this.stopped || !route || !this.allowed(message.to)) throw Error('introduction_unavailable');
    const bytes = new Uint8Array(encodeMessage(message));
    if (bytes.length > INTRODUCTION_MAX_BYTES) throw Error('introduction_too_large');
    this.port.send(message.to, route, base64(bytes));
  }
  release(peer: string) {
    if (this.routes.delete(peer)) for (const cb of this.peers) cb(peer, false);
  }
  close() {
    this.stopped = true; this.removers.forEach(remove => remove());
    for (const peer of [...this.routes.keys()]) this.release(peer);
  }
}
