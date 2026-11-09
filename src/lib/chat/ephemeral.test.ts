import { describe, it, expect } from 'vitest';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { decodeChatContent, encodeChatContent, normalizeMessageDetails, RICH_PREFIX, EPHEMERAL_PREFIX } from './message-details';
import { ephemeralExpired, ephemeralState, expiredMessage, normalizeEphemeralState, nextEphemeralOpening } from './ephemeral';
import { conversationPreview } from './conversation-list';
import { messagePreview, transcript, forwardingDetails } from './chat-actions';
import { searchMessages, historyJumpVisible } from './chat-search';
import { normalizeFileOffer } from './file-transfer';
import { manifestContent } from '$lib/node/courier-files';
import { portableChatData, referencedBackupFiles } from '$lib/backup/full-backup';
import { unreadMessageCount, type ChatEntry } from './session-chats';
import { visibleChatMessages } from './message-pins';
const self = encodeAccountId(new Uint8Array(20).fill(1)), peer = encodeAccountId(new Uint8Array(20).fill(2));
const base: ChatEntry = { id:crypto.randomUUID(), text:'PRIVATE BODY SHOULD NOT ESCAPE',from:self,timestamp:1000,direction:'outgoing', details:{ephemeral:{ seconds:10, views:3, allowDownload:false }} };
describe('bounded disappearing content', () => {
  it('uses a new encrypted format rather than silently stripping limits in old clients', () => {
    const content=encodeChatContent(base.text,base.details);
    expect(content.startsWith(EPHEMERAL_PREFIX)).toBe(true);
    expect(decodeChatContent(content)).toEqual({text:base.text,details:base.details});
    expect(decodeChatContent(content.replace(EPHEMERAL_PREFIX,RICH_PREFIX))).toBeNull();
    expect(encodeChatContent('ordinary')).toBe('\0mesh-chat-v1:ordinary');
    const control={ephemeralOpened:{targetId:base.id,viewedAt:1200,views:1}};
    expect(decodeChatContent(encodeChatContent('',control))?.details).toEqual(control);
    expect(() => encodeChatContent('hidden',control)).toThrow();
  });
  it.each([{},{seconds:0},{seconds:604801},{views:0},{views:21},{views:1.5},{views:1,allowDownload:'yes'},{views:1,extra:1}])('rejects invalid rules %j', rule => {
    expect(normalizeMessageDetails({ephemeral:{allowDownload:false,...rule}})).toBeNull();
  });
  it('rejects controls mixed with visible content or files', () => {
    const details={ephemeralOpened:{targetId:base.id,viewedAt:1200,views:1}};
    expect(normalizeMessageDetails({...details,ephemeral:base.details!.ephemeral})).toBeNull();
    expect(normalizeFileOffer({id:base.id,name:'a.txt',size:1,mime:'text/plain',sha256:'a'.repeat(64),details})).toBeNull();
  });
  it('does not start on arrival; expires at the earliest timer/view limit and survives persisted state', () => {
    expect(ephemeralExpired(base,undefined,9999999)).toBe(false);
    const state=normalizeEphemeralState(JSON.parse(JSON.stringify({firstViewedAt:2000,views:1})));
    expect(ephemeralExpired(base,state,11999)).toBe(false);
    expect(ephemeralExpired(base,state,12000)).toBe(true);
    expect(ephemeralExpired(base,{firstViewedAt:2000,views:3},2001)).toBe(true);
    expect(normalizeEphemeralState({firstViewedAt:0,views:1})).toBeUndefined();
  });
  it('merges authenticated recipient reports monotonically; ignores outgoing reports', () => {
    const opened=(time:number,views:number):ChatEntry=>({...base,id:crypto.randomUUID(),text:'',from:peer,direction:'incoming',details:{ephemeralOpened:{targetId:base.id,viewedAt:time,views}}});
    expect(ephemeralState(base,[opened(2500,3),opened(2000,1),{...opened(1,20),direction:'outgoing'}])).toEqual({firstViewedAt:2000,views:3});
    const incoming={...base,direction:'incoming' as const};
    expect(ephemeralState(incoming,[opened(1,20)])).toBeUndefined();
  });
  it('does not impose a hidden opening limit on timer-only policies', () => {
    const timerOnly={...base,details:{ephemeral:{seconds:60,allowDownload:false}},ephemeralState:{firstViewedAt:1000,views:20}};
    expect(nextEphemeralOpening(timerOnly,2000)).toEqual({firstViewedAt:1000,views:20});
    expect(nextEphemeralOpening(timerOnly,61000)).toBeNull();
    expect(nextEphemeralOpening({...base,ephemeralState:{firstViewedAt:1000,views:3}},1001)).toBeNull();
  });
  it('redacts tombstones, previews, exports, quotes and search; controls are not unread/chat rows', () => {
    const dead=expiredMessage({...base,ephemeralState:{firstViewedAt:2000,views:3}});
    expect(dead.text).toBe(''); expect(dead.file).toBeUndefined(); expect(dead.ephemeralState?.expired).toBe(true);
    expect(messagePreview(base)).not.toContain('PRIVATE'); expect(transcript([base])).toBe('');
    expect(conversationPreview({messages:[base]} as never)).toBe('Исчезающее сообщение');
    expect(searchMessages([base],'PRIVATE')).toEqual([]);
    expect(() => forwardingDetails(base,{accountId:self,nickname:'A'},true,self)).toThrow();
    const control={...base,direction:'incoming' as const,details:{ephemeralOpened:{targetId:base.id,viewedAt:1200,views:1}}};
    expect(unreadMessageCount([control])).toBe(0); expect(visibleChatMessages([control])).toEqual([]);
  });
  it('uses the incompatible manifest prefix for protected files as well', () => {
    const offer={id:base.id,name:'a.png',size:1,mime:'image/png',sha256:'a'.repeat(64),details:base.details};
    expect(normalizeFileOffer(offer)?.details).toEqual(base.details);
    expect(manifestContent({offer} as never).startsWith('\0automesh-attachment-v2:')).toBe(true);
  });
  it('omits ephemeral bodies and references from portable backup data', () => {
    const file={...base,file:{id:base.id,name:'a.png',size:1,mime:'image/png',sha256:'a'.repeat(64),details:base.details}};
    const data={selfNickname:'A',readReceiptsEnabled:false,autoLockMinutes:15,peerReadPreferences:{},aliases:{},declaredNames:{},peerPublicKeys:{},chats:{order:[peer],byPeer:{[peer]:{messages:[file],contact:'accepted'}}}};
    expect(referencedBackupFiles(data as never).size).toBe(0);
    expect(JSON.stringify(portableChatData(data as never))).not.toContain(base.text);
  });
});
describe('chat search and history position', () => {
  it('matches case-insensitive text and local calendar dates together', () => {
    const message={...base,details:undefined,text:'Привет WORLD',timestamp:new Date(2026,9,21,0,1).getTime()};
    expect(searchMessages([message],'world','2026-10-21')).toEqual([message]);
    expect(searchMessages([message],'привет','2026-10-20')).toEqual([]);
    expect(searchMessages([message],'','')).toEqual([]);
  });
  it('counts messages below the viewport, not pixel distance or unread count', () => {
    expect(historyJumpVisible(11,2000,100)).toBe(false);
    expect(historyJumpVisible(12,101,100)).toBe(false);
    expect(historyJumpVisible(12,102,100)).toBe(true);
    expect(historyJumpVisible(20,90,100)).toBe(false);
  });
});
