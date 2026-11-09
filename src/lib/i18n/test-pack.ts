import type {TranslationPack} from './packs';

/** Deliberately incomplete local pack for checking the real English fallback. */
export function translationTestPack(source:Readonly<Record<string,string>>):TranslationPack {
  return {format:'automesh-ui-translation',version:1,locale:'ru-XX',name:'Тест 50/50 · русский + English',
    messages:Object.fromEntries(Object.entries(source).map(([id,text],index)=>[id,index%2===0?text:'']))};
}
