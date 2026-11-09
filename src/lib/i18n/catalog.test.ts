import {describe,it,expect} from 'vitest';
import {render} from 'svelte/server';
import {createTranslator,sourceMessages,englishMessages,messageIds,placeholders} from './catalog';
import {parseTranslationPack,translationTemplate,MAX_PACK_BYTES} from './packs';
import {setLanguage} from './language';
import SettingsMenu from '$lib/application/SettingsMenu.svelte';
import LanguageSettings from './LanguageSettings.svelte';
import {settingsMenu,settingsDescriptions} from '$lib/application/settings-structure';
import {conversationPreview} from '$lib/chat/conversation-list';
import type {Conversation} from '$lib/chat/session-chats';
const idFor=(value:string)=>messageIds.find(id=>sourceMessages[id]===value)!;

describe('translation catalog and content boundary',()=>{
  it('has a complete English catalog with identical interpolation fields',()=>{
    expect(Object.keys(englishMessages).sort()).toEqual([...messageIds].sort());
    for(const id of messageIds){expect(englishMessages[id].trim(),id).not.toBe('');expect(placeholders(englishMessages[id]),id).toEqual(placeholders(sourceMessages[id]));expect(englishMessages[id],id).not.toMatch(/[А-Яа-яЁё]/);}
    expect(new TextEncoder().encode(JSON.stringify(translationTemplate())).length).toBeLessThan(MAX_PACK_BYTES);
    expect(parseTranslationPack(JSON.stringify(translationTemplate())).messages).toEqual(englishMessages);
  });
  it('preserves interpolation values, whitespace and app protocol codes',()=>{
    const ui=createTranslator('en');
    const name='Настройки  Анна\nPrivate';
    expect(ui(idFor('Отозвать доступ: {v0}'),{v0:name})).toBe(`Revoke access: ${name}`);
    expect(ui.text(`Отозвать доступ: ${name}`)).toBe(`Revoke access: ${name}`);
    expect(ui.text(' · данные устарели')).toBe(' · outdated data');
    expect(ui.text('invalid_courier_recipient')).toBe('invalid_courier_recipient');
    expect(createTranslator('ru').text('  Сохранить\n')).toBe('  Сохранить\n');
  });
  it('translates only preview labels, never a message, name or file name',()=>{
    const ui=createTranslator('en');const chat={messages:[{direction:'outgoing',text:'Настройки',timestamp:1}]} as unknown as Conversation;
    expect(conversationPreview(chat,ui.text)).toBe('You: Настройки');
    chat.messages[0].file={name:'Настройки  Анна.png'} as never;
    expect(conversationPreview(chat,ui.text)).toBe('You: 📎 Настройки  Анна.png');
    expect(conversationPreview({messages:[]} as unknown as Conversation,ui.text)).toBe('No messages yet');
  });
  it('renders real navigation and import settings in either language',()=>{
    const props={section:'overview',items:settingsMenu,descriptions:settingsDescriptions,onSelect:()=>{}};
    setLanguage('en');const en=render(SettingsMenu,{props}).body;
    expect(en).toContain('Security');expect(en).not.toMatch(/[А-Яа-яЁё]/);
    expect(render(LanguageSettings).body).toContain('Import translation JSON');
    setLanguage('ru');expect(render(SettingsMenu,{props}).body).toContain('Безопасность');
  });
});

describe('plain local JSON translation validation',()=>{
  const base=()=>({...translationTemplate(),locale:'fr',name:'Français',messages:{'language.title':'Langue'}});
  it('accepts partial packs and preserves English fallback',()=>{
    const p=parseTranslationPack(JSON.stringify(base()));const ui=createTranslator('local:fr',p.messages);
    expect(ui('language.title')).toBe('Langue');expect(ui.text('Безопасность')).toBe('Security');
  });
  it('treats empty and whitespace-only template cells as English fallback',()=>{
    const p=parseTranslationPack(JSON.stringify({...base(),messages:{'language.title':'Тест','language.import':'','language.coverage':'   '}}));
    expect(Object.keys(p.messages)).toEqual(['language.title']);
    const ui=createTranslator('local:fr',p.messages);
    expect(ui('language.import')).toBe('Import translation JSON');
    expect(ui('language.coverage',{count:1,total:3})).toBe('Translated messages: 1 of 3. The rest appear in English.');
    expect(()=>parseTranslationPack(JSON.stringify({...base(),messages:{unknown:''}}))).toThrow('invalid_translation_pack');
  });
  it.each([
    {version:2},{locale:'../../fr'},{name:'<script>'},{name:'\u202eunsafe'},
    {messages:{unknown:'value'}},{messages:{'language.title':'<img src=x>'}},
    {messages:{'language.title':'\u0000'}},{messages:{'language.title':'{newField}'}},
    {messages:{'language.coverage':'No placeholders'}},{execute:'anything'},
  ])('rejects invalid fields without executing or changing UI state: %j',change=>{
    expect(()=>parseTranslationPack(JSON.stringify({...base(),...change}))).toThrow('invalid_translation_pack');
  });
  it('rejects prototype keys, duplicate placeholders, arrays and oversized files',()=>{
    expect(()=>parseTranslationPack('{"format":"automesh-ui-translation","version":1,"locale":"fr","name":"French","messages":{"__proto__":"x"}}')).toThrow();
    expect(()=>parseTranslationPack(JSON.stringify({...base(),messages:{'language.coverage':'{count} {count} {total}'}}))).toThrow();
    expect(()=>parseTranslationPack('[]')).toThrow();
    expect(()=>parseTranslationPack(' '.repeat(MAX_PACK_BYTES+1))).toThrow('translation_pack_too_large');
  });
});
