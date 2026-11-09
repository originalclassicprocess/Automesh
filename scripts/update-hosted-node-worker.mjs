// Executed only in a private staging directory by the GitHub runner.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const regular=(p,dir=false)=>{const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.uid!==process.getuid()||!(dir?s.isDirectory():s.isFile()))throw Error('unsafe_update_path');};
const command=(bin,args)=>{const r=spawnSync(bin,args,{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});if(r.status!==0){
  const text=String(r.stderr??'')+' '+String(r.error?.code??'');
  const reason=/No space left|Disk quota exceeded/i.test(text)?'storage_full':/file changed as we read/i.test(text)?'backup_changed':/Permission denied/i.test(text)?'permission_denied':/Cannot open|No such file/i.test(text)?'archive_path_unavailable':/ENOMEM|Cannot allocate memory/i.test(text)?'memory_limit':'archive_operation_failed';
  const phase=args.includes('--no-same-owner')?'extract_package':args.some(a=>a.endsWith('/private.tar.gz'))?'backup_private':args.includes('-czf')?'backup_code':'restore_code';
  console.error(JSON.stringify({nodeUpdateArchive:{phase,reason,status:r.status,signal:r.signal??null}}));throw Error(phase+'_'+reason);
}return r.stdout;};
export async function upgrade(c) {
  const source=c.stage+'/source',backup=c.stage+'/backup';
  fs.mkdirSync(source,{mode:0o700});fs.mkdirSync(backup,{mode:0o700});
  command('tar',['--no-same-owner','--no-same-permissions','-xzf',c.stage+'/server.tar.gz','-C',source]);
  const{verifySharedPackage}=await import(pathToFileURL(source+'/scripts/verify-shared-package.mjs'));
  const checked=await verifySharedPackage(source),manifest=JSON.parse(fs.readFileSync(source+'/release-files.json'));
  if(checked.version!==c.version||manifest.sourceOnly!==true||manifest.files.some(f=>f.path.startsWith('node_modules/')))throw Error('wrong_node_package');
  if(fs.readFileSync(source+'/package-lock.json','utf8')!==fs.readFileSync(c.root+'/package-lock.json','utf8')){
    const old=JSON.parse(fs.readFileSync(c.root+'/package-lock.json')),next=JSON.parse(fs.readFileSync(source+'/package-lock.json'));
    // This upgrade does not install dependencies or replace cPanel's symlink.
    for(const d of [old,next]){delete d.version;delete d.packages[''].version;}
    if(JSON.stringify(old)!==JSON.stringify(next))throw Error('dependency_change_requires_install');
  }
  const privateDir=c.home+'/.automesh-node-private',data=c.home+'/.automesh-node-data';
  const configFile=privateDir+'/config.json',config=JSON.parse(fs.readFileSync(configFile));
  if(config.publicUrl!==c.origin||config.dataDirectory!==data)throw Error('node_target_mismatch');
  for(const item of manifest.files){let p=c.root;for(const part of item.path.split('/')){p=path.join(p,part);if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('destination_symlink');}}
  const{selectorLifecycle}=await import(pathToFileURL(c.stage+'/deployment.mjs')),lifecycle=selectorLifecycle(c.root);
  const importLive=async name=>import(pathToFileURL(c.root+'/'+name));
  const stable=()=>{const state=JSON.parse(fs.readFileSync(data+'/state.json'));
    return {nodeId:state.nodeId,owner:state.owner,members:state.members,primaryAddress:state.primaryAddress,master:hash(config.masterKeyFile),config:hash(configFile)};};
  let before;
  const roots=['package.json','package-lock.json','app.cjs','packages','adapters','ui','docs','scripts','test','LICENSE','THIRD_PARTY_NOTICES.md','SECURITY.md','CHANGELOG.md','README.md','README.ru.md','release-files.json','build.json'];
  let stopped=false,changed=false,releaseData;
  try {
    await lifecycle('stop');stopped=true;
    const{acquireDataLock}=await importLive('adapters/server/files.js');
    releaseData=await acquireDataLock(data);
    before=stable();
    command('tar',['-czf',backup+'/code.tar.gz','-C',c.root,'--',...roots.filter(p=>fs.existsSync(c.root+'/'+p))]);
    command('tar',['-czf',backup+'/private.tar.gz','-C',c.home,'--','.automesh-node-private','.automesh-node-data']);
    for(const name of ['code.tar.gz','private.tar.gz'])fs.chmodSync(backup+'/'+name,0o600);
    fs.writeFileSync(backup+'/preserved.json',JSON.stringify(before),{mode:0o600,flag:'wx'});
    for(const item of [...manifest.files,{path:'release-files.json'}]) {
      const to=path.join(c.root,item.path);fs.mkdirSync(path.dirname(to),{recursive:true});changed=true;fs.copyFileSync(path.join(source,item.path),to);
    }
    if(JSON.stringify(stable())!==JSON.stringify(before))throw Error('private_state_changed');
    await releaseData();releaseData=null;
    await lifecycle('start');
    const{readPassengerConfig}=await importLive('adapters/passenger/config.js'),{requestControl}=await importLive('adapters/server/runner.js');
    let status;
    for(let n=0;n<20;n++){
      try{const r=await fetch(c.origin+'/node/info',{redirect:'error',signal:AbortSignal.timeout(5000)});const info=await r.json();
        if(!r.ok||info.nodeId!==before.nodeId)throw Error('public_probe_failed');
        status=await requestControl(await readPassengerConfig(configFile),'status',undefined,config.masterKeyFile);break;
      }catch{await new Promise(r=>setTimeout(r,1000));}
    }
    if(!status||status.courier?.attachments?.maxFiles!==128||status.courier.attachments.maxFilesPerProfile!==16||JSON.stringify(stable())!==JSON.stringify(before))throw Error('node_upgrade_verification_failed');
    fs.writeFileSync(c.stage+'/complete.json',JSON.stringify({version:c.version,sha256:c.sha256,backup:true}),{mode:0o600});
    console.log(JSON.stringify({nodeVersion:c.version,maxFiles:128,maxFilesPerProfile:16,privateBackup:true,nodeIdentityAndProfilesPreserved:true}));
  }catch(error){
    if(releaseData){await releaseData();releaseData=null;}
    if(changed){
      await lifecycle('stop');command('tar',['-xzf',backup+'/code.tar.gz','-C',c.root]);
      await lifecycle('start');console.log('NODE_UPDATE_CODE_ROLLED_BACK');
    }else if(stopped)await lifecycle('start');
    throw error;
  }
}
