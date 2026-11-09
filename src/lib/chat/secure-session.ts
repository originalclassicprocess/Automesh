// Online-only, authenticated ephemeral ECDH channel. The caller MUST verify the
// identity signature and Account ID on every frame before passing it here.
// This is an application protocol prototype, not an audited Signal implementation.

const encoder = new TextEncoder();
const MAGIC = new Uint8Array([0x4d, 0x41, 0x45, 0x01]); // MAE, version 1
const HELLO = 1;
const WELCOME = 2;
const CONFIRM = 3;
const ACK = 4;
const DATA = 5;
const SESSION_ID_LENGTH = 16;
const PUBLIC_KEY_LENGTH = 65; // uncompressed P-256
const TAG_LENGTH = 16;
const HANDSHAKE_TIMEOUT_MS = 12_000;
// Last encodable DATA counter, inclusive. Reject the following value BEFORE
// AES-GCM: BigInt does not wrap, but DataView.setBigUint64 truncates modulo 2^64.
const MAX_SEQUENCE = (1n << 64n) - 1n;

type Phase = 'hello-sent' | 'welcome-sent' | 'confirm-sent' | 'ready';

interface Session {
  phase: Phase;
  id: Uint8Array;
  localPair?: CryptoKeyPair;
  hello: Uint8Array;
  welcome?: Uint8Array;
  sendKey?: CryptoKey;
  receiveKey?: CryptoKey;
  sendSequence: bigint;
  receiveSequence: bigint;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SessionWaiter {
  promise: Promise<Session>;
  resolve: (session: Session) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SecureSessions {
  private sessions = new Map<string, Session>();
  private starts = new Map<string, Promise<void>>();
  private responding = new Set<string>();
  private generations = new Map<string, number>();
  private waiters = new Map<string, SessionWaiter>();
  private closed = false;

  constructor(
    private readonly self: string,
    private readonly sendFrame: (peer: string, frame: Uint8Array) => Promise<void>,
    private readonly onReady: (peer: string) => void,
  ) {}

  async start(peer: string): Promise<void> {
    if (this.closed) throw new Error('secure_sessions_closed');
    if (this.self >= peer || this.sessions.has(peer)) return;
    const existing = this.starts.get(peer);
    if (existing) return existing;
    const generation = this.generations.get(peer) ?? 0;
    const pending = this.begin(peer, generation);
    this.starts.set(peer, pending);
    try { await pending; }
    finally { if (this.starts.get(peer) === pending) this.starts.delete(peer); }
  }

  private async begin(peer: string, generation: number): Promise<void> {
    const id = crypto.getRandomValues(new Uint8Array(SESSION_ID_LENGTH));
    const localPair = await generatePair();
    const hello = frame(HELLO, id, await exportPublic(localPair));
    if (this.closed || (this.generations.get(peer) ?? 0) !== generation || this.sessions.has(peer)) return;
    const session = this.createSession('hello-sent', id, localPair, hello, peer);
    this.sessions.set(peer, session);
    try {
      await this.sendFrame(peer, hello);
    } catch (error) {
      if (this.sessions.get(peer) === session) {
        this.drop(peer, error instanceof Error ? error : new Error('secure_handshake_send_failed'));
      }
    }
  }

  async encrypt(peer: string, plaintext: Uint8Array): Promise<Uint8Array> {
    if (this.closed) throw new Error('secure_sessions_closed');
    if (peer === this.self) throw new Error('secure_invalid_peer');
    if (this.self < peer) await this.start(peer);
    const session = this.sessions.get(peer) ?? await this.waitForSession(peer);
    await session.ready;
    if (this.sessions.get(peer) !== session || !session.sendKey) throw new Error('secure_session_closed');
    if (session.sendSequence < 1n || session.sendSequence > MAX_SEQUENCE) throw new Error('secure_sequence_exhausted');
    const sequence = session.sendSequence++;
    const ciphertext = await seal(session.sendKey, sequence, DATA, session.id, this.self, peer, plaintext);
    if (this.sessions.get(peer) !== session) throw new Error('secure_session_closed');
    return frame(DATA, session.id, encodeSequence(sequence), ciphertext);
  }

  async receive(peer: string, bytes: Uint8Array): Promise<Uint8Array | null> {
    // ChatService serializes authenticated frames per peer. Do not concurrently
    // call receive() for the same peer: validation and decryption await WebCrypto.
    if (this.closed) throw new Error('secure_sessions_closed');
    const kind = readKind(bytes);
    if (kind === HELLO) {
      await this.receiveHello(peer, bytes);
      return null;
    }
    const session = this.sessions.get(peer);
    if (!session || !equal(bytes.slice(5, 21), session.id)) throw new Error('secure_session_unknown');
    if (kind === WELCOME) {
      await this.receiveWelcome(peer, session, bytes);
      return null;
    }
    if (kind === CONFIRM) {
      await this.receiveConfirm(peer, session, bytes);
      return null;
    }
    if (kind === ACK) {
      await this.receiveAck(peer, session, bytes);
      return null;
    }
    if (session.phase !== 'ready' || !session.receiveKey || bytes.length < 21 + 8 + TAG_LENGTH) {
      throw new Error('secure_session_not_ready');
    }
    const sequence = decodeSequence(bytes.slice(21, 29));
    if (sequence < session.receiveSequence || sequence === 0n) throw new Error('secure_message_replay_or_order');
    const plaintext = await open(session.receiveKey, sequence, DATA, session.id, peer, this.self, bytes.slice(29));
    if (this.sessions.get(peer) !== session) { plaintext.fill(0); throw new Error('secure_session_closed'); }
    session.receiveSequence = sequence + 1n;
    return plaintext;
  }

  drop(peer: string, reason: Error = new Error('secure_session_closed')): void {
    this.generations.set(peer, (this.generations.get(peer) ?? 0) + 1);
    const waiter = this.waiters.get(peer);
    if (waiter) {
      this.waiters.delete(peer);
      clearTimeout(waiter.timer);
      waiter.reject(reason);
    }
    const session = this.sessions.get(peer);
    if (!session) return;
    this.sessions.delete(peer);
    session.localPair = undefined;
    session.sendKey = undefined;
    session.receiveKey = undefined;
    clearTimeout(session.timer);
    if (session.phase !== 'ready') session.rejectReady(reason);
  }

  close(): void {
    this.closed = true;
    for (const peer of new Set([...this.sessions.keys(), ...this.starts.keys(), ...this.responding, ...this.waiters.keys()])) this.drop(peer);
  }

  private async receiveHello(peer: string, bytes: Uint8Array): Promise<void> {
    if (this.self <= peer || bytes.length !== 21 + PUBLIC_KEY_LENGTH) throw new Error('secure_hello_invalid');
    if (this.sessions.has(peer) || this.responding.has(peer)) {
      // A duplicate/replayed hello may not replace an authenticated live session.
      throw new Error('secure_hello_duplicate');
    }
    this.responding.add(peer);
    const generation = this.generations.get(peer) ?? 0;
    try {
      const id = bytes.slice(5, 21);
      const localPair = await generatePair();
      const helloHash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer(bytes)));
      const welcome = frame(WELCOME, id, helloHash, await exportPublic(localPair));
      if (this.closed || (this.generations.get(peer) ?? 0) !== generation) return;
      const session = this.createSession('welcome-sent', id, localPair, bytes.slice(), peer);
      session.welcome = welcome;
      this.sessions.set(peer, session);
      const waiter = this.waiters.get(peer);
      if (waiter) {
        this.waiters.delete(peer);
        clearTimeout(waiter.timer);
        waiter.resolve(session);
      }
      try {
        await this.deriveKeys(peer, session, bytes.slice(21));
        if (this.sessions.get(peer) !== session) return;
        await this.sendFrame(peer, welcome);
      } catch (error) {
        if (this.sessions.get(peer) === session) {
          this.drop(peer, error instanceof Error ? error : new Error('secure_handshake_failed'));
        }
        throw error;
      }
    } finally {
      this.responding.delete(peer);
    }
  }

