import { describe, expect, it } from 'vitest';
import { contactIdFromInput, contactReferenceFromInput,contactSearchTerm } from './contact-input';
import { contactLink } from './contact-link';
import { signalingEndpoints } from '$lib/transport/client-config';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
const own = encodeAccountId(new Uint8Array(20).fill(1));
const peer = encodeAccountId(new Uint8Array(20).fill(2));
describe('contact QR input', () => {
  it('learns a route from an exchanged contact link, never from a second deployment default', () => {
    const first='https://first.example', second='https://second.example';
    expect(signalingEndpoints({}, first)).toEqual([{url:'wss://first.example/signal',kind:'internet'}]);
    expect(signalingEndpoints({}, second)).toEqual([{url:'wss://second.example/signal',kind:'internet'}]);
    expect(contactReferenceFromInput(contactLink(peer, first),own)).toEqual({accountId:peer,signalingUrl:'wss://first.example/signal'});
    expect(contactReferenceFromInput(contactLink(peer, second),own)).toEqual({accountId:peer,signalingUrl:'wss://second.example/signal'});
    expect(contactReferenceFromInput(peer,own)).toEqual({accountId:peer});
  });
  it('does not accept arbitrary URLs, embedded credentials or public plaintext as route hints', () => {
    for(const url of [`https://user:pass@first.example/#/contact/${peer}`,
      `https://first.example/path/#/contact/${peer}`,
      `https://first.example/#/contact/${peer}extra`]) expect(()=>contactReferenceFromInput(url,own)).toThrow();
    for(const host of ['localhost','192.168.1.2','127.0.0.1','169.254.169.254','[::1]','[fe80::1]'])
      expect(contactReferenceFromInput(`https://${host}/#/contact/${peer}`,own)).toEqual({accountId:peer});
    expect(()=>contactReferenceFromInput(contactLink(own,'https://first.example'),own)).toThrow('ваш аккаунт');
  });
  it('extracts contacts from local/full/network-bearing links without adopting local or plaintext route hints',()=>{
    for(const link of [peer,`http://127.0.0.1:5199/#/contact/${peer}`,`https://first.example/?networks=hint#/contact/${peer}?signal=wss%3A%2F%2Fother.example`, `http://first.example/#/contact/${peer}`]){
      expect(contactReferenceFromInput(link,own).accountId).toBe(peer);expect(contactSearchTerm(link)).toBe(peer);
    }
    expect(contactReferenceFromInput(`http://127.0.0.1:5199/#/contact/${peer}`,own)).toEqual({accountId:peer});
    expect(contactReferenceFromInput(`http://first.example/#/contact/${peer}`,own)).toEqual({accountId:peer});
    expect(contactSearchTerm(' Alice ')).toBe('alice');
  });
  it('accepts only a checksummed Account ID, trimming surrounding whitespace', () => {
    expect(contactIdFromInput(`  ${peer}\n`, own)).toBe(peer);
  });
  it('rejects self, edits, seed, URLs, server and pairing payloads without following them', () => {
    expect(() => contactIdFromInput(own, own)).toThrow('ваш аккаунт');
    for (const text of [peer.slice(0, -1) + 'x', 'https://automesh.space/' + peer,
      'wss://192.168.0.1:3002/signal', '{"type":"mesh-local-node"}', 'abandon '.repeat(12), '{"type":"offer"}'])
      expect(() => contactIdFromInput(text, own)).toThrow('Нужен Mesh ID');
  });
});
