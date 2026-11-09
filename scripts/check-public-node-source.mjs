import {readFile, mkdtemp, mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {canonicalSourceChecksum} from './source-checksum.mjs';
const root=resolve(import.meta.dirname,'..'), repo='originalclassicprocess/automesh-nodes';
const inventory=JSON.parse(await readFile(join(root,'nodes/source-provenance.json'),'utf8'));
if(inventory.repository!==repo||!/^[a-f0-9]{40}$/.test(inventory.commit??'')||!Array.isArray(inventory.files))throw Error('Pinned public node source required');
await mkdir(join(root,'.release'),{recursive:true});
const checkout=await mkdtemp(join(root,'.release/public-node-source-'));
const git=(...args)=>execFileSync('git',args,{cwd:checkout,stdio:['ignore','pipe','pipe'],timeout:120000,windowsHide:true});
git('init','--quiet');git('fetch','--quiet','--depth=1',`https://github.com/${repo}.git`,inventory.commit);git('checkout','--quiet','--detach','FETCH_HEAD');
if(git('rev-parse','HEAD').toString().trim()!==inventory.commit)throw Error('Node source revision mismatch');
for(const file of inventory.files){
  if(!/^[A-Za-z0-9_./-]+$/.test(file.path)||file.path.split('/').some(p=>!p||p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid node inventory');
  for(const directory of [checkout,join(root,'nodes')])if(canonicalSourceChecksum(await readFile(join(directory,file.path)))!==file.sha256)throw Error('Node source mismatch: '+file.path);
}
console.log(`Verified ${inventory.files.length} embedded node files against ${repo}@${inventory.commit}`);
