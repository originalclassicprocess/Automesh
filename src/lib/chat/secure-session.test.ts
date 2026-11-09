import { describe, expect, it, vi } from 'vitest';
import { SecureSessions } from './secure-session';

function pair() {
  const ready: string[] = [];
  const wire: Array<{ from: string; to: string; bytes: Uint8Array }> = [];
  let alice!: SecureSessions;
  let bob!: SecureSessions;
  alice = new SecureSessions('alice', async (to, bytes) => {
    wire.push({ from: 'alice', to, bytes: bytes.slice() });
    queueMicrotask(() => { void bob.receive('alice', bytes).catch(() => {}); });
  }, () => ready.push('alice'));
  bob = new SecureSessions('bob', async (to, bytes) => {
    wire.push({ from: 'bob', to, bytes: bytes.slice() });
    queueMicrotask(() => { void alice.receive('bob', bytes).catch(() => {}); });
  }, () => ready.push('bob'));
  return { alice, bob, wire, ready };
}

describe('authenticated online session keys', () => {
  it('rejects a self handshake immediately instead of retaining an impossible waiter', async () => {
    const session = new SecureSessions('self', async () => { throw new Error('unexpected_network'); }, () => {});
    try { await expect(session.encrypt('self', new Uint8Array([1]))).rejects.toThrow('secure_invalid_peer'); }
    finally { session.close(); }
  });
  it('separates directional keys, reserves nonce zero and never wraps the data counter', async () => {
    const { alice, bob, ready } = pair();
    const encrypt = vi.spyOn(crypto.subtle, 'encrypt');
    try {
      await alice.start('bob');
      await vi.waitFor(() => expect(ready).toHaveLength(2));
      const first = await alice.encrypt('bob', new Uint8Array([1]));
      const second = await alice.encrypt('bob', new Uint8Array([1]));
      const reverse = await bob.encrypt('alice', new Uint8Array([1]));
      expect(new DataView(first.buffer).getBigUint64(21)).toBe(1n);
      expect(new DataView(second.buffer).getBigUint64(21)).toBe(2n);
      expect(new DataView(reverse.buffer).getBigUint64(21)).toBe(1n);
      const used = encrypt.mock.calls.map(([algorithm, key]) => ({
        key, iv: Array.from(new Uint8Array((algorithm as AesGcmParams).iv as ArrayBuffer)),
      }));
      for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) {
        expect(used[i].key === used[j].key && JSON.stringify(used[i].iv) === JSON.stringify(used[j].iv)).toBe(false);
      }
      expect(used[2].key).not.toBe(used[4].key);
      const session = (alice as unknown as { sessions: Map<string, { sendSequence: bigint }> }).sessions.get('bob')!;
      session.sendSequence = (1n << 64n) - 1n;
      const last = await alice.encrypt('bob', new Uint8Array([2]));
      expect(new DataView(last.buffer).getBigUint64(21)).toBe((1n << 64n) - 1n);
      expect(Array.from(new Uint8Array((encrypt.mock.calls.at(-1)![0] as AesGcmParams).iv as ArrayBuffer)))
        .toEqual([0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255]);
      await expect(bob.receive('alice', last)).resolves.toEqual(new Uint8Array([2]));
      const count = encrypt.mock.calls.length;
      await expect(alice.encrypt('bob', new Uint8Array([3]))).rejects.toThrow('secure_sequence_exhausted');
      expect(encrypt).toHaveBeenCalledTimes(count);
    } finally { encrypt.mockRestore(); alice.close(); bob.close(); }
  });

  it('reserves different counters before concurrent encryption awaits complete', async () => {
    const { alice, bob, ready } = pair();
    try {
      await alice.start('bob');
      await vi.waitFor(() => expect(ready).toHaveLength(2));
      const frames = await Promise.all(Array.from({ length: 32 }, (_, i) => alice.encrypt('bob', new Uint8Array([i]))));
      expect(frames.map(bytes => new DataView(bytes.buffer).getBigUint64(21)))
        .toEqual(Array.from({ length: 32 }, (_, i) => BigInt(i + 1)));
      for (let i = 0; i < frames.length; i++) {
        await expect(bob.receive('alice', frames[i])).resolves.toEqual(new Uint8Array([i]));
      }
    } finally { alice.close(); bob.close(); }
  });

  it('fails closed on an invalid DATA counter without encrypting under the proof nonce', async () => {
    const { alice, bob, ready } = pair();
    try {
      await alice.start('bob');
      await vi.waitFor(() => expect(ready).toHaveLength(2));
      const session = (alice as unknown as { sessions: Map<string, { sendSequence: bigint }> }).sessions.get('bob')!;
      const encrypt = vi.spyOn(crypto.subtle, 'encrypt');
      try {
        for (const invalid of [-1n, 0n, 1n << 64n]) {
          session.sendSequence = invalid;
          await expect(alice.encrypt('bob', new Uint8Array([1]))).rejects.toThrow('secure_sequence_exhausted');
        }
        expect(encrypt).not.toHaveBeenCalled();
      } finally { encrypt.mockRestore(); }
    } finally { alice.close(); bob.close(); }
  });

  it('rejects every replayed handshake phase without another proof encryption', async () => {
    const { alice, bob, wire, ready } = pair();
    try {
      await alice.start('bob');
      await vi.waitFor(() => expect(ready).toHaveLength(2));
      const encrypt = vi.spyOn(crypto.subtle, 'encrypt');
      try {
        for (const item of wire.slice()) {
          const receiver = item.to === 'alice' ? alice : bob;
          await expect(receiver.receive(item.from, item.bytes)).rejects.toThrow();
        }
        expect(encrypt).not.toHaveBeenCalled();
        expect(ready).toHaveLength(2);
      } finally { encrypt.mockRestore(); }
    } finally { alice.close(); bob.close(); }
  });

  it('releases ephemeral private references and rejects reflection and old-session frames', async () => {
    const { alice, bob, wire, ready } = pair();
    await alice.start('bob');
    await vi.waitFor(() => expect(ready).toHaveLength(2));
    const sessions = (alice as unknown as { sessions: Map<string, { localPair?: CryptoKeyPair }> }).sessions;
    expect(sessions.get('bob')!.localPair).toBeUndefined();
    const old = await alice.encrypt('bob', new Uint8Array([1]));
    await expect(alice.receive('bob', old)).rejects.toThrow();
    const oldHello = wire[0].bytes.slice();
    alice.drop('bob'); bob.drop('alice');
    await alice.start('bob');
    await vi.waitFor(() => expect(ready).toHaveLength(4));
    expect(wire[4].bytes).not.toEqual(oldHello);
    await expect(bob.receive('alice', old)).rejects.toThrow('secure_session_unknown');
    alice.close(); bob.close();
  });
  it('establishes a session and encrypts text with distinct wire bytes', async () => {
    const { alice, bob, wire, ready } = pair();
    await alice.start('bob');
    await vi.waitFor(() => expect(ready).toHaveLength(2));
    const plaintext = new TextEncoder().encode('private message');
    const frame = await alice.encrypt('bob', plaintext);
    expect(new TextDecoder().decode(frame)).not.toContain('private message');
    expect(await bob.receive('alice', frame)).toEqual(plaintext);
    expect(wire).toHaveLength(4); // hello, welcome, confirmation, acknowledgement
    alice.close(); bob.close();
  });

  it('rejects ciphertext changes and replayed sequence numbers', async () => {
    const { alice, bob, ready } = pair();
    await alice.start('bob');
    await vi.waitFor(() => expect(ready).toHaveLength(2));
    const frame = await alice.encrypt('bob', new TextEncoder().encode('secret'));
    const tampered = frame.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(bob.receive('alice', tampered)).rejects.toThrow();
    await expect(bob.receive('alice', frame)).resolves.toEqual(new TextEncoder().encode('secret'));
    await expect(bob.receive('alice', frame)).rejects.toThrow('secure_message_replay_or_order');
    alice.close(); bob.close();
  });

  it('rejects old plaintext frames and a second hello during an active session', async () => {
    const { alice, bob, wire, ready } = pair();
    await alice.start('bob');
    await vi.waitFor(() => expect(ready).toHaveLength(2));
    await expect(bob.receive('alice', new TextEncoder().encode('old plaintext'))).rejects.toThrow('secure_frame_invalid');
    await expect(bob.receive('alice', wire[0].bytes)).rejects.toThrow('secure_hello_duplicate');
    alice.close(); bob.close();
  });

  it('uses independent sessions for two personal contacts', async () => {
    const peers = new Map<string, SecureSessions>();
    const ready: string[] = [];
    for (const name of ['alice', 'bob', 'charlie']) {
      peers.set(name, new SecureSessions(name, async (to, bytes) => {
        queueMicrotask(() => { void peers.get(to)!.receive(name, bytes).catch(() => {}); });
      }, (peer) => ready.push(`${name}:${peer}`)));
    }
    await Promise.all([peers.get('alice')!.start('bob'), peers.get('alice')!.start('charlie')]);
    await vi.waitFor(() => expect(ready).toHaveLength(4));
    const forBob = await peers.get('alice')!.encrypt('bob', new TextEncoder().encode('bob only'));
    const forCharlie = await peers.get('alice')!.encrypt('charlie', new TextEncoder().encode('charlie only'));
    expect(await peers.get('bob')!.receive('alice', forBob)).toEqual(new TextEncoder().encode('bob only'));
    expect(await peers.get('charlie')!.receive('alice', forCharlie)).toEqual(new TextEncoder().encode('charlie only'));
    await expect(peers.get('charlie')!.receive('alice', forBob)).rejects.toThrow('secure_session_unknown');
    for (const peer of peers.values()) peer.close();
  });

  it('queues a responder message until the initiator completes the handshake', async () => {
    const { alice, bob, ready } = pair();
    const pending = bob.encrypt('alice', new TextEncoder().encode('early message'));
    await alice.start('bob');
    const encrypted = await pending;
    // This test injects DATA manually, bypassing ChatService's ordered receive
    // queue. Let the asynchronously delivered ACK finish before that injection.
    await vi.waitFor(() => expect(ready).toHaveLength(2));
    expect(await alice.receive('bob', encrypted)).toEqual(new TextEncoder().encode('early message'));
    alice.close(); bob.close();
  });

  it('coalesces concurrent attempts to start the same peer session', async () => {
    const { alice, bob, wire, ready } = pair();
    await Promise.all([alice.start('bob'), alice.start('bob'), alice.start('bob')]);
    await vi.waitFor(() => expect(ready).toHaveLength(2));
    expect(wire.filter((item) => item.from === 'alice' && item.bytes[4] === 1)).toHaveLength(1);
    alice.close(); bob.close();
  });
});
