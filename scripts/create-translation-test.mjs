import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {translationTestPack} from '../src/lib/i18n/test-pack.ts';
/** @param {string} destination */
export async function createTranslationTest(destination){
  const ru=JSON.parse(await readFile(new URL('../src/lib/i18n/locales/ru.json',import.meta.url),'utf8'));
  const entries=Object.entries(ru);
  const pack=translationTestPack(ru),messages=pack.messages;
  await writeFile(destination,JSON.stringify(pack,null,2)+'\n');
  return {path:destination,fields:entries.length,russian:Object.values(messages).filter(Boolean).length,empty:Object.values(messages).filter(v=>!v).length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const out=resolve(process.argv[2]||'.release/translation-test-50-50-ru.json');
  await mkdir(resolve(out,'..'),{recursive:true});console.log(JSON.stringify(await createTranslationTest(out)));
}
