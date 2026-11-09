import { describe, expect, it } from 'vitest';
import { offlineKeyBudget } from './offline-key-budget';
import { emptyCourierState } from '$lib/node/courier-state';
import { emptyOfflineState } from '$lib/node/offline-state';
const self = 'alice', peer = 'bob', now = 100;
function state() {
  const courier = emptyCourierState(); courier.enabled = true;
  courier.node = { url: 'https://localhost:3003', nodeId: 'a'.repeat(32), address: 'node' };
  courier.bundles[peer] = { body: { protocol: 'automesh-courier-v1', from: peer, to: self, expiresAt: 200, keys: [{ id: 'one', publicKey: 'a' }, { id: 'two', publicKey: 'b' }] }, signature: '', publicKey: '' };
  return courier;
}
describe('offline key budget', () => {
  it('distinguishes no node, disabled mode and no valid descriptor', () => {
    expect(offlineKeyBudget(self, peer, true, emptyCourierState(), emptyOfflineState(), false, now).label).toBe('Нода не подключена');
    expect(offlineKeyBudget(self, peer, false, state(), emptyOfflineState(), true, now).available).toBe(false);
    expect(offlineKeyBudget(self, peer, true, state(), emptyOfflineState(), true, 200).label).toBe('Нода: ждём ключи');
  });
  it('decrements on reservation, never on retry, and increments after new keys arrive', () => {
    const courier = state(); const count = () => offlineKeyBudget(self, peer, true, courier, emptyOfflineState(), true, now).count;
    expect(count()).toBe(2); courier.used.one = 300; expect(count()).toBe(1); expect(count()).toBe(1);
    courier.bundles[peer].body.keys.push({ id: 'three', publicKey: 'c' }); expect(count()).toBe(2);
    courier.used.two = 300; courier.used.three = 300; expect(count()).toBe(0);
  });
  it('counts unique unspent peer keys, not our private keys or another contact pool', () => {
    const courier = state(); courier.bundles[peer].body.keys.push({ id: 'one', publicKey: 'a' });
    expect(offlineKeyBudget(self, peer, true, courier, emptyOfflineState(), true, now).count).toBe(2);
    courier.bundles[peer].body.to = 'other';
    expect(offlineKeyBudget(self, peer, true, courier, emptyOfflineState(), true, now).count).toBe(0);
  });
  it('reports unavailable nodes separately and supports legacy mailbox mode', () => {
    expect(offlineKeyBudget(self, peer, true, state(), emptyOfflineState(), false, now).label).toContain('недоступна');
    const mailbox = emptyOfflineState(); mailbox.enabled = true; mailbox.node = { url: 'https://localhost:3003', nodeId: 'a'.repeat(32) };
    mailbox.bundles[peer] = { body: { version: 1, from: peer, to: self, node: mailbox.node, expiresAt: 200, keys: [{ id: 'one', publicKey: 'a' }] }, publicKey: '', signature: '' };
    expect(offlineKeyBudget(self, peer, true, emptyCourierState(), mailbox, false, now).count).toBe(1);
  });
  it('distinguishes cached keys from on-demand replenishment without inventing remote stock',()=>{
    const courier=state();courier.bundles[peer].body.keySource={url:'https://peer.example',nodeId:'b'.repeat(32)};
    expect(offlineKeyBudget(self,peer,true,courier,emptyOfflineState(),true,now)).toMatchObject({count:2,available:true,refreshable:true});
    courier.used.one=300;courier.used.two=300;
    const empty=offlineKeyBudget(self,peer,true,courier,emptyOfflineState(),true,now);
    expect(empty).toMatchObject({count:0,available:false,refreshable:true});expect(empty.label).toContain('по запросу');
    expect(offlineKeyBudget(self,peer,true,courier,emptyOfflineState(),true,201).label).toContain('по запросу');
  });
});

it('shows confirmed node stock while P2P is still connecting; unknown and unavailable stock are never fabricated',()=>{
 const courier=state(),source={url:'https://peer.example',nodeId:'b'.repeat(32)};courier.bundles[peer].body.keySource=source;courier.used.one=300;courier.used.two=300;
 const read=(stock?:import('$lib/node/key-stock').RemoteKeyStock)=>offlineKeyBudget(self,peer,true,courier,emptyOfflineState(),true,now,stock);
 expect(read().badgeText).toBe('?');
 expect(read({...source,status:'ready',available:32,checkedAt:now})).toMatchObject({count:32,available:true,badgeText:'32'});
 expect(read({...source,status:'empty',available:0,checkedAt:now})).toMatchObject({count:0,available:false,badgeText:'0'});
 expect(read({...source,status:'unavailable',checkedAt:now}).badgeText).toBe('!');
 expect(read({...source,status:'ready',available:32,checkedAt:now-46000}).badgeText).toBe('?');
 expect(read({...source,url:'https://old.example',status:'ready',available:32,checkedAt:now}).badgeText).toBe('?');
});
