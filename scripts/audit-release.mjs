import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';

const reviewed=new Set(['https://github.com/advisories/GHSA-3r8g-jcqq-3p5j','https://github.com/advisories/GHSA-6cf5-gc4q-fm3x']);
const buildAdvisory='https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const buildPackages=new Set(['picomatch','@rollup/plugin-commonjs','@rollup/plugin-json','@rollup/plugin-node-resolve','@rollup/plugin-replace','@rollup/pluginutils','@sveltejs/adapter-node','@sveltejs/vite-plugin-svelte','fdir','tinyglobby','svelte-check','vite','vitest']);
const buildVersions={'picomatch':'4.0.7','@rollup/plugin-commonjs':'29.0.3','@rollup/plugin-json':'6.1.0','@rollup/plugin-node-resolve':'16.0.3','@rollup/plugin-replace':'6.0.3','@rollup/pluginutils':'5.4.0','@sveltejs/adapter-node':'5.5.8','@sveltejs/vite-plugin-svelte':'7.3.1','fdir':'6.5.0','tinyglobby':'0.2.17','svelte-check':'4.7.6','vite':'8.3.6','vitest':'4.1.12'};
const serious=severity=>['moderate','high','critical'].includes(severity);
// Reviewed feature/build applicability never means that a package is patched.
export function assessAudit(report,guard,buildGuard){
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
    const buildOnly=guard.version==='2.70.4'&&buildGuard?.picomatchVersion==='4.0.7'&&buildGuard.toolchainMatches===true&&buildGuard.devOnly===true&&buildGuard.runtimeImports===0&&buildPackages.has(name)&&buildGuard.devPackages.includes(name);
    if(v.severity!=='critical'&&causes.length&&causes.every(value=>value.severity!=='critical'&&(
      applies&&['@sveltejs/kit','@sveltejs/adapter-node'].includes(name)&&reviewed.has(value.url)||buildOnly&&value.url===buildAdvisory
    )))excluded.push({name,advisories:causes.map(value=>value.url)});
    else blocked.push(name);
  }
  return {excluded,blocked};
}
export function inspectBuildTools(root){
  const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8')),pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const entries=Object.entries(lock.packages??{}),copies=entries.filter(([path])=>path.endsWith('/node_modules/picomatch')||path==='node_modules/picomatch');
  const devPackages=[...buildPackages].filter(name=>{const found=entries.filter(([path])=>path===`node_modules/${name}`||path.endsWith(`/node_modules/${name}`));return found.length&&found.every(([,value])=>value.dev===true)&&!Object.hasOwn(pkg.dependencies??{},name)&&!Object.hasOwn(pkg.optionalDependencies??{},name);});
  const toolchainMatches=Object.entries(buildVersions).every(([name,version])=>{const found=entries.filter(([path])=>path===`node_modules/${name}`||path.endsWith(`/node_modules/${name}`));return devPackages.includes(name)&&found.length&&found.every(([,value])=>value.version===version);});
  let runtimeImports=0;
  function walk(folder){for(const item of readdirSync(folder,{withFileTypes:true})){
    const file=join(folder,item.name);if(item.isSymbolicLink())throw Error('audit_source_symlink');
    if(item.isDirectory())walk(file);
    else if(/\.(?:[cm]?[jt]sx?|svelte)$/.test(item.name)&&!item.name.includes('.test.')&&file!==join(root,'src','lib','i18n','test-setup.ts')){
      const source=readFileSync(file,'utf8');
      if(/['"](?:picomatch|tinyglobby|fdir|vite|vitest|svelte-check|@rollup\/plugin[^'"]*|@sveltejs\/(?:adapter-node|vite-plugin-svelte))(?:\/|['"])/.test(source)||/['"][^'"]*(?:\.test[./]|test-setup)[^'"]*['"]/.test(source))runtimeImports++;
    }
  }}
  walk(join(root,'src'));walk(join(root,'server'));
  return {picomatchVersion:copies.length&&copies.every(([,value])=>value.version==='4.0.7')?'4.0.7':'unreviewed',devOnly:copies.length>0&&devPackages.includes('picomatch'),toolchainMatches,runtimeImports,devPackages};
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
  const report=JSON.parse(result.stdout),buildGuard=inspectBuildTools(root),decision=assessAudit(report,guard,buildGuard);
  console.log(JSON.stringify({counts:report.metadata.vulnerabilities,guard,buildGuard,...decision},null,2));
  if(decision.blocked.length)throw Error('audit_unreviewed_advisory');
  console.log('Audit passed with explicit applicability; excluded advisories remain in the report.');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))main().catch(error=>{console.error(error.message);process.exitCode=1;});
