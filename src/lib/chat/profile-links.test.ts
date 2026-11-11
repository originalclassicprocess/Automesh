import { describe, expect, it } from 'vitest';
import { normalizeProfileLinks, normalizePeerLinks, readProfileLinksPacket } from './profile-links';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { deriveChatStoreKey, sealChatData, openSealedChatData, type LocalChatData } from './local-store';
import { dataOnlyChatData } from '$lib/backup/data-backup';

describe('profile links are bounded user claims', () => {
  it('rejects executable URLs, credentials, invalid URLs and misleading control characters', () => {
    const urls = ['javascript:alert(1)', 'data:text/html,hello', '//example.com', 'https://user:password@example.com', 'https://example.com/\nnext', 'https://example.com/\u202e'];
    for (const url of urls) expect(normalizeProfileLinks([{label:'site',url}])).toEqual([]);
    expect(normalizeProfileLinks([{label:' Site ',url:'https://example.com'},{label:'duplicate',url:'https://example.com/'}]))
      .toEqual([{label:'Site',url:'https://example.com/'}]);
    expect(normalizeProfileLinks([{label:'x'.repeat(41),url:'https://example.com'}])).toEqual([]);
    expect(normalizeProfileLinks([{label:'Site',url:'https://example.com/'+'ю'.repeat(100)}])).toEqual([]);
    expect(readProfileLinksPacket('[')).toBeNull();
    expect(readProfileLinksPacket(JSON.stringify(Array(6).fill({label:'',url:'https://example.com'})))).toBeNull();
    expect(readProfileLinksPacket(JSON.stringify([{label:'bad',url:'javascript:alert(1)'}]))).toBeNull();
  });
  it('restores only valid peers and never grants verification from imported fields', () => {
    const peer = encodeAccountId(new Uint8Array(20).fill(1));
    const links=[{label:'Site',url:'https://example.com/',verified:true}];
    expect(normalizePeerLinks({[peer]:links,invalid:links})).toEqual({[peer]:[{label:'Site',url:'https://example.com/'}]});
  });
  it('preserves profile links in encrypted history and data-only backups, while dismissed hints do not mark the seed verified', async () => {
    const owner=encodeAccountId(new Uint8Array(20).fill(2)),peer=encodeAccountId(new Uint8Array(20).fill(3));
    const links=[{label:'Site',url:'https://example.com/'}];
    const data:LocalChatData={selfNickname:'Alice',selfLinks:links,peerLinks:{[peer]:links},seedBackupVerified:false,seedNoticeDismissed:true,deviceOffer:false,
      readReceiptsEnabled:true,autoLockMinutes:15,peerReadPreferences:{},aliases:{},declaredNames:{},peerPublicKeys:{},chats:{order:[],byPeer:{}}};
    const key=await deriveChatStoreKey(new Uint8Array(32).fill(4),owner),sealed=await sealChatData(key,owner,data);
    expect(new TextDecoder().decode(sealed.cipher)).not.toContain('example.com');
    const restored=await openSealedChatData(key,owner,sealed);
    expect(restored).toMatchObject({selfLinks:links,peerLinks:{[peer]:links},seedBackupVerified:false,seedNoticeDismissed:true,deviceOffer:false});
    expect(dataOnlyChatData(restored)).toMatchObject({selfLinks:links,peerLinks:{[peer]:links}});
    expect(dataOnlyChatData(restored).seedNoticeDismissed).toBeUndefined();
  });
});
