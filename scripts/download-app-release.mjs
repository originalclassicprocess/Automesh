// Download an existing private GitHub release on the runner; never build or deploy.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateRelease} from '../server/deployment.mjs';
export function checkArchiveListing(names,types){
 const paths=names.trim().split(/\r?\n/);
 if(!paths.length||paths.length>12000)throw Error('Archive size limit');
 for(let name of paths){
  if(name==='./')continue;
  name=name.replace(/^\.\//,'').replace(/\/$/,'');
  if(!/^[A-Za-z0-9_.\/-]+$/.test(name)||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe archive path');
 }
 if(types.trim().split(/\r?\n/).some(line=>!/^[-d]/.test(line)))throw Error('Archive links or special files forbidden');
}
export async function downloadAppRelease(tag,destination,env=process.env){
 if(!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)||!/^[-A-Za-z0-9_]+\/[-A-Za-z0-9_.]+$/.test(env.GITHUB_REPOSITORY||'')||!env.GITHUB_TOKEN)throw Error('Release context missing');
 const root=resolve(import.meta.dirname,'..'),out=resolve(destination),child=relative(join(root,'.release'),out);
 if(!/^automesh-[a-z0-9-]+$/.test(child)||isAbsolute(child))throw Error('New release output must be inside .release');
 const headers={Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 async function get(path){const r=await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`,{headers,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('GitHub metadata unavailable: '+r.status);return r.json();}
 const release=await get(`releases/tags/${tag}`),ref=await get(`git/ref/tags/${tag}`);
 if(release.draft||release.tag_name!==tag||ref.object.type!=='commit'||release.target_commitish!==ref.object.sha)throw Error('Release commit mismatch');
 const name=`Automesh-App-${tag.slice(1)}-update.tar.gz`,asset=release.assets.find(a=>a.name===name);
 if(!asset||asset.size<1024||asset.size>150*1024*1024||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw Error('Release artifact or GitHub checksum missing');
 const response=await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/releases/assets/${asset.id}`,{headers:{...headers,Accept:'application/octet-stream'},signal:AbortSignal.timeout(240000)});
 if(!response.ok)throw Error('Release artifact download failed: '+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length!==asset.size||'sha256:'+createHash('sha256').update(bytes).digest('hex')!==asset.digest)throw Error('Release checksum mismatch');
 await mkdir(join(root,'.release'),{recursive:true});
 const archive=join(root,'.release',name);await writeFile(archive,bytes,{flag:'wx'});
 const tar=args=>execFileSync('tar',args,{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
 checkArchiveListing(tar(['-tzf',archive]),tar(['-tvzf',archive]));
 await mkdir(out);
 tar(['--no-same-owner','--no-same-permissions','-xzf',archive,'-C',out]);
 const validated=validateRelease(out);
 console.log(JSON.stringify({release:tag,commit:ref.object.sha,asset:name,sha256:asset.digest,validated:true}));
 return validated;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await downloadAppRelease(process.argv[2],process.argv[3]);}catch(error){console.error(error.message);process.exitCode=1;}
}
