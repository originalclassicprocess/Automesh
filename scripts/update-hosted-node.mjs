// GitHub runner only: install a published, checksum-verified node package.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {deploymentSettings,sshArguments} from './deploy-client.mjs';
import {checkArchiveListing} from './download-app-release.mjs';

export function nodeUpdateSettings(env) {
  const app=deploymentSettings(env),home='/home/'+app.user;
  const origin=new URL(env.NODE_ORIGIN);
  if(origin.protocol!=='https:'||origin.origin!==env.NODE_ORIGIN||origin.username||origin.password||origin.port||
    !/^node\.[a-z0-9.-]+$/.test(origin.hostname)||origin.origin===app.origin)throw Error('invalid_node_origin');
  if(!/^\d+-\d+$/.test(app.runId))throw Error('github_run_required');
  return {...app,home,root:home+'/automesh-node-app',node:home+'/nodevenv/automesh-node-app/24/bin/node',
    origin:origin.origin,stage:home+'/.automesh-node-updates/'+app.runId};
}
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export async function updateHostedNode(tag,env=process.env) {
  const c=nodeUpdateSettings(env);
  if(!/^v\d+\.\d+\.\d+$/.test(tag)||!env.GITHUB_TOKEN||!/^[-A-Za-z0-9_]+\/[-A-Za-z0-9_.]+$/.test(env.GITHUB_REPOSITORY||''))throw Error('release_context_required');
  if(!env.SSH_PRIVATE_KEY?.includes('PRIVATE KEY-----')||!env.SSH_KNOWN_HOSTS?.trim())throw Error('ssh_credentials_missing');
  const headers={Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const api=async p=>{const r=await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${p}`,{headers,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('release_metadata_unavailable');return r.json();};
  const release=await api('releases/tags/'+tag),ref=await api('git/ref/tags/'+tag);
  if(release.draft||release.tag_name!==tag||ref.object.type!=='commit'||release.target_commitish!==ref.object.sha)throw Error('release_commit_mismatch');
  const version=JSON.parse(readFileSync(new URL('../nodes/package.json',import.meta.url))).version;
  const asset=release.assets.find(a=>a.name===`Automesh-Server-Node-${version}-cPanel.tar.gz`);
  if(!asset||asset.size>4*1024*1024||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw Error('node_asset_missing');
  const response=await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/releases/assets/${asset.id}`,{headers:{...headers,Accept:'application/octet-stream'},signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('node_asset_unavailable');const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length!==asset.size||'sha256:'+createHash('sha256').update(bytes).digest('hex')!==asset.digest)throw Error('node_asset_checksum');
  const temp=mkdtempSync(join(tmpdir(),'automesh-node-update-'));
  try {
    const key=join(temp,'key'),hosts=join(temp,'known_hosts'),archive=join(temp,'server.tar.gz');
    writeFileSync(key,env.SSH_PRIVATE_KEY.trim()+'\n',{mode:0o600});writeFileSync(hosts,env.SSH_KNOWN_HOSTS.trim()+'\n',{mode:0o600});writeFileSync(archive,bytes);
    const run=(bin,args,options={})=>execFileSync(bin,args,{encoding:'utf8',timeout:300000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe'],...options});
    checkArchiveListing(run('tar',['-tzf',archive]),run('tar',['-tvzf',archive]));
    const options=sshArguments(c,key,hosts),target=c.user+'@'+c.host;
    const remote=source=>{try{return run('ssh',['-T','-p',c.port,...options,target,quote(c.node)+' --input-type=module -'],{input:'const c='+JSON.stringify(c)+';\n'+source});}catch(e){
      const safe=(e.stderr||'').toString().match(/NODE_UPDATE_ERROR:([a-z0-9_]+)/);throw Error(safe?safe[1]:'remote_node_update_failed');}};
    c.version=version;c.sha256=asset.digest.slice(7);
    const lifecycle=resolve('server/deployment.mjs'),worker=resolve('scripts/update-hosted-node-worker.mjs');
    c.lifecycleHash=createHash('sha256').update(readFileSync(lifecycle)).digest('hex');c.workerHash=createHash('sha256').update(readFileSync(worker)).digest('hex');
    remote(`import fs from 'node:fs';import path from 'node:path';try{
      for(const p of [c.home,c.root,path.join(c.home,'.automesh-node-data'),path.join(c.home,'.automesh-node-private')]){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid())throw Error('unsafe_node_path');}
      const config=JSON.parse(fs.readFileSync(path.join(c.home,'.automesh-node-private/config.json')));if(config.publicUrl!==c.origin)throw Error('node_target_mismatch');
      const base=path.dirname(c.stage);if(!fs.existsSync(base))fs.mkdirSync(base,{mode:0o700});const s=fs.lstatSync(base);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw Error('unsafe_stage');fs.mkdirSync(c.stage,{mode:0o700});
    }catch(e){console.error('NODE_UPDATE_ERROR:'+(/^[a-z_]+$/.test(e.message)?e.message:'preflight_failed'));process.exitCode=1;}`);
    for(const [from,name] of [[archive,'server.tar.gz'],[lifecycle,'deployment.mjs'],[worker,'worker.mjs']])run('scp',['-P',c.port,...options,from,target+':'+c.stage+'/'+name]);
    const result=remote(`import fs from 'node:fs';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';try{
      const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      if(hash(c.stage+'/worker.mjs')!==c.workerHash||hash(c.stage+'/deployment.mjs')!==c.lifecycleHash||hash(c.stage+'/server.tar.gz')!==c.sha256)throw Error('uploaded_checksum');
      const{upgrade}=await import(pathToFileURL(c.stage+'/worker.mjs'));await upgrade(c);
    }catch(e){console.error('NODE_UPDATE_ERROR:'+(/^[a-z_]+$/.test(e.message)?e.message:'upgrade_failed'));process.exitCode=1;}`);
    console.log(result.trim());
  } finally {rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{await updateHostedNode(process.argv[2]);}catch(e){console.error('Node update stopped: '+e.message);process.exitCode=1;}