  private async receiveWelcome(peer: string, session: Session, bytes: Uint8Array): Promise<void> {
    if (this.self >= peer || session.phase !== 'hello-sent' || bytes.length !== 21 + 32 + PUBLIC_KEY_LENGTH) {
      throw new Error('secure_welcome_invalid');
    }
    const helloHash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer(session.hello)));
    if (!equal(bytes.slice(21, 53), helloHash)) throw new Error('secure_welcome_mismatch');
    session.welcome = bytes.slice();
    await this.deriveKeys(peer, session, bytes.slice(53));
    if (this.sessions.get(peer) !== session) return;
    session.phase = 'confirm-sent';
    const proof = await seal(session.sendKey!, 0n, CONFIRM, session.id, this.self, peer, encoder.encode('confirm'));
    if (this.sessions.get(peer) !== session) return;
    await this.sendFrame(peer, frame(CONFIRM, session.id, proof));
  }

  private async receiveConfirm(peer: string, session: Session, bytes: Uint8Array): Promise<void> {
    if (this.self <= peer || session.phase !== 'welcome-sent' || bytes.length !== 21 + 7 + TAG_LENGTH || !session.receiveKey) {
      throw new Error('secure_confirm_invalid');
    }
    const proof = await open(session.receiveKey, 0n, CONFIRM, session.id, peer, this.self, bytes.slice(21));
    if (!equal(proof, encoder.encode('confirm'))) throw new Error('secure_confirm_mismatch');
    const ack = await seal(session.sendKey!, 0n, ACK, session.id, this.self, peer, encoder.encode('ready'));
    if (this.sessions.get(peer) !== session) return;
    await this.sendFrame(peer, frame(ACK, session.id, ack));
    if (this.sessions.get(peer) !== session) return;
    this.makeReady(peer, session);
  }

  private async receiveAck(peer: string, session: Session, bytes: Uint8Array): Promise<void> {
    if (this.self >= peer || session.phase !== 'confirm-sent' || bytes.length !== 21 + 5 + TAG_LENGTH || !session.receiveKey) {
      throw new Error('secure_ack_invalid');
    }
    const proof = await open(session.receiveKey, 0n, ACK, session.id, peer, this.self, bytes.slice(21));
    if (!equal(proof, encoder.encode('ready'))) throw new Error('secure_ack_mismatch');
    if (this.sessions.get(peer) !== session) return;
    this.makeReady(peer, session);
  }

  private async deriveKeys(peer: string, session: Session, remoteBytes: Uint8Array): Promise<void> {
    if (!session.localPair) throw new Error('secure_ephemeral_key_unavailable');
    const remote = await crypto.subtle.importKey('raw', buffer(remoteBytes), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: remote }, session.localPair.privateKey, 256);
    try {
      const context = encoder.encode(JSON.stringify([
        'MeshAutonomy online E2EE v1',
        this.self < peer ? this.self : peer,
        this.self < peer ? peer : this.self,
      ]));
      const transcript = join(context, session.hello, session.welcome!);
      const salt = await crypto.subtle.digest('SHA-256', buffer(transcript));
      const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
      const lowToHigh = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: buffer(encoder.encode('low-to-high')) },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
      );
      const highToLow = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: buffer(encoder.encode('high-to-low')) },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
      );
      if (this.sessions.get(peer) !== session) return;
      session.sendKey = this.self < peer ? lowToHigh : highToLow;
      session.receiveKey = this.self < peer ? highToLow : lowToHigh;
    } finally { new Uint8Array(secret).fill(0); }
  }

  private createSession(phase: Phase, id: Uint8Array, localPair: CryptoKeyPair, hello: Uint8Array, peer: string): Session {
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // A responder may receive a hello without anyone awaiting ready yet.
    void ready.catch(() => {});
    const timer = setTimeout(() => this.drop(peer, new Error('secure_handshake_timeout')), HANDSHAKE_TIMEOUT_MS);
    return { phase, id, localPair, hello, sendSequence: 1n, receiveSequence: 1n, ready, resolveReady, rejectReady, timer };
  }

  private waitForSession(peer: string): Promise<Session> {
    const existing = this.waiters.get(peer);
    if (existing) return existing.promise;
    let resolve!: (session: Session) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Session>((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => this.drop(peer, new Error('secure_handshake_timeout')), HANDSHAKE_TIMEOUT_MS);
    this.waiters.set(peer, { promise, resolve, reject, timer });
    return promise;
  }

  private makeReady(peer: string, session: Session): void {
    session.phase = 'ready';
    // Drop the ephemeral private key reference once both sides proved possession.
    // JavaScript cannot guarantee physical zeroization of prior memory copies.
    session.localPair = undefined;
    session.hello = new Uint8Array(0);
    session.welcome = undefined;
    clearTimeout(session.timer);
    session.resolveReady();
    this.onReady(peer);
  }
}

