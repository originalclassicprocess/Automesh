import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';

const reviewed=new Set(['https://github.com/advisories/GHSA-3r8g-jcqq-3p5j','https://github.com/advisories/GHSA-6cf5-gc4q-fm3x']);
const serious=severity=>['moderate','high','critical'].includes(severity);
// Exceptions concern unreachable experimental features, never a patched package.
export function assessAudit(report,guard){
  if(!report||report.error||!report.metadata?.vulnerabilities||!report.vulnerabilities)throw Error('audit_report_invalid');
  const applies=guard.version==='2.70.4'&&guard.explicitlyDisabled===true&&guard.pluginConfigSafe===true&&guard.remoteFiles===0&&guard.remoteImports===0;
  const excluded=[],blocked=[];
  const reasons=(name,seen=new Set())=>{
    if(seen.has(name))return [];seen.add(name);
    const v=report.vulnerabilities[name];if(!v)return [{url:'unresolved',severity:'critical'}];
    return v.via.flatMap(value=>typeof value==='string'?reasons(value,seen):[value]);
  };
  for(const[name,v]of Object.entries(report.vulnerabilities)){
    if(!serious(v.severity))continue;
    const causes=reasons(name).filter(value=>serious(value.severity));
    if(applies&&v.severity!=='critical'&&['@sveltejs/kit','@sveltejs/adapter-node'].includes(name)&&causes.length&&causes.every(value=>value.severity!=='critical'&&reviewed.has(value.url)))excluded.push({name,advisories:causes.map(value=>value.url)});
    else blocked.push(name);
  }
  return {excluded,blocked};
}
export function inspectRemoteFeatures(root,config){
  const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
  let remoteFiles=0,remoteImports=0;
  function walk(folder){
    for(const item of readdirSync(folder,{withFileTypes:true})){
      const file=join(folder,item.name);
      if(item.isSymbolicLink())throw Error('audit_source_symlink');
      if(item.isDirectory())walk(file);
      else if(/\.(?:[cm]?[jt]sx?|svelte)$/.test(item.name)){
        if(/\.remote\./.test(item.name))remoteFiles++;
        const source=readFileSync(file,'utf8');
        // Any reference, including a dynamic import/re-export, requires review.
        if(source.includes('$app/server'))remoteImports++;
        if(/\.(?:ts|js)$/.test(item.name)){
          const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest);
          for(const statement of tree.statements)if(ts.isImportDeclaration(statement)&&statement.moduleSpecifier.getText(tree).includes('$app/server'))remoteImports++;
        }
      }
    }
  }
  walk(join(root,'src'));
  // Kit 2 also accepts inline Vite-plugin config. Do not allow it to override
  // the reviewed external config when relying on a disabled-feature assessment.
  const vite=readFileSync(join(root,'vite.config.ts'),'utf8'),tree=ts.createSourceFile('vite.config.ts',vite,ts.ScriptTarget.Latest);
  let calls=0,overrides=false;
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='sveltekit'){calls++;if(node.arguments.length)overrides=true;}ts.forEachChild(node,visit);}
  visit(tree);
  return {version:lock.packages['node_modules/@sveltejs/kit']?.version,explicitlyDisabled:config.kit?.experimental?.remoteFunctions===false,pluginConfigSafe:calls===1&&!overrides&&!vite.includes('remoteFunctions'),remoteFiles,remoteImports};
}
async function main(){
  const root=resolve(import.meta.dirname,'..'),config=(await import(pathToFileURL(join(root,'svelte.config.js')).href)).default;
  const guard=inspectRemoteFeatures(root,config);
  const installed=JSON.parse(readFileSync(join(root,'node_modules/@sveltejs/kit/package.json'),'utf8')).version;
  if(installed!==guard.version)throw Error('audit_installed_version_mismatch');
  if(!process.env.npm_execpath)throw Error('Run npm run audit:release');
  const result=spawnSync(process.execPath,[process.env.npm_execpath,'audit','--json','--prefer-online'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true});
  if(result.error||![0,1].includes(result.status))throw Error('audit_unavailable');
  const report=JSON.parse(result.stdout),decision=assessAudit(report,guard);
  console.log(JSON.stringify({counts:report.metadata.vulnerabilities,guard,...decision},null,2));
  if(decision.blocked.length)throw Error('audit_unreviewed_advisory');
  console.log('Audit passed with explicit feature applicability; excluded advisories remain in the report.');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))main().catch(error=>{console.error(error.message);process.exitCode=1;});
