import { derived, get, writable } from 'svelte/store';
import { createTranslator } from './catalog';
import { MAX_PACKS, parseTranslationPack, type TranslationPack } from './packs';

export type Language = 'en' | 'ru' | `local:${string}`;
const preferenceKey = 'automesh.ui-language.v1';
const packsKey = 'automesh.ui-language-packs.v1';
// Server rendering is English. No account identity, words or content involved.
export const language = writable<Language>('en');
export const localTranslations = writable<TranslationPack[]>([]);
export const availableLanguages = derived(localTranslations, packs => [
  { value:'en' as Language, label:'English' }, { value:'ru' as Language, label:'Русский' },
  ...packs.map(pack=>({value:`local:${pack.locale}` as Language,label:pack.name})),
]);
export const locale = derived([language,localTranslations], ([value,packs]) => value === 'ru' ? 'ru-RU' : value === 'en' ? 'en-US' : packs.find(pack=>`local:${pack.locale}`===value)?.locale??'en-US');
export const tr = derived([language,localTranslations], ([value,packs]) => createTranslator(value,packs.find(pack=>`local:${pack.locale}`===value)?.messages));
export function setLanguage(value: Language, storage?: Pick<Storage, 'setItem'>) {
  if (!get(availableLanguages).some(item=>item.value===value)) throw new Error('unsupported_ui_language');
  language.set(value);
  try { storage?.setItem(preferenceKey, value); } catch { /* language still changes without storage */ }
}
export function restoreLanguage(storage?: Pick<Storage, 'getItem'>) {
  let value: string | null = null;
  const packs:TranslationPack[]=[];
  try {
    const saved=storage?.getItem(packsKey);
    if(saved&&saved.length<=5*1024*1024){
      const list:unknown=JSON.parse(saved);
      if(Array.isArray(list))for(const entry of list.slice(0,MAX_PACKS)){
        try { const pack=parseTranslationPack(JSON.stringify(entry));if(!packs.some(item=>item.locale===pack.locale))packs.push(pack); } catch { /* Ignore invalid saved packs. */ }
      }
    }
  } catch { /* Built-in languages remain available. */ }
  localTranslations.set(packs);
  try { value = storage?.getItem(preferenceKey) ?? null; } catch { /* English default */ }
  setLanguage(get(availableLanguages).some(item=>item.value===value)?value as Language:'en');
}
export function installTranslation(text:string,storage?:Pick<Storage,'setItem'>):{pack:TranslationPack;persisted:boolean}{
  const pack=parseTranslationPack(text),current=get(localTranslations);
  if(current.length>=MAX_PACKS&&!current.some(item=>item.locale===pack.locale))throw new Error('translation_pack_limit');
  const next=[...current.filter(item=>item.locale!==pack.locale),pack];
  let persisted=false;try{if(storage){storage.setItem(packsKey,JSON.stringify(next));persisted=true;}}catch{/* Reported in UI. */}
  localTranslations.set(next);setLanguage(`local:${pack.locale}`,persisted?storage:undefined);
  return {pack,persisted};
}
export function removeTranslation(code:string,storage?:Pick<Storage,'setItem'>):boolean{
  const next=get(localTranslations).filter(pack=>`local:${pack.locale}`!==code);
  try{storage?.setItem(packsKey,JSON.stringify(next));}catch{return false;}
  localTranslations.set(next);if(get(language)===code)setLanguage('en',storage);return true;
}