function readKind(bytes: Uint8Array): number {
  if (bytes.length < 21 || !equal(bytes.slice(0, 4), MAGIC) || bytes[4] < HELLO || bytes[4] > DATA) {
    throw new Error('secure_frame_invalid');
  }
  return bytes[4];
}

function frame(kind: number, ...parts: Uint8Array[]): Uint8Array { return join(MAGIC, new Uint8Array([kind]), ...parts); }
function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
async function generatePair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}
async function exportPublic(pair: CryptoKeyPair): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
}
function encodeSequence(value: bigint): Uint8Array {
  requireSequence(value);
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value);
  return result;
}
function decodeSequence(value: Uint8Array): bigint { return new DataView(buffer(value)).getBigUint64(0); }
function nonce(sequence: bigint): Uint8Array {
  requireSequence(sequence);
  // 96-bit deterministic IV = zero fixed field + 64-bit invocation counter.
  // A fresh HKDF key is exclusive to one session/direction. Proof uses 0;
  // DATA starts at 1. Never restore a key with a reset counter or share it
  // between directions. Randomness in the IV prefix is not required here.
  const result = new Uint8Array(12);
  new DataView(result.buffer).setBigUint64(4, sequence);
  return result;
}
function requireSequence(sequence: bigint): void {
  if (sequence < 0n || sequence > MAX_SEQUENCE) throw new Error('secure_sequence_exhausted');
}
function associatedData(kind: number, id: Uint8Array, from: string, to: string, sequence: bigint): Uint8Array {
  return join(frame(kind, id, encodeSequence(sequence)), encoder.encode(JSON.stringify([from, to])));
}
async function seal(key: CryptoKey, sequence: bigint, kind: number, id: Uint8Array, from: string, to: string, plaintext: Uint8Array): Promise<Uint8Array> {
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buffer(nonce(sequence)), additionalData: buffer(associatedData(kind, id, from, to, sequence)) },
    key, buffer(plaintext),
  );
  return new Uint8Array(cipher);
}
async function open(key: CryptoKey, sequence: bigint, kind: number, id: Uint8Array, from: string, to: string, cipher: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buffer(nonce(sequence)), additionalData: buffer(associatedData(kind, id, from, to, sequence)) },
    key, buffer(cipher),
  ));
}
