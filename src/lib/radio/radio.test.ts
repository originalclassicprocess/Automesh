import { describe, expect, it } from 'vitest';
import { concat, uint, binary, fixed, fields, numberField, int32Field, bytesField, serialFrame, SerialFrames, toRadioPacket, PRIVATE_APP_PORT } from './meshtastic-wire';
import { RadioAssembly, fragment } from './fragments';
import { networkInvite, networkId, matchingChannel, parseNetworkInvite, encodeNetworkInvite, type RadioChannel } from './network';
import { RadioCrypto, parseRadioContact, encodeRadioContact, digest, MAX_RADIO_TEXT_BYTES } from './crypto';
import { RadioConversation, type RadioMessage } from './conversation';
import { SerialRadio, type SerialPortLike } from './serial-radio';
import {RadioAssembly as ReceiptAssembly} from './fragments';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';

const profile = { region: 16, preset: 0, slot: 1, primary: 'LongFast' };
const channel: RadioChannel = { index: 0, name: 'Automesh', psk: new Uint8Array(32).fill(7), role: 1, uplink: false, downlink: false, aead: false };
async function pair(radioProfile = profile, radioChannel = channel) {
  const network = await networkId(networkInvite(radioProfile, radioChannel));
  const first = new WebCryptoIdentity(), second = new WebCryptoIdentity(); await first.create(); await second.create();
  const a = await RadioCrypto.create(first, network, 100), b = await RadioCrypto.create(second, network, 200);
  const ac = await parseRadioContact(encodeRadioContact(a.contact), network), bc = await parseRadioContact(encodeRadioContact(b.contact), network);
  return { a, b, ac, bc, network, dispose() { a.dispose(); b.dispose(); first.dispose(); second.dispose(); } };
}
async function until(condition: () => boolean) {
  const deadline = Date.now() + 3000; while (!condition()) { if (Date.now() > deadline) throw Error('test_timeout'); await new Promise(resolve => setTimeout(resolve, 1)); }
}
describe('radio recovery scheduling',()=>{
  it('allows an explicit retry while waiting and bounds automatic retries',async()=>{
    const p=await pair(),assembled=new ReceiptAssembly();let transmissions=0;
    const a=new RadioConversation(p.a,p.bc,{send:async(_to,_channel,payload)=>{if(assembled.add(payload))transmissions++;}},0,0,15,2,5);
    try{const id=await a.send('hello');await until(()=>transmissions===3);await new Promise(r=>setTimeout(r,60));expect(transmissions).toBe(3);
      a.retry(id);await until(()=>transmissions===4);
    }finally{a.close();p.dispose();}
  });
  it('sends durable-receive receipts ahead of queued outgoing messages, without bypassing frame pacing',async()=>{
    const p=await pair(),kinds:number[]=[];let release!:()=>void,committed=false;
    const gate=new Promise<void>(resolve=>release=resolve);
    const a=new RadioConversation(p.a,p.bc,{send:async(_to,_channel,payload)=>{if(payload[3]===0x45)kinds.push(payload[5]);else if(payload[20]===0)kinds.push(payload[29]);if(kinds.length===1)await gate;}},0,0,5000);
    a.onMessage=()=>{committed=true;};
    try{await a.send('one');await a.send('two');await until(()=>kinds.length===1);
      const packet=await p.b.seal(p.ac,'incoming');for(const payload of fragment(packet))a.receive({from:200,to:100,channel:0,payload});
      await until(()=>committed);await new Promise(r=>setTimeout(r,10));release();await until(()=>kinds.length===3);
      expect(kinds).toEqual([1,2,1]);
    }finally{release?.();a.close();p.dispose();}
  });
});
describe('radio network invitations', () => {
  it('matches contents across different local channel indices, not the index or primary label with an explicit slot', async () => {
    const invite = parseNetworkInvite(encodeNetworkInvite(networkInvite(profile, channel)));
    expect(await matchingChannel(invite, { ...profile, primary: 'Other' }, [{ ...channel, index: 3 }])).toMatchObject({ index: 3 });
    expect(await matchingChannel(invite, { ...profile, preset: 1 }, [channel])).toBeNull();
    expect(await matchingChannel(invite, profile, [{ ...channel, psk: new Uint8Array(32).fill(8) }])).toBeNull();
    expect(await matchingChannel(invite, profile, [{ ...channel, aead: true }])).toBeNull();
  });
  it('includes primary name for automatically selected frequency and rejects malformed access keys', async () => {
    const invite = networkInvite({ ...profile, slot: 0 }, channel);
    expect(await matchingChannel(invite, { ...profile, slot: 0, primary: 'Other' }, [channel])).toBeNull();
    expect(() => parseNetworkInvite(encodeNetworkInvite({ ...invite, psk: 'AAAA' }))).toThrow();
    expect(() => networkInvite(profile, { ...channel, name: 'x'.repeat(12) })).toThrow();
    expect(() => parseNetworkInvite('mesh-radio-network1:' + 'a'.repeat(2000))).toThrow();
  });
});
describe('USB wire format and bounded fragmentation', () => {
  it('encodes the documented ToRadio configuration request as a fixed wire vector', () => {
    expect([...serialFrame(uint(3, 7))]).toEqual([0x94, 0xc3, 0, 2, 0x18, 7]);
    const reader = new SerialFrames(); expect(reader.feed(new Uint8Array([12, 13, 0x94]))).toEqual([]);
    expect(reader.feed(new Uint8Array([0xc3, 0, 2, 0x18]))).toEqual([]);
    expect(reader.feed(new Uint8Array([7]))).toEqual([new Uint8Array([0x18, 7])]);
    expect(() => fields(new Uint8Array([0x0a, 200]))).toThrow();
    expect(() => fields(new Uint8Array([8, 1, 8, 2]))).toThrow();
  });
  it('uses private data unicast, hop zero, no MQTT opt-in or radio ACK masquerading as application delivery', () => {
    const outer = fields(toRadioPacket(200, 3, 42, new Uint8Array([1, 2]))), packet = fields(bytesField(outer, 1));
    expect(numberField(packet, 2)).toBe(200); expect(numberField(packet, 3)).toBe(3);
    expect(numberField(packet, 9)).toBe(0); expect(numberField(packet, 10)).toBe(0);
    const data = fields(bytesField(packet, 4)); expect(numberField(data, 1)).toBe(PRIVATE_APP_PORT); expect(numberField(data, 9)).toBe(0);
    expect(() => toRadioPacket(0xffffffff, 0, 1, new Uint8Array([1]))).toThrow();
  });
  it('accepts Meshtastic negative RSSI and full uint64 metadata without rounding or weakening uint32 accessors', () => {
    // Independent protobuf wire vector: MeshPacket.rx_rssi (field 12), int32 -90.
    // Negative int32 is sign-extended and uses all ten varint bytes.
    const rssi = new Uint8Array([0x60, 0xa6, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    const packet = fields(concat(fixed(1, 200), rssi, uint(3, 1)));
    expect(numberField(packet, 1)).toBe(200); expect(numberField(packet, 3)).toBe(1);
    expect(int32Field(packet, 12)).toBe(-90);
    expect(() => numberField(packet, 12)).toThrow('radio_invalid_number');
    // Unknown uint64 max remains skippable; it must not corrupt the following field.
    const max = new Uint8Array([0x78, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    expect(numberField(fields(concat(max, uint(3, 2))), 3)).toBe(2);
    expect(() => fields(new Uint8Array([0x60, 0x80]))).toThrow('radio_truncated_protobuf');
    expect(() => fields(new Uint8Array([0x60, ...new Array(9).fill(0xff), 0x02]))).toThrow('radio_protobuf_integer_overflow');
    expect(() => fields(new Uint8Array([0x60, ...new Array(10).fill(0x80), 0x00]))).toThrow();
    expect(() => fields(new Uint8Array([0x0a, ...new Array(9).fill(0xff), 0x01]))).toThrow();
  });
  it('reassembles reversed and repeated fragments, rejects conflicts, and bounds stale partial packets', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(600)), frames = fragment(bytes), assembly = new RadioAssembly();
    expect(assembly.add(frames[2])).toBeNull(); expect(assembly.add(frames[2])).toBeNull(); expect(assembly.add(frames[3])).toBeNull();
    expect(assembly.add(frames[1])).toBeNull(); expect(assembly.add(frames[0])).toEqual(bytes);
    expect(assembly.pendingCount).toBe(0);
    assembly.add(frames[0]); const conflict = frames[0].slice(); conflict[25] ^= 1; expect(() => assembly.add(conflict)).toThrow('radio_fragment_conflict');
    let now = 0; const bounded = new RadioAssembly(() => now);
    for (let i = 0; i < 8; i++) bounded.add(fragment(bytes)[0]); expect(() => bounded.add(fragment(bytes)[0])).toThrow('radio_reassembly_limit');
    now = 180001; expect(bounded.pendingCount).toBe(0);
  });
});
describe('signed radio contacts and end-to-end envelopes', () => {
  it('binds identity, radio route and receive key without including the radio network PSK', async () => {
    const p = await pair(); try {
      expect(p.ac.body.account).not.toBe(p.bc.body.account);
      expect(Object.keys(p.ac.body)).not.toContain('psk');
      const forged = structuredClone(p.ac); forged.body.node++;
      await expect(parseRadioContact(encodeRadioContact(forged), p.network)).rejects.toThrow('invalid_offline_signature');
      await expect(parseRadioContact(encodeRadioContact(p.ac), 'b'.repeat(64))).rejects.toThrow('radio_contact_network_mismatch');
      await expect(parseRadioContact(encodeRadioContact(p.ac), p.network, p.ac.body.expires)).rejects.toThrow('radio_contact_expired');
      await expect(parseRadioContact(encodeRadioContact(p.ac), p.network, p.ac.body.created - 300001)).rejects.toThrow('radio_contact_from_future');
      await expect(parseRadioContact('mesh-radio-contact1:bad-json', p.network)).rejects.toThrow('radio_invalid_contact');
    } finally { p.dispose(); }
  });
  it('decrypts binary fragmented text and rejects changed ciphertext or a different receiving key', async () => {
    const p = await pair(); try {
      const text = 'Привет по радио 🌍', packet = await p.a.seal(p.bc, text), assembly = new RadioAssembly(); let complete: Uint8Array | null = null;
      for (const frame of fragment(packet).reverse()) complete = assembly.add(frame) ?? complete;
      expect((await p.b.open(p.ac, complete!)).text).toBe(text);
      const changed = packet.slice(); changed[120] ^= 1; await expect(p.b.open(p.ac, changed)).rejects.toThrow('radio_invalid_signature');
      await expect(p.a.open(p.bc, packet)).rejects.toThrow('radio_wrong_recipient_key');
      const receipt = await p.b.receipt(p.ac, packet); await expect(p.a.verifyReceipt(p.bc, receipt, await digest(packet))).resolves.toBeUndefined();
      await expect(p.a.verifyReceipt(p.bc, receipt, new Uint8Array(32))).rejects.toThrow('radio_invalid_receipt');
      await expect(p.a.seal(p.bc, 'я'.repeat(MAX_RADIO_TEXT_BYTES))).rejects.toThrow();
      p.b.dispose(); await expect(p.b.open(p.ac, packet)).rejects.toThrow('radio_session_closed_or_expired');
    } finally { p.dispose(); }
  });
});
describe('application delivery over lossy radio', () => {
  it('accepts channel-zero PKI only for the paired route and still verifies the end-to-end envelope', async () => {
    const p = await pair(); const incoming: string[] = [], errors: string[] = []; let acknowledgments = 0;
    const b = new RadioConversation(p.b, p.ac, { send: async () => { acknowledgments++; } }, 1, 0);
    b.onMessage = message => { incoming.push(message.text); }; b.onError = code => errors.push(code);
    try {
      const packet = await p.a.seal(p.bc, 'private PKI route');
      for (const route of [
        { from: 100, to: 200, channel: 0, pkiEncrypted: false },
        { from: 101, to: 200, channel: 0, pkiEncrypted: true },
        { from: 100, to: 201, channel: 0, pkiEncrypted: true },
        { from: 100, to: 200, channel: 2, pkiEncrypted: true },
      ]) for (const payload of fragment(packet)) b.receive({ ...route, payload });
      await new Promise(resolve => setTimeout(resolve, 10)); expect(incoming).toEqual([]); expect(acknowledgments).toBe(0);
      const damaged = packet.slice(); damaged[damaged.length - 1] ^= 1;
      for (const payload of fragment(damaged)) b.receive({ from: 100, to: 200, channel: 0, pkiEncrypted: true, payload });
      await until(() => errors.length === 1); expect(errors).toEqual(['radio_invalid_signature']);
      expect(incoming).toEqual([]); expect(acknowledgments).toBe(0);
      for (const payload of fragment(packet)) b.receive({ from: 100, to: 200, channel: 0, pkiEncrypted: true, payload });
      await until(() => acknowledgments > 0); expect(incoming).toEqual(['private PKI route']);
    } finally { b.close(); p.dispose(); }
  });
  it('acknowledges only after receive commit and does not deliver replayed text twice', async () => {
    const p = await pair(); const aUpdates: RadioMessage[] = [], received: RadioMessage[] = []; let accept!: () => void;
    const saving = new Promise<void>(resolve => accept = resolve), frames: Uint8Array[] = [];
    const a = new RadioConversation(p.a, p.bc, { send: async (_to, _channel, payload) => { frames.push(payload); b.receive({ from: 100, to: 200, channel: 0, payload }); } }, 0, 0, 5000);
    const b = new RadioConversation(p.b, p.ac, { send: async (_to, _channel, payload) => { a.receive({ from: 200, to: 100, channel: 0, payload }); } }, 0, 0, 5000);
    a.onUpdate = message => aUpdates.push(message); b.onMessage = async message => { await saving; received.push(message); };
    try {
      await a.send('test'); await until(() => aUpdates.some(message => message.status === 'awaiting'));
      expect(aUpdates.some(message => message.status === 'received')).toBe(false); expect(received).toHaveLength(0);
      accept(); await until(() => aUpdates.some(message => message.status === 'received')); expect(received).toHaveLength(1);
      for (const payload of frames) b.receive({ from: 100, to: 200, channel: 0, payload });
      await new Promise(resolve => setTimeout(resolve, 25)); expect(received).toHaveLength(1);
    } finally { a.close(); b.close(); p.dispose(); }
  });
  it('does not acknowledge failed storage, ignores wrong routes and leaves a timed-out message retryable', async () => {
    const p = await pair(); let acknowledgments = 0; const updates: RadioMessage[] = [], errors: string[] = [];
    const b = new RadioConversation(p.b, p.ac, { send: async () => { acknowledgments++; } }, 0, 0, 20);
    const a = new RadioConversation(p.a, p.bc, { send: async (_to, _channel, payload) => b.receive({ from: 100, to: 200, channel: 0, payload }) }, 0, 0, 20);
    b.onMessage = () => { throw Error('storage_failed'); }; b.onError = error => errors.push(error); a.onUpdate = message => updates.push(message);
    try {
      await a.send('do not ack'); await until(() => updates.some(message => message.status === 'retry'));
      // Encryption/storage can finish after the short test-only receipt timeout under load.
      await until(() => errors.includes('storage_failed'));
      expect(acknowledgments).toBe(0); expect(errors).toContain('storage_failed');
      b.onMessage = () => {}; a.retry(updates.at(-1)!.id); await until(() => acknowledgments === 1);
      expect(updates.at(-1)?.status).not.toBe('received'); // A radio write/queue event cannot promote delivery.
    } finally { a.close(); b.close(); p.dispose(); }
  });
});

// Independent Phone API fixture: only documented field numbers and wire types.
function fakePort(node = 100, forward?: (packet: Uint8Array) => void, selectedChannel: RadioChannel = channel) {
  let input!: ReadableStreamDefaultController<Uint8Array>; const writes: Uint8Array[] = [];
  const push = (bytes: Uint8Array) => input.enqueue(serialFrame(bytes));
  const port: SerialPortLike = {
    readable: new ReadableStream({ start(controller) { input = controller; } }),
    writable: new WritableStream({ write(bytes) {
      writes.push(bytes.slice()); const request = fields(bytes.slice(4));
      if (request.has(3)) {
        push(binary(3, uint(1, node)));
        const lora = concat(uint(1, 1), uint(2, 0), uint(7, 16), uint(9, 1), uint(11, 1)); push(binary(5, binary(6, lora)));
        for (let index = 0; index <= selectedChannel.index; index++) {
          const current = index === selectedChannel.index ? selectedChannel : { psk: new Uint8Array([1]), name: index ? 'Other' : '' };
          push(binary(10, concat(uint(1, index), binary(2, concat(binary(2, current.psk), binary(3, new TextEncoder().encode(current.name)))), uint(3, index ? 2 : 1))));
        }
        push(binary(13, binary(1, new TextEncoder().encode('fixture')))); push(uint(7, numberField(request, 3)));
      } else if (request.has(1)) {
        const rawPacket = bytesField(request, 1), packet = fields(rawPacket); push(binary(11, concat(uint(1, 0), uint(4, numberField(packet, 6)))));
        forward?.(concat(fixed(1, node), rawPacket));
      }
    } }), open: async () => {}, close: async () => {},
  };
  return { port, writes, push };
}
describe('real serial adapter against a framed device stream', () => {
  it('checks an already connected board by requesting configuration without sending radio application packets',async()=>{
    const fixture=fakePort(),radio=new SerialRadio();
    try{const first=await radio.open(fixture.port);expect(radio.selectedPort).toBe(fixture.port);
      const checked=await radio.check();expect(checked.node).toBe(first.node);expect(checked.channels).toEqual(first.channels);
      expect(fixture.writes.filter(w=>fields(w.slice(4)).has(3))).toHaveLength(2);
      expect(fixture.writes.filter(w=>fields(w.slice(4)).has(1))).toHaveLength(0);
    }finally{await radio.close();}
  });
  it.each([false, true])('delivers private secondary-channel text and signed ACKs with negative RSSI and firmware PKI=%s', async (pki) => {
    const aChannel = { ...channel, name: 'MyDevices', index: 1, role: 2 }, bChannel = { ...aChannel, index: 2 };
    const p = await pair(profile, aChannel); let left!: ReturnType<typeof fakePort>, right!: ReturnType<typeof fakePort>;
    const receivedOn = (raw: Uint8Array, localIndex: number) => {
      const packet = fields(raw);
      return concat(fixed(1, numberField(packet, 1)), fixed(2, numberField(packet, 2)), uint(3, pki ? 0 : localIndex), uint(17, pki ? 1 : 0),
        binary(4, bytesField(packet, 4)), fixed(6, numberField(packet, 6)),
        new Uint8Array([0x60, 0xa6, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]));
    };
    left = fakePort(100, packet => right.push(binary(2, receivedOn(packet, bChannel.index))), aChannel);
    right = fakePort(200, packet => left.push(binary(2, receivedOn(packet, aChannel.index))), bChannel);
    const ar = new SerialRadio(), br = new SerialRadio();
    const a = new RadioConversation(p.a, p.bc, ar, aChannel.index, 0), b = new RadioConversation(p.b, p.ac, br, bChannel.index, 0);
    const incoming: string[] = [], delivered: string[] = [], errors: string[] = [];
    ar.onPacket = packet => a.receive(packet); br.onPacket = packet => b.receive(packet);
    ar.onError = br.onError = code => errors.push(code); a.onError = b.onError = code => errors.push(code);
    a.onMessage = b.onMessage = message => { incoming.push(message.text); };
    a.onUpdate = b.onUpdate = message => { if (message.status === 'received') delivered.push(message.text); };
    try {
      const [ac, bc] = await Promise.all([ar.open(left.port), br.open(right.port)]);
      expect(ac.channels.find(item => item.index === 1)?.name).toBe('MyDevices');
      expect(bc.channels.find(item => item.index === 2)?.name).toBe('MyDevices');
      expect(await networkId(networkInvite(ac.profile, ac.channels.find(item => item.index === 1)!))).toBe(p.network);
      expect(await networkId(networkInvite(bc.profile, bc.channels.find(item => item.index === 2)!))).toBe(p.network);
      await a.send('Вторичный канал →'); await until(() => delivered.length === 1);
      await b.send('← Ответ'); await until(() => delivered.length === 2);
      expect(incoming).toEqual(['Вторичный канал →', '← Ответ']); expect(delivered).toEqual(incoming); expect(errors).toEqual([]);
    } finally { a.close(); b.close(); await ar.close(); await br.close(); p.dispose(); }
  });
  it('runs two independent identities through both actual USB codecs and signed application ACKs without any IP transport', async () => {
    const p = await pair(); let left!: ReturnType<typeof fakePort>, right!: ReturnType<typeof fakePort>;
    left = fakePort(100, packet => right.push(binary(2, packet)));
    right = fakePort(200, packet => left.push(binary(2, packet)));
    const ar = new SerialRadio(), br = new SerialRadio();
    const a = new RadioConversation(p.a, p.bc, ar, 0, 0), b = new RadioConversation(p.b, p.ac, br, 0, 0);
    const received: string[] = [], delivered: string[] = []; ar.onPacket = packet => a.receive(packet); br.onPacket = packet => b.receive(packet);
    a.onUpdate = message => { if (message.status === 'received') delivered.push(message.text); };
    b.onMessage = message => { received.push(message.text); };
    try {
      await ar.open(left.port); await br.open(right.port);
      await a.send('Две платы — тест'); await until(() => delivered.length === 1);
      expect(received).toEqual(['Две платы — тест']); expect(delivered).toEqual(received);
      expect(left.writes.length).toBeGreaterThan(2); expect(right.writes.length).toBeGreaterThan(1);
    } finally { a.close(); b.close(); await ar.close(); await br.close(); p.dispose(); }
  });
  it('reads radio parameters without writing configuration and separates queue acceptance from incoming application traffic', async () => {
    const fixture = fakePort(), radio = new SerialRadio(), packets: unknown[] = []; radio.onPacket = packet => packets.push(packet);
    try {
      const config = await radio.open(fixture.port); expect(config.node).toBe(100); expect(config.channels[0].name).toBe('Automesh');
      expect(fixture.writes).toHaveLength(1); expect([...fields(fixture.writes[0].slice(4)).keys()]).toEqual([3]);
      await radio.send(200, 0, new Uint8Array([1])); expect(packets).toHaveLength(0);
      const data = concat(uint(1, PRIVATE_APP_PORT), binary(2, new Uint8Array([4, 5])));
      fixture.push(binary(2, concat(fixed(1, 200), fixed(2, 100), binary(4, data)))); await until(() => packets.length === 1);
      fixture.push(binary(2, concat(fixed(1, 200), fixed(2, 100), binary(4, data), uint(14, 1))));
      await new Promise(resolve => setTimeout(resolve, 10)); expect(packets).toHaveLength(1);
    } finally { await radio.close(); }
  });
  it('reports correlated firmware errors and PKI metadata without treating radio ACKs as application delivery', async () => {
    const fixture = fakePort(), radio = new SerialRadio(), packets: unknown[] = [], errors: string[] = [];
    radio.onPacket = packet => packets.push(packet); radio.onError = code => errors.push(code);
    try {
      await radio.open(fixture.port); await radio.send(200, 1, new Uint8Array([1]));
      const sent = fields(bytesField(fields(fixture.writes.at(-1)!.slice(4)), 1)), id = numberField(sent, 6);
      const routing = (request: number, reason: number) => binary(2, concat(fixed(1, 100), fixed(2, 100),
        binary(4, concat(uint(1, 5), binary(2, uint(3, reason)), fixed(6, request)))));
      fixture.push(routing(id === 1 ? 2 : 1, 39)); fixture.push(routing(id, 0));
      await until(() => radio.diagnostics.incoming === 2);
      expect(errors).toEqual([]); expect(packets).toEqual([]); expect(radio.diagnostics.routeErrors).toBe(0);
      fixture.push(routing(id, 39)); await until(() => errors.length === 1);
      expect(errors).toEqual(['radio_route_39']); expect(radio.diagnostics.lastRouteError).toBe(39);
      expect(radio.diagnostics.routeErrors).toBe(1); expect(radio.diagnostics.queued).toBe(1); expect(packets).toEqual([]);
      fixture.push(binary(2, concat(fixed(1, 200), fixed(2, 100), uint(17, 1),
        binary(4, concat(uint(1, PRIVATE_APP_PORT), binary(2, new Uint8Array([4, 5])))))));
      await until(() => packets.length === 1);
      expect(packets[0]).toMatchObject({ channel: 0, pkiEncrypted: true, from: 200, to: 100 });
      expect(radio.diagnostics.application).toBe(1); expect(radio.diagnostics.pki).toBe(1);
      const copy = radio.diagnostics; copy.lastApplication!.channel = 7;
      expect(radio.diagnostics.lastApplication!.channel).toBe(0);
    } finally { await radio.close(); }
  });
});

describe('recipient board proof and queue lifecycle', () => {
  it('accepts a late complete board receipt from the previous attempt of the same ciphertext',async()=>{
    const p=await pair(),replies:((ok:boolean)=>void)[]=[],updates:RadioMessage[]=[];
    const a=new RadioConversation(p.a,p.bc,{send:async(_to,_ch,_frame,_allowed,receipt)=>{if(receipt)replies.push(receipt);}},0,0,5000);
    a.onUpdate=m=>updates.push(m);
    try{
      const id=await a.send('hello');await until(()=>updates.at(-1)?.status==='awaiting');const first=replies[0];
      a.retry(id);await until(()=>replies.length===2&&updates.at(-1)?.status==='awaiting');
      first(true);expect(updates.at(-1)?.status).toBe('board');
      replies[1](false);expect(updates.at(-1)?.status).toBe('board');
      expect(updates.some(m=>m.status==='received')).toBe(false);
    }finally{a.close();p.dispose();}
  });
  it('understands the optional firmware ACK proof without treating route discovery or malformed proofs as acceptance',async()=>{
    const fixture=fakePort(),radio=new SerialRadio(),proofs:boolean[]=[];
    try{
      await radio.open(fixture.port);await radio.send(200,0,new Uint8Array([1]),()=>true,ok=>proofs.push(ok));
      const id=numberField(fields(bytesField(fields(fixture.writes.at(-1)!.slice(4)),1)),6);
      const reply=(from:number,routing:Uint8Array)=>binary(2,concat(fixed(1,from),fixed(2,100),binary(4,concat(uint(1,5),binary(2,routing),fixed(6,id)))));
      fixture.push(reply(100,binary(4,new Uint8Array(8))));
      fixture.push(reply(200,concat(binary(2,new Uint8Array()),binary(4,new Uint8Array(8)))));
      fixture.push(reply(200,binary(4,new Uint8Array(7))));
      await until(()=>radio.diagnostics.incoming===3);expect(proofs).toEqual([]);
      fixture.push(reply(200,concat(uint(3,0),binary(4,new Uint8Array(8)))));
      await until(()=>proofs.length===1);expect(proofs).toEqual([true]);
    }finally{await radio.close();}
  });
  it('keeps USB acceptance yellow and turns green only after ACKs for every fragment; app ACK remains separate', async () => {
    const p = await pair(), replies: ((ok:boolean)=>void)[] = [], updates: RadioMessage[] = [];
    const a = new RadioConversation(p.a,p.bc,{send:async(_to,_channel,_payload,_allowed,receipt)=>{ if(receipt)replies.push(receipt); }},0,0,5000);
    a.onUpdate=m=>updates.push(m);
    try {
      const id=await a.send('x'.repeat(200)); await until(()=>updates.at(-1)?.status==='awaiting');
      expect(replies.length).toBeGreaterThan(1); expect(updates.some(m=>m.status==='board')).toBe(false);
      for(const reply of replies.slice(0,-1))reply(true);
      expect(updates.at(-1)?.status).toBe('awaiting');
      replies.at(-1)!(true); expect(updates.at(-1)?.status).toBe('board');
      expect(updates.some(m=>m.status==='received')).toBe(false);
      a.retry(id); await until(()=>replies.length===updates.at(-1)!.total*2);
    } finally {a.close();p.dispose();}
  });
  it('cannot promote an incomplete or rejected transfer, and ignores stale callbacks after closure',async()=>{
    const p=await pair(),callbacks:((ok:boolean)=>void)[]=[],updates:RadioMessage[]=[];
    const a=new RadioConversation(p.a,p.bc,{send:async(_t,_c,_p,_a,receipt)=>{if(receipt)callbacks.push(receipt);}},0,0,5000);
    a.onUpdate=m=>updates.push(m);
    try {await a.send('hello');await until(()=>updates.at(-1)?.status==='awaiting');callbacks[0](false);
      expect(updates.at(-1)?.status).toBe('retry');a.close();const count=updates.length;callbacks[0](true);expect(updates).toHaveLength(count);
    }finally{a.close();p.dispose();}
  });
  it('sends a short authenticated text and its signed receipt in one frame each without reducing cryptographic checks',async()=>{
    const p=await pair();try{
      const packet=await p.a.seal(p.bc,'\u0000mesh-chat-v1:Hi');expect(fragment(packet)).toHaveLength(1);
      const restored=new RadioAssembly().add(fragment(packet)[0]);expect((await p.b.open(p.ac,restored!)).text).toBe('\u0000mesh-chat-v1:Hi');
      const ack=await p.b.receipt(p.ac,packet);expect(fragment(ack)).toHaveLength(1);
      await expect(p.a.verifyReceipt(p.bc,new RadioAssembly().add(fragment(ack)[0])!,await digest(packet))).resolves.toBeUndefined();
    }finally{p.dispose();}
  });
  it('accepts directed board ACKs only, never local, unrelated, MQTT or duplicate ACKs, and requests firmware ACKs explicitly',async()=>{
    const fixture=fakePort(),radio=new SerialRadio(),proofs:boolean[]=[];
    const routing=(from:number,to:number,id:number,reason=0,mqtt=false)=>binary(2,concat(fixed(1,from),fixed(2,to),uint(14,mqtt?1:0),
      binary(4,concat(uint(1,5),binary(2,uint(3,reason)),fixed(6,id)))));
    try {await radio.open(fixture.port);await radio.send(200,0,new Uint8Array([1]),()=>true,ok=>proofs.push(ok));
      const packet=fields(bytesField(fields(fixture.writes.at(-1)!.slice(4)),1)),id=numberField(packet,6);
      expect(numberField(packet,10)).toBe(1);expect(numberField(packet,9)).toBe(1);
      for(const raw of [routing(100,100,id),routing(201,100,id),routing(200,101,id),routing(200,100,id===1?2:1),routing(200,100,id,0,true)])fixture.push(raw);
      await until(()=>radio.diagnostics.incoming===5);expect(proofs).toEqual([]);
      fixture.push(binary(2,concat(fixed(1,200),fixed(2,100),binary(4,concat(uint(1,5),binary(2,binary(2,new Uint8Array())),fixed(6,id))))));
      await until(()=>radio.diagnostics.incoming===6);expect(proofs).toEqual([]);
      fixture.push(routing(200,100,id));await until(()=>proofs.length===1);expect(proofs).toEqual([true]);
      fixture.push(routing(200,100,id));await until(()=>radio.diagnostics.incoming===8);expect(proofs).toEqual([true]);
      await radio.send(200,0,new Uint8Array([2]),()=>true,ok=>proofs.push(ok));
      const next=numberField(fields(bytesField(fields(fixture.writes.at(-1)!.slice(4)),1)),6);
      fixture.push(routing(100,100,next,3));fixture.push(routing(100,100,next,5));
      await until(()=>radio.diagnostics.routeErrors===2);expect(proofs).toEqual([true]);
      fixture.push(routing(100,100,next,39));await until(()=>proofs.length===2);expect(proofs).toEqual([true,false]);
    }finally{await radio.close();}
  });
});


describe('native reply Phone API interoperability',()=>{
  it('reads and sends broadcast replies, keeping reactions out of the text history',async()=>{
    const fixture=fakePort(),radio=new SerialRadio(),incoming:import('./native-channels').ChannelText[]=[];
    radio.onChannelText=packet=>incoming.push(packet);
    try{
      await radio.open(fixture.port);
      const text=(id:number,extra:Uint8Array)=>binary(2,concat(fixed(1,200),fixed(2,0xffffffff),uint(3,0),fixed(6,id),binary(4,concat(uint(1,1),binary(2,new TextEncoder().encode('reply')),extra))));
      fixture.push(text(10,fixed(7,9)));fixture.push(text(11,concat(fixed(7,9),fixed(8,1))));
      await until(()=>radio.diagnostics.incoming===2);
      expect(incoming).toHaveLength(1);expect(incoming[0]).toMatchObject({id:10,replyId:9,from:200,channel:0,text:'reply'});
      await radio.sendChannelText(0,12,'answer',10);
      const packet=fields(bytesField(fields(fixture.writes.at(-1)!.slice(4)),1));
      expect(numberField(fields(bytesField(packet,4)),7)).toBe(10);expect(numberField(packet,2)).toBe(0xffffffff);
    }finally{await radio.close();}
  });
});
