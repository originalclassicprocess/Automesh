import { expect, it } from 'vitest';
import { chatListKey, hideChat, normalizeChatListPreferences, sortChatList } from './chat-list-preferences';

it('orders all four chat types by pins and keeps recent order for the rest', () => {
  const items = [
    {kind:'chat',id:'a',time:30}, {kind:'group',id:'a',time:25},
    {kind:'radio',id:'1:abc',time:10}, {kind:'agent',id:'local',time:60},
  ] as const;
  const key = (item: (typeof items)[number]) => chatListKey(item.kind,item.id);
  expect(sortChatList([...items],['radio:1:abc','group:a']).map(key)).toEqual(['radio:1:abc','group:a','agent:local','chat:a']);
  const prefs = hideChat(normalizeChatListPreferences({pinned:['radio:1:abc','group:a','radio:1:abc']}),'group:a');
  expect(prefs).toEqual({pinned:['radio:1:abc'],hidden:['group:a']});
});
