import{afterEach,describe,it,expect}from'vitest';
import{assessAudit,inspectRemoteFeatures,inspectBuildTools}from'../scripts/audit-release.mjs';
import{readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';
import{join}from'node:path';
import config from'../svelte.config.js';
import{resolve}from'node:path';
const guard={version:'2.70.4',explicitlyDisabled:true,pluginConfigSafe:true,remoteFiles:0,remoteImports:0};
const cause={severity:'high',url:'https://github.com/advisories/GHSA-3r8g-jcqq-3p5j'};
const report=(via=[cause])=>({metadata:{vulnerabilities:{high:1}},vulnerabilities:{'@sveltejs/kit':{severity:'high',via}}});
describe('release advisory applicability',()=>{
 it('confirms the real source disables remote functions and imports no remote API',()=>{
  expect(inspectRemoteFeatures(resolve(import.meta.dirname,'..'),config)).toEqual(guard);
 });
 it('keeps the reviewed advisory visible instead of claiming the package is patched',()=>{
  expect(assessAudit(report(),guard)).toEqual({blocked:[],excluded:[{name:'@sveltejs/kit',advisories:[cause.url]}]});
 });
 it('rejects unknown or critical findings and incomplete audit responses',()=>{
  for(const via of [[{...cause,url:'https://github.com/advisories/NEW'}],[{...cause,severity:'critical'}],[cause,{severity:'moderate',url:'new'}]])expect(assessAudit(report(via),guard).blocked).toEqual(['@sveltejs/kit']);
  expect(()=>assessAudit({error:{}},guard)).toThrow();
 });
 it('fails closed after a dependency or feature change',()=>{
  for(const patch of [{version:'2.70.5'},{explicitlyDisabled:false},{pluginConfigSafe:false},{remoteFiles:1},{remoteImports:1}])expect(assessAudit(report(),{...guard,...patch}).blocked).toEqual(['@sveltejs/kit']);
 });
 it('permits only reviewed transitive effects and does not exempt unrelated packages',()=>{
  const r=report();r.vulnerabilities['@sveltejs/adapter-node']={severity:'high',via:['@sveltejs/kit']};
  expect(assessAudit(r,guard).excluded).toHaveLength(2);
  r.vulnerabilities.unknown={severity:'high',via:['@sveltejs/kit']};expect(assessAudit(r,guard).blocked).toEqual(['unknown']);
 });
});
const root=resolve(import.meta.dirname,'..'),temporary=[];
afterEach(()=>{for(const path of temporary.splice(0)){if(!path.startsWith(join(tmpdir(),'automesh-audit-')))throw Error('unexpected_test_directory');rmSync(path,{recursive:true});}});
function buildFixture(){const folder=mkdtempSync(join(tmpdir(),'automesh-audit-'));temporary.push(folder);for(const name of['src','server'])mkdirSync(join(folder,name));for(const name of['package.json','package-lock.json'])writeFileSync(join(folder,name),readFileSync(join(root,name)));return folder;}
const picoCause={severity:'high',url:'https://github.com/advisories/GHSA-fc5q-39xc-vjpf'};
const buildReport=()=>({metadata:{vulnerabilities:{high:2}},vulnerabilities:{picomatch:{severity:'high',via:[picoCause]},vite:{severity:'high',via:['picomatch']}}});
describe('reviewed build-only glob advisory',()=>{
 it('checks the real pinned development graph and absence of runtime references',()=>{
  expect(inspectBuildTools(root)).toMatchObject({picomatchVersion:'4.0.7',devOnly:true,toolchainMatches:true,runtimeImports:0});
 });
 it('reports only the exact reviewed cause as excluded, including its transitive effects',()=>{
  const build=inspectBuildTools(root),r=buildReport();
  expect(assessAudit(r,guard,build)).toEqual({blocked:[],excluded:[{name:'picomatch',advisories:[picoCause.url]},{name:'vite',advisories:[picoCause.url]}]});
  r.vulnerabilities.unknown={severity:'high',via:['picomatch']};expect(assessAudit(r,guard,build).blocked).toEqual(['unknown']);
 });
 it('blocks unknown/critical causes and missing or changed applicability evidence',()=>{
  const build=inspectBuildTools(root);
  for(const patch of[{picomatchVersion:'4.0.8'},{devOnly:false},{toolchainMatches:false},{runtimeImports:1},{devPackages:[]}])expect(assessAudit(buildReport(),guard,{...build,...patch}).blocked).toEqual(['picomatch','vite']);
  expect(assessAudit(buildReport(),guard).blocked).toEqual(['picomatch','vite']);
  for(const cause of[{...picoCause,severity:'critical'},{...picoCause,url:'https://github.com/advisories/UNKNOWN'}]){const r=buildReport();r.vulnerabilities.picomatch.via=[cause];expect(assessAudit(r,guard,build).blocked).toEqual(['picomatch','vite']);}
 });
 it('detects runtime imports, production dependencies and lockfile toolchain changes',()=>{
  const folder=buildFixture();expect(inspectBuildTools(folder).toolchainMatches).toBe(true);
  writeFileSync(join(folder,'server','runtime.js'),"import matcher from 'picomatch';");expect(inspectBuildTools(folder).runtimeImports).toBe(1);
  writeFileSync(join(folder,'server','runtime.js'),"import '../src/lib/i18n/test-setup';");expect(inspectBuildTools(folder).runtimeImports).toBe(1);
  const lock=JSON.parse(readFileSync(join(folder,'package-lock.json'),'utf8'));lock.packages['node_modules/picomatch'].dev=false;writeFileSync(join(folder,'package-lock.json'),JSON.stringify(lock));expect(inspectBuildTools(folder).devOnly).toBe(false);
  lock.packages['node_modules/picomatch'].dev=true;lock.packages['node_modules/vite'].version='9.0.0';writeFileSync(join(folder,'package-lock.json'),JSON.stringify(lock));expect(inspectBuildTools(folder).toolchainMatches).toBe(false);
 });
});
