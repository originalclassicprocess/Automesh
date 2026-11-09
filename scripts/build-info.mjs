import { readFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildVersion } from './build-version.mjs';
export const appRepository='originalclassicprocess/Automesh';
/** @param {string} root @param {NodeJS.ProcessEnv} env */
export function buildInformation(root=resolve(import.meta.dirname,'..'),env=process.env) {
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  let commit=/** @type {string|null} */(null),dirty=true;
  try {
    /** @param {...string} args */
    const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
    const value=git('rev-parse','HEAD');if(/^[a-f0-9]{40}$/.test(value))commit=value;
    dirty=git('status','--porcelain','--untracked-files=normal')!=='';
  } catch {/* A source archive remains a usable local build without Git. */}
  const workflow=env.GITHUB_WORKFLOW_REF?.split('@')[0]??null;
  const github=env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===appRepository&&
    env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_SHA===commit&&!dirty&&
    workflow!==null&&[`${appRepository}/.github/workflows/release.yml`,`${appRepository}/.github/workflows/preview-build.yml`].includes(workflow);
  let website=null;
  if(env.AUTOMESH_PROJECT_WEBSITE){const value=new URL(env.AUTOMESH_PROJECT_WEBSITE);if(value.protocol!=='https:'||value.username||value.password||value.search||value.hash)throw Error('invalid_project_website');website=value.href;}
  return {schema:1,version:pkg.version,buildVersion:buildVersion(root),repository:appRepository,commit,dirty,
    source:github?'github-actions':'local',workflow:github?workflow:null,
    runId:github&&/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID??'')?env.GITHUB_RUN_ID:null,website};
}
export function buildInformationPlugin(){
  return {name:'automesh-build-information',/** @param {string} id */ resolveId(id){if(id==='virtual:automesh-build')return '\0automesh-build';},
    /** @param {string} id */ load(id){if(id==='\0automesh-build')return `export const buildInfo=${JSON.stringify(buildInformation())};`;}};
}
