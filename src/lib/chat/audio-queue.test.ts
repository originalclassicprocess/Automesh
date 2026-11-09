import { describe, expect, it } from 'vitest';
import { adjacentAudio, isQueueAudio, orderedAudio, reconcileShuffle } from './audio-queue';
import type { ChatEntry } from './session-chats';

describe('audio queue', () => {
  it('keeps forward and reverse order without changing the source', () => {
    const ids = ['a','b','c'];
    expect(orderedAudio(ids,'forward',[])).toEqual(ids);
    expect(orderedAudio(ids,'reverse',[])).toEqual(['c','b','a']);
    expect(ids).toEqual(['a','b','c']);
  });
  it('stops at boundaries without repeat and wraps with repeat all', () => {
    expect(adjacentAudio(['a','b'],'a',1,false)).toBe('b');
    expect(adjacentAudio(['a','b'],'b',1,false)).toBeNull();
    expect(adjacentAudio(['a','b'],'b',1,true)).toBe('a');
    expect(adjacentAudio(['a','b'],'a',-1,true)).toBe('b');
    expect(adjacentAudio(['a','b'],'a',-1,false)).toBeNull();
    expect(adjacentAudio([],'a',1,true)).toBeNull();
    expect(adjacentAudio(['a'],'missing',1,true)).toBeNull();
    expect(adjacentAudio(['a'],'a',1,true)).toBe('a');
  });
  it('starts shuffle with the current track and includes every other track once', () => {
    const shuffled = reconcileShuffle(['a','b','c'],[],'b');
    expect(shuffled[0]).toBe('b');
    expect([...shuffled].sort()).toEqual(['a','b','c']);
    expect(new Set(shuffled).size).toBe(3);
  });
  it('preserves shuffled order while removing unavailable tracks and adding new ones', () => {
    expect(reconcileShuffle(['a','c','d'],['c','b','a'],'a')).toEqual(['c','a','d']);
    expect(orderedAudio(['a','c','d'],'shuffle',['c','b','a'])).toEqual(['c','a','d']);
  });
  it('separates voice recordings from ordinary audio without including videos', () => {
    const entry: ChatEntry = { id:'a', text:'', from:'peer', timestamp:1, direction:'incoming',
      file: {id:'a', name:'track.mp3', mime:'audio/mpeg', size:100, sha256:'a'.repeat(64)} };
    expect(isQueueAudio(entry)).toBe(true);
    expect(isQueueAudio({...entry,file:{...entry.file!,name:'track.flac',mime:'audio/flac'}})).toBe(true);
    expect(isQueueAudio({...entry,file:{...entry.file!,name:'voice-2026-10-08T15-20-00-000Z.m4a',mime:'audio/mp4'}})).toBe(false);
    expect(isQueueAudio({...entry,file:{...entry.file!,name:'clip.mp4',mime:'video/mp4'}})).toBe(false);
    expect(isQueueAudio({...entry,file:undefined})).toBe(false);
  });
});
