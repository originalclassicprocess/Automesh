import {expect,it} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const root=process.cwd();
function files(dir){return readdirSync(join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);}
it('keeps new application component colors on semantic tokens, with explicit media-only exceptions',()=>{
  const failures=[];
  for(const file of files('src/lib')){
    if(!/\.(svelte|css)$/.test(file)||file.endsWith('theme.css')||file.endsWith('MediaViewer.svelte'))continue; // media chrome intentionally stays dark
    const source=readFileSync(join(root,file),'utf8');
    const styles=file.endsWith('.css')?source:[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
    let css=styles.replace(/var\([^)]*\)/g,'TOKEN');
    if(file.endsWith('InlineVideo.svelte'))css=css.replaceAll('#16252b','MEDIA_FRAME');
    if(/#[\da-fA-F]{3,8}\b|rgba?\(/.test(css))failures.push(file);
    expect(source,file).not.toContain('var(--on-accent)-space');
  }
  expect(failures,'Use theme.css tokens, not new hardcoded component colors').toEqual([]);
});
it('provides both palettes for every token and readable foreground/background pairs',()=>{
  const css=readFileSync(join(root,'src/lib/application/theme.css'),'utf8');
  const palette=mode=>Object.fromEntries([...css.matchAll(new RegExp(`--${mode}-([a-z-]+):(#\\w+);`,'g'))].map(m=>[m[1],m[2]]));
  const light=palette('light'),dark=palette('dark');expect(Object.keys(light)).toEqual(Object.keys(dark));
  const luminance=hex=>{const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  for(const colors of [light,dark])for(const [fg,bg] of [['text','surface'],['muted','surface'],['accent','accent-soft'],['on-accent','accent'],['danger','surface'],['text','outgoing']]){
    const a=luminance(colors[fg]),b=luminance(colors[bg]);expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05),`${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
  }
});
