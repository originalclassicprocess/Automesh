import {it,expect} from 'vitest';
import {translationTestPack} from './test-pack';
import {parseTranslationPack} from './packs';
import {createTranslator,sourceMessages,englishMessages} from './catalog';

it('generates an importable 50/50 Russian test file with genuine English fallback',()=>{
    const raw=JSON.parse(JSON.stringify(translationTestPack(sourceMessages))),pack=parseTranslationPack(JSON.stringify(raw));
    const total=Object.keys(sourceMessages).length;
    expect(Object.values(raw.messages).filter(Boolean)).toHaveLength(Math.ceil(total/2));
    expect(Object.values(raw.messages).filter(v=>!v)).toHaveLength(Math.floor(total/2));
    expect(Object.keys(pack.messages)).toHaveLength(Math.ceil(total/2));
    const ui=createTranslator(`local:${pack.locale}`,pack.messages);
    for(const id of Object.keys(sourceMessages))expect(ui(id)).toBe(raw.messages[id]||englishMessages[id]);
});
