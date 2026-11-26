import { describe, expect, it } from 'vitest';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { editGroupMentions, mentionQuery, parseGroupMentions, type GroupMention } from './mentions';

describe('group mention ranges', () => {
  const first = encodeAccountId(new Uint8Array(20).fill(1));
  const second = encodeAccountId(new Uint8Array(20).fill(2));
  const draft = '@Ник @Ник';
  const mentions: GroupMention[] = [[0,4,first], [5,9,second]];

  it('preserves the selected account when an identical nickname is deleted or replaced', () => {
    expect(editGroupMentions(draft, '@Ник', mentions, { start:0, end:5, type:'deleteByCut' }))
      .toEqual([[0,4,second]]);
    expect(editGroupMentions(draft, draft, mentions, { start:0, end:4, type:'insertFromPaste' }))
      .toEqual([[5,9,second]]);
  });

  it('handles caret edits and skips email addresses or existing mentions', () => {
    expect(mentionQuery('@Борис', 3, [])).toEqual({ start:0, end:6, query:'Бо' });
    expect(mentionQuery('name@site', 9, [])).toBeNull();
    expect(mentionQuery(draft, 4, mentions)).toBeNull();
  });

  it('rejects overlapping and out-of-bounds mention ranges', () => {
    expect(parseGroupMentions(draft, mentions)).toEqual(mentions);
    expect(parseGroupMentions(draft, [[0,9,first], [5,9,second]])).toBeNull();
    expect(parseGroupMentions(draft, [[5,10,second]])).toBeNull();
  });
});
