import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { render } from 'svelte/server';
import { language, locale, localTranslations, tr, availableLanguages, setLanguage, restoreLanguage,installTranslation,removeTranslation } from './language';
import LanguageSelector from './LanguageSelector.svelte';
beforeEach(() => { localTranslations.set([]);setLanguage('en'); });
afterEach(() => {localTranslations.set([]);setLanguage('ru');});
describe('explicit device UI language, not account content', () => {
  it('defaults to English and switches locale explicitly', () => {
    expect(get(language)).toBe('en'); expect(get(locale)).toBe('en-US');
    setLanguage('ru'); expect(get(locale)).toBe('ru-RU');
    expect(() => setLanguage('fr' as 'en')).toThrow('unsupported_ui_language');
  });
  it('persists only a validated language, without identity, secrets or content', () => {
    const setItem = vi.fn(); setLanguage('ru', { setItem });
    expect(setItem).toHaveBeenCalledExactlyOnceWith('automesh.ui-language.v1', 'ru');
    restoreLanguage({ getItem: () => 'en' }); expect(get(language)).toBe('en');
    restoreLanguage({ getItem: () => '{"seed":"ignored"}' }); expect(get(language)).toBe('en');
  });
  it('works with unavailable/denied device storage', () => {
    setLanguage('ru', { setItem: () => { throw new Error('denied'); } }); expect(get(language)).toBe('ru');
    restoreLanguage({ getItem: () => { throw new Error('denied'); } }); expect(get(language)).toBe('en');
  });
  it('renders both choices and marks the actual current UI language', () => {
    const english = render(LanguageSelector).body; expect(english).toContain('English'); expect(english).toContain('Русский');
    expect(english).toContain('Interface language'); setLanguage('ru'); expect(render(LanguageSelector).body).toContain('Язык интерфейса');
  });
});

const pack=(locale='fr',messages:Record<string,string>={})=>JSON.stringify({format:'automesh-ui-translation',version:1,locale,name:'Français',messages});
const storage=()=>{const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};};
describe('local translation lifecycle',()=>{
  it('imports, selects and restores a local pack without any account data',()=>{
    const device=storage();const result=installTranslation(pack('fr',{'language.title':'Langue'}),device);
    expect(result.persisted).toBe(true);expect(get(language)).toBe('local:fr');expect(get(locale)).toBe('fr');
    expect(get(tr)('language.title')).toBe('Langue');expect(get(tr)('language.import')).toBe('Import translation JSON');
    localTranslations.set([]);setLanguage('en');restoreLanguage(device);
    expect(get(language)).toBe('local:fr');expect(get(availableLanguages)).toContainEqual({value:'local:fr',label:'Français'});
    expect(render(LanguageSelector).body).toContain('Français');
    expect(removeTranslation('local:fr',device)).toBe(true);restoreLanguage(device);
    expect(get(language)).toBe('en');expect(get(localTranslations)).toEqual([]);
  });
  it('can replace a pack and enforces a bounded local library',()=>{
    for(const code of ['fr','de','es','it','nl'])installTranslation(pack(code));
    expect(()=>installTranslation(pack('pt'))).toThrow('translation_pack_limit');
    installTranslation(pack('fr',{'language.title':'Nouvelle langue'}));expect(get(localTranslations)).toHaveLength(5);
    expect(get(tr)('language.title')).toBe('Nouvelle langue');
  });
  it('reports memory-only import and keeps a pack if persistent removal fails',()=>{
    const denied={setItem:()=>{throw Error('denied');}};
    expect(installTranslation(pack(),denied).persisted).toBe(false);
    expect(get(language)).toBe('local:fr');expect(removeTranslation('local:fr',denied)).toBe(false);
    expect(get(localTranslations)).toHaveLength(1);
  });
  it('rejects corrupt saved packs and unavailable selected languages on reload',()=>{
    const device=storage();device.setItem('automesh.ui-language-packs.v1',JSON.stringify([{format:'invalid'}]));
    device.setItem('automesh.ui-language.v1','local:fr');restoreLanguage(device);
    expect(get(language)).toBe('en');expect(get(localTranslations)).toEqual([]);
  });
});
