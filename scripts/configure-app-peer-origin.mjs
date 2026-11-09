// Operator-only: explicitly permit one peer application's browser origin.
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,posix} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {deploymentSettings,sshArguments} from './deploy-client.mjs';
export function peerOrigin(value){const u=new URL(value);if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)throw Error('Canonical HTTPS peer origin required');return u.origin;}
export async function configurePeer(env=process.env){
 const peer=peerOrigin(env.PEER_ORIGIN),c=deploymentSettings(env),temporary=mkdtempSync(join(tmpdir(),'automesh-peer-origin-'));
 const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 if(!env.SSH_PRIVATE_KEY?.includes('PRIVATE KEY-----')||!env.SSH_KNOWN_HOSTS?.trim())throw Error('SSH credentials missing');
 try{
  const key=join(temporary,'key'),hosts=join(temporary,'known_hosts');writeFileSync(key,env.SSH_PRIVATE_KEY.trim()+'\n',{mode:0o600});writeFileSync(hosts,env.SSH_KNOWN_HOSTS.trim()+'\n',{mode:0o600});
  const args=sshArguments(c,key,hosts),destination=c.user+'@'+c.host;
  const run=(bin,args,options={})=>{const r=spawnSync(bin,args,{encoding:'utf8',timeout:180000,...options});if(r.status!==0)throw Error('Peer-origin operation failed; private backup retained');return r.stdout;};
  const directory=c.root+'/.deploy-tools/peer-'+c.runId,operator=directory+'/deployment.mjs';
  run('ssh',['-T','-p',c.port,...args,destination,`umask 077 && mkdir -- ${quote(directory)}`]);
  run('scp',['-P',c.port,...args,resolve('server/deployment.mjs'),destination+':'+operator]);
  const digest=createHash('sha256').update(readFileSync('server/deployment.mjs')).digest('hex');
  const script=`
   import fs from'node:fs';import path from'node:path';import os from'node:os';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';
   const root=${JSON.stringify(c.root)},origin=${JSON.stringify(c.origin)},peer=${JSON.stringify(peer)},file=${JSON.stringify(operator)};
   try{
    if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==${JSON.stringify(digest)})throw Error('operator_checksum');
    const app=path.relative(os.homedir(),root),command=args=>{const r=spawnSync('/sbin/cloudlinux-selector',args,{encoding:'utf8',timeout:60000});let d;try{d=JSON.parse(r.stdout);}catch{}if(r.status!==0||d?.result!=='success')throw Error('selector_failed');return d;};
    const matches=[];function scan(v){if(!v||typeof v!=='object')return;if(v.applications?.[app])matches.push(v.applications[app]);for(const[k,c]of Object.entries(v))if(k!=='applications'&&k!=='env_vars')scan(c);}scan(command(['get','--json','--interpreter','nodejs']));
    if(matches.length!==1||matches[0].domain!==new URL(origin).hostname||matches[0].env_vars?.ORIGIN!==origin)throw Error('app_identity_mismatch');
    const current=matches[0].env_vars;if(Object.values(current).some(v=>typeof v!=='string'))throw Error('unexpected_env');
    const list=(current.SIGNALING_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(list.includes(peer)){console.log('Peer origin already permitted; client defaults unchanged.');}
    else{
     const next={...current,SIGNALING_ALLOWED_ORIGINS:[...list,peer].join(',')},backup=path.join(os.homedir(),'.automesh-origin-backups');
     if(!fs.existsSync(backup))fs.mkdirSync(backup,{mode:0o700});if(fs.lstatSync(backup).isSymbolicLink())throw Error('unsafe_backup');
     fs.writeFileSync(path.join(backup,${JSON.stringify(c.runId)}+'.json'),JSON.stringify(current),{flag:'wx',mode:0o600});
     const{selectorLifecycle}=await import(pathToFileURL(file)),lifecycle=selectorLifecycle(root);await lifecycle('stop');
     try{command(['set','--json','--interpreter','nodejs','--app-root',app,'--env-vars',JSON.stringify(next)]);await lifecycle('start');}
     catch(e){command(['set','--json','--interpreter','nodejs','--app-root',app,'--env-vars',JSON.stringify(current)]);await lifecycle('start');throw e;}
     console.log('Peer signaling origin configured; existing variables preserved; client defaults unchanged.');
    }
   }catch{console.error('Peer signaling configuration failed; private state retained');process.exitCode=1;}
  `;
  console.log(run('ssh',['-T','-p',c.port,...args,destination,quote(c.node)+' --input-type=module -'],{input:script}).trim());
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await configurePeer();}catch(e){console.error(e.message);process.exitCode=1;}}
