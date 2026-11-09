// Native colour emoji are scalable fonts; no downloaded emoji catalogue.
export function standaloneEmoji(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 64 || value.includes('\ufe0e')) return false;
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
  if (segments.length !== 1) return false;
  if (/^[\p{Regional_Indicator}]{2}$/u.test(value) || /^[0-9#*]\ufe0f?\u20e3$/u.test(value)) return true;
  if (/\p{Regional_Indicator}/u.test(value)) return false;
  if (/^\u{1f3f4}[\u{e0061}-\u{e007a}]+\u{e007f}$/u.test(value)) return true;
  return value.split('\u200d').every(part =>
    /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\ufe0f?\p{Emoji_Modifier}?$/u.test(part)
    && !/^\p{Emoji_Modifier}/u.test(part));
}
