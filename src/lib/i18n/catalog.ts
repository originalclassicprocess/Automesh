import russian from './locales/ru.json';
import english from './locales/en.json';

export const sourceMessages: Readonly<Record<string,string>> = russian;
export const englishMessages: Readonly<Record<string,string>> = english;
export const messageIds = Object.keys(sourceMessages);
export const placeholders = (text:string) => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match=>match[1]).sort();
const sourceIds = new Map(messageIds.map(id=>[sourceMessages[id],id]));
const patterns = messageIds.filter(id=>placeholders(sourceMessages[id]).length).map(id=>{
  const parts=sourceMessages[id].split(/(\{[a-zA-Z][a-zA-Z0-9_]*\})/g), names:string[]=[];
  const pattern=parts.map(part=>/^\{/.test(part)?(names.push(part.slice(1,-1)),'([\\s\\S]*?)'):part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+')).join('');
  return {id,names,regex:new RegExp(`^${pattern}$`),weight:sourceMessages[id].replace(/\{[^}]+\}/g,'').length};
}).sort((a,b)=>b.weight-a.weight);
const fragments=messageIds.filter(id=>!placeholders(sourceMessages[id]).length).map(id=>({id,text:sourceMessages[id]})).sort((a,b)=>b.text.length-a.text.length);
const fragmentPattern=new RegExp(fragments.map(item=>item.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
export type Translator = ((id:string, values?:Record<string,unknown>)=>string) & {text(source:unknown):string;system(source:unknown):string};
export function createTranslator(code:string, custom:Readonly<Record<string,string>>={}):Translator {
  const base=code==='ru'?sourceMessages:englishMessages;
  const translate=((id:string,values:Record<string,unknown>={})=>{
    const text=custom[id]??base[id]??englishMessages[id]??sourceMessages[id]??id;
    return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(token,name)=>Object.hasOwn(values,name)?String(values[name]??''):token);
  }) as Translator;
  // Only for app-owned presentation values, never names, messages or inputs.
  translate.text=(source:unknown)=>{
    if(source===null||source===undefined)return '';
    const text=String(source),normalized=text.replace(/\s+/g,' ').trim(),id=sourceIds.get(normalized);
    if(code==='ru'&&!Object.keys(custom).length)return text;
    const prefix=text.match(/^\s*/)?.[0]??'',suffix=text.match(/\s*$/)?.[0]??'';
    if(id)return prefix+translate(id)+suffix;
    if(text.length<=32768)for(const pattern of patterns){const match=pattern.regex.exec(text.trim());if(match)return prefix+translate(pattern.id,Object.fromEntries(pattern.names.map((name,i)=>[name,match[i+1]])))+suffix;}
    return text;
  };
  // For composed app diagnostics only (codes, counts, known explanations).
  // Never use on content or strings containing user-controlled names.
  translate.system=(source:unknown)=>{
    if(code==='ru'&&!Object.keys(custom).length)return String(source??'');
    const resolve=(value:unknown,depth:number):string=>{
      const text=String(value??''),normalized=text.replace(/\s+/g,' ').trim(),id=sourceIds.get(normalized);
      if(id)return translate(id);
      if(depth<8)for(const pattern of patterns){const match=pattern.regex.exec(normalized);if(match)return translate(pattern.id,Object.fromEntries(pattern.names.map((name,i)=>[name,resolve(match[i+1],depth+1)])));}
      return text.replace(fragmentPattern,part=>translate(sourceIds.get(part)!));
    };
    return resolve(source,0);
  };
  return translate;
}
