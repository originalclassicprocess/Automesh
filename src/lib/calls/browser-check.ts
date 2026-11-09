// Disposable browser fixture: fresh synthetic identities, no vault/storage,
// no production node, no microphone/camera access. Real DTLS/SRTP with tone tracks.
import { ChatService } from '$lib/chat/ChatService';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { getAccountId } from '$lib/addressing/address';
import { bytesToHex } from '$lib/message/encoding';
import { TRANSPORT_CAPABILITIES, type Transport, type Peer, type TransportStatus, type TransportMessage } from '$lib/transport/transport';
import { CallController } from './controller';

class LoopTransport implements Transport {
  capabilities = TRANSPORT_CAPABILITIES.webrtc;
  address = ''; other?: LoopTransport;
  private messages: ((message: TransportMessage) => void)[] = [];
  private peers: ((peer: Peer, event: 'joined' | 'left') => void)[] = [];
  getStatus(): TransportStatus { return 'connected'; }
  async init(address: string) { this.address = address; }
  async connect(peer: Peer) {
    this.peers.forEach(handler => handler(peer, 'joined'));
    this.other?.peers.forEach(handler => handler({ address: this.address, transport: 'webrtc', lastSeen: Date.now() }, 'joined'));
  }
  async disconnect() {}
  async send(message: TransportMessage) {
    const snapshot = { ...message, payload: message.payload.slice(), signature: message.signature.slice() };
    queueMicrotask(() => this.other?.messages.forEach(handler => handler(snapshot)));
  }
  onMessage(handler: (message: TransportMessage) => void) { this.messages.push(handler); }
  onStatusChange(_handler: (status: TransportStatus) => void) {}
  onPeerChange(handler: (peer: Peer, event: 'joined' | 'left') => void) { this.peers.push(handler); }
  async discover(): Promise<Peer[]> { return []; }
  async isAvailable() { return true; }
}
const assert = (ok: unknown, reason: string): void => { if (!ok) throw new Error(reason); };
async function until(test: () => boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!test()) { if (Date.now() >= deadline) throw new Error('browser_call_timeout'); await new Promise(resolve => setTimeout(resolve, 30)); }
}
export async function checkBrowserCalls(): Promise<{ cycles: number; authenticated: boolean; dtls: boolean; audioPackets: boolean; tracksReleased: boolean }> {
  const transports = [new LoopTransport(), new LoopTransport()]; transports[0].other = transports[1]; transports[1].other = transports[0];
  const identities = [new WebCryptoIdentity(), new WebCryptoIdentity()];
  const seeds = [crypto.getRandomValues(new Uint8Array(32)), crypto.getRandomValues(new Uint8Array(32))];
  const accounts = await Promise.all(identities.map(async (provider, i) => {
    const identity = await provider.fromSeed(seeds[i]); seeds[i].fill(0);
    return { provider, address: await getAccountId(bytesToHex(identity.publicKey)) };
  }));
  const chats = transports.map(transport => new ChatService(transport)), online = [new Set<string>(), new Set<string>()];
  const contexts: AudioContext[] = [], tracks: MediaStreamTrack[] = [], pcs: RTCPeerConnection[][] = [[], []];
  const calls = accounts.map((account, i) => {
    const c = new CallController({ self: account.address, allowed: peer => peer === accounts[1 - i].address,
      online: peer => online[i].has(peer), send: (peer, signal) => chats[i].sendCall(signal, peer), config: () => ({ iceServers: [] }),
      media: async () => {
        const context = new AudioContext(); contexts.push(context); await context.resume();
        const oscillator = context.createOscillator(), gain = context.createGain(), output = context.createMediaStreamDestination();
        gain.gain.value = 0.01; oscillator.frequency.value = 440; oscillator.connect(gain); gain.connect(output); oscillator.start();
        tracks.push(...output.stream.getTracks()); return output.stream;
      },
      peerConnection: config => { const pc = new RTCPeerConnection(config); pcs[i].push(pc); return pc; }, update() {}, remote() {},
    });
    chats[i].onCall((peer, signal) => c.receive(peer, signal)); chats[i].onDisconnect(() => c.dispose());
    chats[i].onPeerChange((peer, event) => event === 'joined' ? online[i].add(peer.address) : online[i].delete(peer.address));
    return c;
  });
  try {
    await Promise.all(chats.map((chat, i) => chat.init(accounts[i])));
    await chats[0].connect(accounts[1].address); await until(() => online.every(set => set.size === 1));
    const codes = new Set<string>();
    for (let cycle = 0; cycle < 4; cycle++) {
      const caller = cycle % 2, callee = 1 - caller;
      await calls[caller].start(accounts[callee].address); await until(() => calls[callee].snapshot().phase === 'incoming');
      await calls[callee].accept(); await until(() => calls.every(call => call.snapshot().phase === 'active'));
      assert(calls.every(call => call.snapshot().authenticated), 'browser_call_unverified');
      const code = calls[0].snapshot().code; assert(code === calls[1].snapshot().code && !codes.has(code), 'browser_call_code_binding'); codes.add(code);
      for (const pair of pcs) {
        const pc = pair[cycle];
        const stats = await pc.getStats();
        assert([...stats.values()].some(s => s.type === 'transport' && s.dtlsState === 'connected'), 'browser_call_dtls');
        await until(() => tracks[cycle * 2].enabled);
        await new Promise(resolve => setTimeout(resolve, 300));
        const live = await pc.getStats();
        assert([...live.values()].some(s => s.type === 'outbound-rtp' && s.kind === 'audio' && s.packetsSent > 0), 'browser_call_rtp');
        assert([...live.values()].some(s => s.type === 'inbound-rtp' && s.kind === 'audio' && s.packetsReceived > 0), 'browser_call_receive_rtp');
      }
      calls[caller].mute(); assert(!tracks[cycle * 2].enabled, 'browser_call_mute'); calls[caller].mute();
      calls[caller].end(); await until(() => calls[callee].snapshot().phase === 'ended');
      assert(tracks.every(track => track.readyState === 'ended'), 'browser_call_track_leak');
      assert(pcs.every(pair => pair.every(pc => pc.connectionState === 'closed')), 'browser_call_pc_leak');
      calls.forEach(call => call.dismiss()); await new Promise(resolve => setTimeout(resolve, 5100));
    }
    return { cycles: 4, authenticated: true, dtls: true, audioPackets: true, tracksReleased: true };
  } finally {
    calls.forEach(call => call.dispose()); await Promise.allSettled(chats.map(chat => chat.disconnect()));
    tracks.forEach(track => track.stop()); await Promise.allSettled(contexts.map(context => context.close())); identities.forEach(provider => provider.dispose());
  }
}
