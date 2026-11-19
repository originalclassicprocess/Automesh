// Exact, bounded emoji values shared by the UI and authenticated update codec.
export const LEGACY_REACTIONS=['👍','❤️','😂','😮','😢','🔥'] as const;
export const REACTIONS=[
  '👍','👎','❤️','💔','😂','🤣',
  '😊','😍','🥰','😘','😮','🤯',
  '😢','😭','😞','😡','🤬','😤',
  '🙄','🤨','🤔','🤦','🤷','🤮',
  '💩','🖕','😱','😴','🔥','👏',
  '🙏','💯','🎉','🤝','👀','✅',
] as const;
const allowed=new Set<string>(REACTIONS),legacy=new Set<string>(LEGACY_REACTIONS);
export const isReactionEmoji=(value:unknown):value is string=>typeof value==='string'&&allowed.has(value);
export const isExtendedReaction=(value:unknown)=>isReactionEmoji(value)&&!legacy.has(value);
export const reactionChoices=(extended:boolean):readonly string[]=>extended?REACTIONS:LEGACY_REACTIONS;
