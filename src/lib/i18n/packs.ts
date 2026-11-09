import {sourceMessages,englishMessages,placeholders} from './catalog';
export const MAX_PACK_BYTES=1024*1024,MAX_PACKS=5;
export type TranslationPack={format:'automesh-ui-translation';version:1;locale:string;name:string;messages:Record<string,string>};
const invalid=():never=>{throw new Error('invalid_translation_pack');};
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
export function parseTranslationPack(text:string):TranslationPack {
  if(new TextEncoder().encode(text).length>MAX_PACK_BYTES)throw new Error('translation_pack_too_large');
  let data:unknown;try{data=JSON.parse(text);}catch{return invalid();}
  if(!plain(data)||Object.keys(data).some(key=>!['format','version','locale','name','messages'].includes(key))||data.format!=='automesh-ui-translation'||data.version!==1||
    typeof data.locale!=='string'||!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,3}$/.test(data.locale)||typeof data.name!=='string'||!data.name.trim()||data.name.length>64||controls.test(data.name)||/[<>]/.test(data.name)||!plain(data.messages))return invalid();
  let locale:string;try{locale=Intl.getCanonicalLocales(data.locale)[0];new Intl.DateTimeFormat(locale);}catch{return invalid();}
  if(Object.keys(data.messages).length>Object.keys(sourceMessages).length)return invalid();
  const messages:Record<string,string>=Object.create(null);
  for(const[id,value]of Object.entries(data.messages)){
    if(!Object.hasOwn(sourceMessages,id)||typeof value!=='string'||value.length>6000||controls.test(value)||/<\s*\/?\s*[a-z][^>]*>/i.test(value))return invalid();
    // Empty template cells deliberately use the English fallback, including
    // messages with placeholders. Non-empty translations must preserve them.
    if(!value.trim())continue;
    if(JSON.stringify(placeholders(value))!==JSON.stringify(placeholders(sourceMessages[id])))return invalid();
    messages[id]=value;
  }
  return {format:'automesh-ui-translation',version:1,locale,name:data.name.trim(),messages};
}
export function translationTemplate():TranslationPack {
  return {format:'automesh-ui-translation',version:1,locale:'xx',name:'My language',messages:{...englishMessages}};
}
