export type MessageTextPart = { text: string; href?: string; secure?: boolean };

// Plain text only: never HTML, network requests, or a preview fetched before a click.
export function messageLinks(text: string): MessageTextPart[] {
  const parts: MessageTextPart[] = []; let cursor = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\u0000-\u001f\u007f]+/giu)) {
    const start = match.index;
    if (start > 0 && /[\p{L}\p{N}_:/]/u.test(text[start - 1])) continue;
    let candidate = match[0].replace(/[.,!?;:…。，！？；：]+$/u, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      const opens = candidate.split(open).length - 1;
      let closes = candidate.split(close).length - 1;
      while (candidate.endsWith(close) && closes > opens) { candidate = candidate.slice(0, -1); closes--; }
    }
    candidate = candidate.replace(/[.,!?;:…。，！？；：]+$/u, '');
    if (candidate.length > 4096 || /[\u202a-\u202e\u2066-\u2069\\]/u.test(candidate)) continue;
    let url: URL;
    try { url = new URL(candidate); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: candidate, href: url.href, secure: url.protocol === 'https:' });
    cursor = start + candidate.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

// Opt-in Meshtastic inline links, not an HTML/Markdown renderer. All other text
// stays literal; destinations pass the same HTTP(S) checks as ordinary links.
export function inlineMessageLinks(text:string):MessageTextPart[] {
  const parts:MessageTextPart[]=[];
  const pattern=/(?<!!)\[([^\[\]\r\n]{1,120})\]\((https?:\/\/)/giu;
  let cursor=0;
  for(const match of text.matchAll(pattern)){
    const start=match.index;if(start<cursor)continue;
    const urlStart=start+match[0].length-match[2].length;
    let end=urlStart,depth=1;
    for(;end<text.length&&end-urlStart<=4096;end++){
      const ch=text[end];
      if(/[\s<>"'`\\\u0000-\u001f\u007f]/u.test(ch))break;
      if(ch==='('){if(++depth>8)break;}
      else if(ch===')'&&--depth===0)break;
    }
    if(depth!==0)continue;
    const url=text.slice(urlStart,end),safe=messageLinks(url);
    if(safe.length!==1||safe[0].text!==url||!safe[0].href||!match[1].trim())continue;
    parts.push(...messageLinks(text.slice(cursor,start)),{...safe[0],text:match[1]});
    cursor=end+1;
  }
  parts.push(...messageLinks(text.slice(cursor)));
  return parts;
}
