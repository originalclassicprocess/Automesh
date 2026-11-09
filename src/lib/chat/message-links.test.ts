import { describe, expect, it } from 'vitest';
import { messageLinks,inlineMessageLinks } from './message-links';
describe('message links', () => {
  it('renders Meshtastic labelled links without changing ordinary personal-chat text',()=>{
    const text='Привет\n[Кайфешник](https://url.com/) и [Automesh](https://app.test/#/contact/mesh1abc)';
    expect(inlineMessageLinks(text)).toEqual([{text:'Привет\n'},{text:'Кайфешник',href:'https://url.com/',secure:true},{text:' и '},{text:'Automesh',href:'https://app.test/#/contact/mesh1abc',secure:true}]);
    expect(messageLinks(text).map(p=>p.text).join('')).toBe(text);
    expect(inlineMessageLinks('[x](https://site.test/a(b))!')[0]).toEqual({text:'x',href:'https://site.test/a(b)',secure:true});
    expect(inlineMessageLinks('[x](http://[::1]:5174/)')[0].href).toBe('http://[::1]:5174/');
  });
  it('does not turn unsafe or malformed Markdown into hidden destinations or images',()=>{
    for(const text of ['[x](javascript:alert(1))','[x](data:text/html,test)','[x](https://user:pass@site.test/)','[x](https://site.test/\u202evil)','![pic](https://site.test/image.png)','[broken](https://site.test/']){
      const parts=inlineMessageLinks(text);expect(parts.map(p=>p.text).join('')).toBe(text);
      expect(parts.some(p=>p.href&&p.text==='x')).toBe(false);
    }
    const html=inlineMessageLinks('[<img onerror=x>](https://site.test/)');
    expect(html).toEqual([{text:'<img onerror=x>',href:'https://site.test/',secure:true}]); // Rendered as Svelte text, never raw HTML.
  });
  it('keeps whitespace and safely separates HTTP and HTTPS', () => {
    const text = 'Привет\nhttps://site.com/a?q=1&b=2 и http://site.com/.';
    const parts = messageLinks(text);
    expect(parts.map(p => p.text).join('')).toBe(text);
    expect(parts.filter(p => p.href).map(p => p.secure)).toEqual([true, false]);
  });
  it('excludes surrounding punctuation but keeps balanced URL parentheses', () => {
    expect(messageLinks('(https://site.com/a(b)).')[1].href).toBe('https://site.com/a(b)');
    expect(messageLinks('https://site.com/。')[0].text).toBe('https://site.com/');
  });
  it('does not activate dangerous, credentialed, obfuscated or malformed links', () => {
    for (const text of ['javascript:alert(1)', 'data:text/html,test', 'https://', 'https://user:password@site.com/', 'javascript:https://site.com/', 'https://site.com/\u202evil', 'https://site.com\\evil']) {
      expect(messageLinks(text).some(p => p.href)).toBe(false);
      expect(messageLinks(text).map(p => p.text).join('')).toBe(text);
    }
  });
  it('never interprets surrounding HTML and bounds URL size', () => {
    const text = '<img onerror="alert(1)"> https://site.com/';
    expect(messageLinks(text)[0].text).toBe('<img onerror="alert(1)"> ');
    expect(messageLinks('https://site.com/' + 'a'.repeat(4096)).some(p => p.href)).toBe(false);
    expect(messageLinks('')).toEqual([]);
  });
});
