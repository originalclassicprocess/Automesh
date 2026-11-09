import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'svelte/compiler';

const folder = new URL('../src/lib/i18n/locales/', import.meta.url);
const read = async language => JSON.parse(await readFile(new URL(`${language}.json`, folder), 'utf8'));
const ru = await read('ru'), en = await read('en');
const normalized = value => value.replace(/\s+/g, ' ').trim();
const fields = value => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(item => item[1]).sort().join('|');
const idFor = value => `m_${createHash('sha256').update(normalized(value)).digest('hex').slice(0,12)}`;

// Add reviewed copy explicitly; do not automatically rewrite application code.
if (process.argv[2] === '--add') {
  const [russian, english] = process.argv.slice(3);
  if (!russian || !english || fields(russian)!==fields(english)) throw Error('Provide Russian and English text with matching placeholders.');
  const id = idFor(russian); ru[id]=normalized(russian); en[id]=normalized(english);
  for (const [code,catalog] of [['ru',ru],['en',en]]) await writeFile(new URL(`${code}.json`,folder),JSON.stringify(catalog,null,2)+'\n');
  console.log(`Added ${id}. Use $i18n('${id}', values) or $i18n.text(source) at the presentation boundary.`);
}

const errors=[];
if (Object.keys(ru).sort().join('|')!==Object.keys(en).sort().join('|')) errors.push('Built-in catalog keys differ.');
for (const [id,source] of Object.entries(ru)) {
  if(typeof en[id]!=='string'||!en[id].trim()||fields(source)!==fields(en[id]))errors.push(`${id}: invalid English translation or placeholders.`);
  if(typeof en[id]==='string'&&/[А-Яа-яЁё]/.test(en[id]))errors.push(`${id}: untranslated Russian in English catalog.`);
}
const known = new Set(Object.values(ru).map(normalized));
function checkExpression(expression,path) {
  if (!expression || typeof expression!=='object') return;
  if(expression.type==='CallExpression'&&expression.callee?.type==='Identifier'&&['$i18n','$tr'].includes(expression.callee.name)){
    const id=expression.arguments[0];if(id?.type==='Literal'&&typeof id.value==='string'&&!Object.hasOwn(ru,id.value))errors.push(`${path}: missing message ${id.value}`);
  }
  if(expression.type==='CallExpression'&&expression.callee?.type==='MemberExpression'&&['$i18n','$tr'].includes(expression.callee.object?.name)&&expression.callee.property?.name==='text'){
    const text=expression.arguments[0];if(text?.type==='Literal'&&typeof text.value==='string'&&/[А-Яа-яЁё]/.test(text.value)&&!known.has(normalized(text.value)))errors.push(`${path}: missing source ${text.value}`);
  }
  for(const [key,value]of Object.entries(expression)){if(['loc','start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(item=>checkExpression(item,path));else if(value&&typeof value==='object')checkExpression(value,path);}
}
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=`${dir}/${entry.name}`;
  if(entry.isDirectory()){if(!['dev','i18n'].includes(entry.name))await scan(path);}
  else if(entry.name.endsWith('.svelte')){
    const source=await readFile(path,'utf8'), ast=parse(source,{modern:true});checkExpression(ast.fragment,path);
    function text(node){if(!node||typeof node!=='object')return;
      if(node.type==='Attribute'&&!['aria-label','aria-description','title','label','description','detail','placeholder','alt'].includes(node.name))return;
      if(node.type==='Text'&&/[А-Яа-яЁё]/.test(node.data))errors.push(`${path}: untranslated markup ${normalized(node.data)}`);
      for(const [key,value]of Object.entries(node)){if(['loc','start','end','expression','test'].includes(key))continue;if(Array.isArray(value))value.forEach(text);else if(value&&typeof value==='object')text(value);}}
    text(ast.fragment);
  }
}}
await scan('src');
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log(`Translation catalogs and UI references verified: ${Object.keys(ru).length} messages in English and Russian.`);
