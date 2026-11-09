import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {buildInformation,appRepository} from '../scripts/build-info.mjs';
import {releaseIdentity,attestationArguments,checkArchiveListing,repository} from '../scripts/public-app-release.mjs';
import {verificationOrigin} from '../scripts/verify-hosted-app.mjs';
describe('verifiable public app release',()=>{
 it('does not badge local, dirty or foreign workflow builds as a GitHub release',()=>{
  const root=new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
  const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  expect(buildInformation(root,{}).source).toBe('local');
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:appRepository,GITHUB_REF:'refs/heads/main',GITHUB_SHA:commit,GITHUB_WORKFLOW_REF:'evil/repo/.github/workflows/release.yml@refs/heads/main'};
  expect(buildInformation(root,env).source).toBe('local');
  expect(()=>buildInformation(root,{AUTOMESH_PROJECT_WEBSITE:'http://bad.test'})).toThrow();
 });
 it('pins immutable source and signer for an actual archive, not metadata alone',()=>{
  const tag='v0.5.3',name='Automesh-App-0.5.3-update.tar.gz';
  const release={draft:false,prerelease:false,tag_name:tag,target_commitish:'a'.repeat(40),html_url:`https://github.com/${repository}/releases/tag/${tag}`,
   assets:[{name,size:1024,digest:'sha256:'+'a'.repeat(64),browser_download_url:`https://github.com/${repository}/releases/download/${tag}/${name}`}]};
  expect(releaseIdentity(release,tag).commit).toBe('a'.repeat(40));
  for(const patch of [{target_commitish:'main'},{draft:true},{prerelease:true},{assets:[{...release.assets[0],browser_download_url:'https://evil.test/a'}]}])
   expect(()=>releaseIdentity({...release,...patch},tag)).toThrow();
  expect(attestationArguments('package.tar.gz','a'.repeat(40))).toEqual(expect.arrayContaining(['--source-digest','--signer-digest','--deny-self-hosted-runners',repository]));
 });
 it('rejects archive links, duplicates, traversal and expanded size bombs before extraction',()=>{
  const line='-rw-r--r-- runner/runner 12 2026-11-09 00:00 ./app.cjs';
  checkArchiveListing('./app.cjs',line);
  checkArchiveListing('./app.cjs','-rw-r--r--  0 1001  1001  12 Nov 09 00:00 ./app.cjs');
  expect(()=>checkArchiveListing('./app.cjs','-rw-r--r--  0 0  0  9999999999 Nov 09 00:00 ./app.cjs')).toThrow('Expanded archive');
  for(const [names,types] of [['../a',line],['./a\n./a',line+'\n'+line],['./a',line.replace(/^-/,'l')],['./a',line.replace(' 12 ',' 9999999999 ')]])
   expect(()=>checkArchiveListing(names,types)).toThrow();
  expect(()=>verificationOrigin('https://user:secret@example.test')).toThrow();
  expect(()=>verificationOrigin('https://example.test/path')).toThrow();
  expect(verificationOrigin('https://example.test')).toBe('https://example.test');
 });
 it('publishes only from manual main without hosting secrets and verifies origin first',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
  expect(workflow).toContain("github.repository == 'originalclassicprocess/Automesh'");
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain('workflow_dispatch:');expect(workflow).not.toMatch(/pull_request|workflow_run|secrets\.|deploy-client/);
  expect(workflow.indexOf('gh attestation verify')).toBeLessThan(workflow.indexOf('gh release create'));
  expect(workflow).toContain('refusing overwrite');
  expect(workflow).toContain('path: .release/publication');
  expect(workflow).not.toMatch(/(?:path: |subject-path: |mkdir )downloads/);
  for(const action of workflow.matchAll(/uses: (actions\/[^\s@]+)@([^\s]+)/g))expect(action[2]).toMatch(/^[a-f0-9]{40}$/);
 });
});
