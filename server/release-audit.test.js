import{describe,it,expect}from'vitest';
import{assessAudit,inspectRemoteFeatures}from'../scripts/audit-release.mjs';
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
