// Isolated public fixtures only: actual browser QR, MAE, node HTTP auth/queues.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createApplicationServer } from '../server/application.js';
import { createHomeNode } from '../nodes/packages/runtime/src/application.js';
import { protector } from '../nodes/test/fixtures.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2], 'playwright/index.mjs')).href);
const root=resolve(import.meta.dirname,'..'),origin='http://127.0.0.1:5196',nodeOrigin=process.argv.includes('--home-node')?'https://192.168.0.138:3003':'https://node.device.test';
const directory=await mkdtemp(join(tmpdir(),'automesh-pairing-')),hosts=['127.0.0.1:0'];
const node=await createHomeNode({directory,hosts,origins:[origin],adminToken:'a'.repeat(64),testHttp:true,secretProtector:protector()});
const listener=node.createPublicServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
const nodeBase=`http://127.0.0.1:${listener.address().port}`;hosts.push(new URL(nodeBase).host);
const signal=createApplicationServer((_req,res)=>{res.statusCode=404;res.end();},{origin});signal.app.listen(0,'127.0.0.1');await once(signal.app,'listening');
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5196','--strictPort'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_MESH_SIGNALING_URL:`ws://127.0.0.1:${signal.app.address().port}/signal`}});
let browser,diagnostic='';server.stderr.on('data',v=>diagnostic=(diagnostic+v).slice(-3000));
const errors=[],responses=[],requests=[],password='Public-owner-password-2026',devicePassword='Public-device-password-2026';
const phrases=['abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about','legal winner thank year wave sausage worth useful legal winner thank yellow','letter advice cage absurd amount doctor acoustic avoid letter advice cage above','zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'];
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(check,description,timeout=30000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await pause(100);}throw Error(description);}
async function context(faults={}){
  const ctx=await browser.newContext();
  if(process.argv.includes('--history-only'))await ctx.addInitScript(()=>{
    const Native=window.RTCPeerConnection;window.__historyFixturePCs=[];
    window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);window.__historyFixturePCs.push(this);}};
  });
  if(process.argv.includes('--trace-chat-transport'))await ctx.addInitScript(()=>{
    const trace=[];window.__chatFixtureTrace=trace;const record=value=>{trace.push({at:Date.now(),...value});if(trace.length>160)trace.shift();};
    const NativeRTC=window.RTCPeerConnection;let serial=0;
    window.RTCPeerConnection=class extends NativeRTC{constructor(...args){super(...args);const id=++serial;this.__fixtureId=id;record({kind:'rtc-created',id});for(const event of ['connectionstatechange','iceconnectionstatechange'])this.addEventListener(event,()=>record({kind:event,id,state:this.connectionState,ice:this.iceConnectionState}));this.addEventListener('datachannel',event=>this.__watch(event.channel));}__watch(channel){channel.addEventListener('open',()=>record({kind:'channel-open',id:this.__fixtureId}));channel.addEventListener('close',()=>record({kind:'channel-close',id:this.__fixtureId}));return channel;}createDataChannel(...args){return this.__watch(super.createDataChannel(...args));}};
    const NativeWS=window.WebSocket;
    window.WebSocket=class extends NativeWS{constructor(...args){super(...args);this.addEventListener('message',event=>{try{const value=JSON.parse(event.data);if(['registered','registration_rejected','peer_online','peer_offline','peer_unavailable','connect_request','offer','answer'].includes(value.type))record({kind:'signal',type:value.type,attempt:value.attemptId});}catch{}});this.addEventListener('close',event=>record({kind:'signal-close',code:event.code}));}};
    window.__chatFixtureDiagnostics=import('/src/lib/chat/ChatService.ts').then(({ChatService})=>{
      const services=[],init=ChatService.prototype.init,send=ChatService.prototype.sendSigned, control=ChatService.prototype.onDeviceControl;
      const activeControls=new Map(),activePayloads=new Map(),activeCrypto=new Map(),activeSigned=new Map();let controlId=0,activeId=0;
      const payload=ChatService.prototype.sendPayload;
      ChatService.prototype.sendPayload=async function(content,...args){const id=activeId++;activePayloads.set(id,typeof content==='string'&&content.startsWith('\0')?content.split(':').slice(0,content.startsWith('\0automesh-devices')?2:1).join(':'):'message');try{return await payload.call(this,content,...args);}finally{activePayloads.delete(id);}};
      ChatService.prototype.onDeviceControl=function(handler){const handlerId=controlId++;return control.call(this,async(peer,kind,value)=>{const id=activeId++;activeControls.set(id,{handlerId,kind});try{return await handler(peer,kind,value);}finally{activeControls.delete(id);}});};
      ChatService.prototype.init=function(...args){services.push(this);this.onPeerChange((_peer,event)=>record({kind:'secure-peer',event}));const result=init.apply(this,args),sessions=this.secureSessions,encrypt=sessions.encrypt;sessions.encrypt=async function(...args){const id=activeId++;activeCrypto.set(id,{phase:this.sessions.get(args[0])?.phase??'absent'});try{return await encrypt.apply(this,args);}finally{activeCrypto.delete(id);}};return result;};
      ChatService.prototype.sendSigned=async function(bytes,...args){record({kind:'secure-tx',type:bytes?.[4]});const id=activeId++;activeSigned.set(id,bytes?.[4]);try{return await send.call(this,bytes,...args);}finally{activeSigned.delete(id);}};
      window.__chatFixtureState=()=>services.map(service=>({activeControls:[...activeControls.values()],activePayloads:[...activePayloads.values()],activeCrypto:[...activeCrypto.values()],activeSigned:[...activeSigned.values()],waiters:service.secureSessions?.waiters.size,securePeers:service.securePeers.size,sessions:[...(service.secureSessions?.sessions.values()??[])].map(value=>value.phase),starts:service.secureSessions?.starts.size,responding:service.secureSessions?.responding.size,sendQueues:service.sendQueues.size,receiveQueues:service.receiveQueues.size,routes:service.transport.routes?.size,connected:service.transport.connected?.size,nodes:service.transport.nodes?.map(node=>({status:node.status,connected:node.transport.connectedPeers?.size,channels:[...(node.transport.channels?.values()??[])].map(channel=>channel.readyState)}))}));
    }).catch(()=>{});
  });
  ctx.on('page',page=>page.on('pageerror',e=>{errors.push(e.message);if(process.argv.includes('--chat-ux-only'))console.error('Chat fixture page error:',e.message);}));
  await ctx.route(nodeOrigin+'/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    requests.push(path);
    try{
      if(path==='/devices/publish'&&faults.denyPublish){await route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'device_denied'})});return;}
      const headers={...req.headers(),host:new URL(nodeBase).host};delete headers['content-length'];
      const result=await fetch(nodeBase+path,{method:req.method(),headers,...(req.method()==='POST'?{body:req.postData()}:{})});
      const body=Buffer.from(await result.arrayBuffer());if(result.status>=400)responses.push({path,status:result.status});
      await route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body});
    }catch{await route.abort();}
  });
  await ctx.route(origin+'/api/device-pair/**',route=>{
    const body=route.request().postData()??'';assert.doesNotMatch(body,/Independent fixture phone|Direct fixture phone|Contact fixture|mnemonic|deviceKey/,'Rendezvous exposed plaintext identity/contact content');return route.continue();
  });return ctx;
}
async function prepare(page,phrase,{peer='',personal=false,noNode=false}={}){
  await page.goto(origin);await page.locator('[data-navigation-ready="true"]').waitFor({state:'attached'});
  return page.evaluate(async({phrase,password,peer,personal,noNode,nodeOrigin,nodeId,courier,directoryKey})=>{
    const {accountFromMnemonic}=await import('/src/lib/application/account.ts');const {saveVault}=await import('/src/lib/vault/vault.ts');
    const {createIdentityMetadata}=await import('/src/lib/identity/metadata.ts');const {deriveChatStoreKey,saveLocalChatData}=await import('/src/lib/chat/local-store.ts');
    const {emptyCourierState}=await import('/src/lib/node/courier-state.ts');const {emptyOfflineState}=await import('/src/lib/node/offline-state.ts');
    const account=await accountFromMnemonic(phrase);await saveVault(new TextEncoder().encode(phrase),password,createIdentityMetadata(),true);
    let owner=account.accountId,seed=account.identitySeed,provider=account.provider;
    if(personal){const {openBrowserProfileBundle}=await import('/src/lib/profiles/browser.ts');const {deriveProfileSeed}=await import('/src/lib/profiles/keys.ts');const {WebCryptoIdentity}=await import('/src/lib/identity/webcrypto.ts');const {accountIdFromPublicKey}=await import('/src/lib/addressing/account-id.js');
      const bundle=await openBrowserProfileBundle({root:seed,scope:owner,trusted:true});try{const registry=await bundle.initializePersonal(),profile=registry.profiles.find(p=>p.role==='personal');seed=await deriveProfileSeed(account.identitySeed,profile.index,crypto.subtle);provider=new WebCryptoIdentity();await provider.fromSeed(seed);owner=await accountIdFromPublicKey(await provider.getPublicKeyBytes());}finally{bundle.close();}}
    const courierState=noNode||personal?emptyCourierState():{...emptyCourierState(),enabled:true,node:{url:nodeOrigin,nodeId,address:courier}};
    const offlineState=personal?{...emptyOfflineState(),enabled:true,node:{url:nodeOrigin,nodeId}}:emptyOfflineState();
    const deviceSettings={enabled:true,allowCached:false,peers:[],authority:noNode||personal?null:{nodeId,publicKey:directoryKey,url:nodeOrigin}};
    const data={deviceSettings,offlineState,selfNickname:'Public fixture',readReceiptsEnabled:false,autoLockMinutes:15,peerReadPreferences:{},aliases:peer?{[peer]:'Contact fixture'}:{},declaredNames:{},peerPublicKeys:{},courierState,chats:{order:peer?[peer]:[],byPeer:peer?{[peer]:{messages:[],contact:'accepted'}}:{}}};
    await saveLocalChatData(await deriveChatStoreKey(seed,owner),owner,data);
    const result={address:owner,publicKey:[...await provider.getPublicKeyBytes()].map(b=>b.toString(16).padStart(2,'0')).join('')};seed.fill(0);provider.dispose();account.identitySeed.fill(0);account.provider.dispose();return result;
  },{phrase,password,peer,personal,noNode,nodeOrigin,nodeId:node.state.value.nodeId,courier:node.courier.address,directoryKey:node.courier.publicKey});
}
async function unlock(page,secret=password){await page.reload();await page.getByLabel('Пароль',{exact:true}).fill(secret);assert.equal(await page.getByRole('button',{name:'Войти как подключённое устройство',exact:true}).count(),0);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Настройки',exact:true}).waitFor({timeout:35000});}
async function manager(page){await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:/Безопасность/}).first().click();const panel=page.getByRole('region',{name:'Устройства аккаунта'});await panel.getByRole('button',{name:'Подключить новое устройство',exact:true}).waitFor();return panel;}
async function headers(page,label){
  const geometry=()=>page.locator('.account-header').evaluate(h=>{const rect=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(n=>Math.round(n*10)/10);};return {header:rect(h),actions:rect(h.querySelector('.header-actions')),buttons:[...h.querySelectorAll('.header-actions button')].filter(e=>e.getBoundingClientRect().width>0).map(rect)};});
  for(const width of [320,390,600,1024,1280,1920]){await page.setViewportSize({width,height:900});const before=await geometry();await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('heading',{name:'Настройки',exact:true}).waitFor();assert.deepEqual(await geometry(),before);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(width===390||width===1920)await page.screenshot({path:resolve(root,`.release/pairing-${label}-settings-${width}.png`),fullPage:true});await page.getByRole('button',{name:'Назад',exact:true}).click();await page.getByRole('button',{name:'Настройки',exact:true}).waitFor();assert.deepEqual(await geometry(),before);}
  await page.setViewportSize({width:1280,height:900});
}
async function enroll(panel,page,label,{reload=true}={}){
  await panel.getByRole('button',{name:'Подключить новое устройство',exact:true}).click();
  await panel.getByLabel('Ссылка подключения',{exact:true}).waitFor({timeout:35000});
  const link=await panel.getByLabel('Ссылка подключения',{exact:true}).inputValue();
  assert.equal(await panel.locator('img[alt="QR заявки устройства"]').count(),0);
  const decoded=await panel.locator('img[alt="QR подключения нового устройства"]').evaluate(async img=>{const {readQrImage}=await import('/src/lib/transport/qr-reader.ts');const bytes=Uint8Array.from(atob(img.src.split(',')[1]),c=>c.charCodeAt(0));return readQrImage(new File([bytes],'invite.png',{type:'image/png'}));});assert.equal(decoded,link);
  await page.goto(link);const region=page.getByRole('region',{name:'Подключение нового устройства'});
  await region.getByText('Название устройства',{exact:true}).click();await region.getByLabel('Название устройства',{exact:true}).fill(label);
  await region.getByLabel('Пароль этого устройства',{exact:true}).fill(devicePassword);await region.getByRole('button',{name:'Подключить',exact:true}).click();
  await region.locator('.code').waitFor();const code=(await region.locator('.code').textContent()).trim();
  if(reload){await page.reload();await region.getByLabel('Пароль',{exact:true}).fill(devicePassword);await region.getByRole('button',{name:'Войти',exact:true}).click();await region.locator('.code').waitFor();assert.equal((await region.locator('.code').textContent()).trim(),code);}
  await panel.locator('.code').waitFor({timeout:30000});assert.equal((await panel.locator('.code').textContent()).trim(),code);
  assert.equal(await region.locator('img').count(),0,'No reverse QR');assert.equal(await region.getByLabel('Адрес владельца',{exact:true}).count(),0);
  assert.equal(await panel.getByRole('button',{name:'Разрешить вход',exact:true}).isDisabled(),true);
  await panel.getByLabel('Код совпадает на обоих устройствах',{exact:true}).check();await panel.getByRole('button',{name:'Разрешить вход',exact:true}).click();
  const workspace=page.getByRole('region',{name:'Чаты подключённого устройства'});await workspace.getByRole('button',{name:'Настройки',exact:true}).waitFor({timeout:40000});
  await panel.getByRole('button',{name:'К списку устройств',exact:true}).waitFor({timeout:30000});assert.equal((await panel.locator('.code').textContent()).trim(),code,'Code retained through completion');
  await panel.getByRole('button',{name:'К списку устройств',exact:true}).click();
  const id=await page.evaluate(()=>localStorage.getItem('automesh-device-lab-id-v1'));assert.ok(id);assert.equal(await page.evaluate(()=>localStorage.getItem('vault')),null);return {workspace,id};
}
async function send(page,peer,text){await closeSettings(page);await page.locator(`.conversation-row[title="${peer}"]`).click();await page.getByLabel('Сообщение',{exact:true}).fill(text);await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();}
async function addNode(panel){await panel.getByRole('button',{name:'Добавить ноду для доставки',exact:true}).click();await panel.getByLabel('Приглашение или адрес ноды',{exact:true}).fill(nodeOrigin);await panel.getByRole('button',{name:'Подключить ноду',exact:true}).click();await panel.getByText('Доставка через ноду · первое устройство можно выключить.',{exact:true}).waitFor({timeout:35000});}
async function closeSettings(page){for(let i=0;i<32&&await page.getByRole('button',{name:'Назад',exact:true}).count();i++){await page.getByRole('button',{name:'Назад',exact:true}).click();await page.waitForTimeout(120);}await page.getByRole('button',{name:'Настройки',exact:true}).waitFor();}
async function connectionPage(page){await closeSettings(page);await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:/Связь и ноды/}).first().click();await page.getByRole('region',{name:'Обзор подключений',exact:true}).waitFor();}
async function deliveryRole(page){await connectionPage(page);await page.locator('nav[aria-label="Связь и ноды"]').getByRole('button',{name:/Ноды доставки/}).click();await page.getByRole('button',{name:'Использовать для доставки',exact:true}).click();await page.getByText(/Очередь доступна/).waitFor({timeout:35000});}
async function networkScreens(page){
  await connectionPage(page);
  for(const name of ['Сигналинг','Прямое подключение','Ноды доставки','Диагностика доставки','Параметры сети','Восстановление связи']){
    await page.locator('nav[aria-label="Связь и ноды"]').getByRole('button',{name:new RegExp(name)}).click();
    for(const width of [390,1920]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(name==='Ноды доставки'||name==='Восстановление связи')await page.screenshot({path:resolve(root,`.release/network-${name==='Ноды доставки'?'nodes':'recovery'}-${width}.png`),fullPage:true});}
    await page.locator('.settings-subnav button').click();
  }
  await page.setViewportSize({width:1280,height:900});await closeSettings(page);
}
async function primaryBaseline(){
  for(const noNode of [true,false]){
    const ac=await context(),bc=await context(),a=await ac.newPage(),b=await bc.newPage();
    const alice=await prepare(a,phrases[0],{noNode}),bob=await prepare(b,phrases[1],{peer:alice.address,noNode});
    await prepare(a,phrases[0],{peer:bob.address,noNode});
    if(!noNode)await node.state.change(next=>{next.owner=alice;next.primaryAddress=alice.address;next.senders=[bob.address];next.members=[{...alice,senders:[bob.address]},{...bob,senders:[alice.address]}];});
    await unlock(a);await unlock(b);
    await send(a,bob.address,'Primary direct A to B');await b.locator(`.conversation-row[title="${alice.address}"]`).click();
    await b.locator('.message-text').filter({hasText:'Primary direct A to B'}).waitFor({timeout:35000});
    await send(b,alice.address,'Primary direct B to A');await a.locator('.message-text').filter({hasText:'Primary direct B to A'}).waitFor({timeout:35000});
    assert.equal(requests.some(p=>p.startsWith('/devices/')),false,'A node pin must not activate delegated delivery for seed-only accounts');
    if(!noNode){
      // Wait for accepted peers to exchange real offline prekeys, without enrolling a device.
      await until(()=>a.evaluate(async peer=>{const {accountFromMnemonic}=await import('/src/lib/application/account.ts');const {deriveChatStoreKey,loadLocalChatData}=await import('/src/lib/chat/local-store.ts');const x=await accountFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');try{const d=await loadLocalChatData(await deriveChatStoreKey(x.identitySeed,x.accountId),x.accountId),s=d?.courierState,bundle=s?.bundles[peer];return !!bundle&&bundle.body.expiresAt>Date.now()&&bundle.body.keys.some(k=>!s.used[k.id]);}finally{x.identitySeed.fill(0);x.provider.dispose();}},bob.address),'recipient prekeys');
      await b.close();await send(a,bob.address,'Primary offline queued on node');
      await until(()=>[...node.courier.box.records.values()].some(r=>r.sender===alice.address),'ordinary courier deposit');
      await a.close();const restored=await bc.newPage();await restored.goto(origin);await unlock(restored);
      await restored.locator(`.conversation-row[title="${alice.address}"]`).click();
      await restored.locator('.message-text').filter({hasText:'Primary offline queued on node'}).waitFor({timeout:35000});
      assert.equal(await restored.locator('.message-text').filter({hasText:'Primary offline queued on node'}).count(),1,'No duplicate after receive');
    }
    await ac.close();await bc.close();console.log(`Passed primary baseline: bidirectional authenticated direct delivery ${noNode?'without node':'with node pin; offline courier receive after sender closed'}.`);
  }
  assert.equal(requests.some(p=>p.startsWith('/devices/')),false);assert.deepEqual(errors,[]);
}
async function historyBaseline(){
  const ac=await context(),bc=await context(),cc=await context(),a=await ac.newPage(),b=await bc.newPage(),c=await cc.newPage();
  const alice=await prepare(a,phrases[0],{noNode:true}),bob=await prepare(b,phrases[1],{peer:alice.address,noNode:true});
  await prepare(a,phrases[0],{peer:bob.address,noNode:true});
  const expectedHash=await a.evaluate(async({phrase,peer})=>{
    const {accountFromMnemonic}=await import('/src/lib/application/account.ts');
    const {deriveChatStoreKey,loadLocalChatData,saveLocalSessionData}=await import('/src/lib/chat/local-store.ts');
    const {sha256Hex}=await import('/src/lib/chat/file-transfer.ts');
    const account=await accountFromMnemonic(phrase),key=await deriveChatStoreKey(account.identitySeed,account.accountId);
    try{
      const data=await loadLocalChatData(key,account.accountId),bytes=new Uint8Array(1024*1024).map((_,i)=>(i*31)%251),hash=await sha256Hex(bytes);
      const old=Date.now()-86400000,fileId='20000000-0000-4000-8000-000000000002';
      data.chats.byPeer[peer].messages=[
        {id:'20000000-0000-4000-8000-000000000001',from:peer,text:'Historical fixture text',timestamp:old,direction:'incoming',readState:'sent'},
        {id:fileId,from:account.accountId,text:'Historical file caption',timestamp:old+1,direction:'outgoing',delivery:'delivered',fileStatus:'ready',fileProgress:bytes.length,
          file:{id:fileId,name:'old-history.bin',mime:'application/octet-stream',size:bytes.length,sha256:hash}},
        {id:'20000000-0000-4000-8000-000000000003',from:peer,text:'Protected history must not transfer',timestamp:old+2,direction:'incoming',readState:'sent',details:{ephemeral:{views:1,allowDownload:false}}}
      ];
      const files=new Map([[`${peer}:${fileId}`,bytes]]),canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);
      for(const [suffix,mime,extension] of [['4','image/png','png'],['5','image/jpeg','jpg']]){
        const image=Uint8Array.from(atob(canvas.toDataURL(mime).split(',')[1]),c=>c.charCodeAt(0)),imageId=`20000000-0000-4000-8000-00000000000${suffix}`;
        data.chats.byPeer[peer].messages.push({id:imageId,from:peer,text:`Historical ${extension} caption`,timestamp:old+Number(suffix),direction:'incoming',fileStatus:'ready',file:{id:imageId,name:`old-history.${extension}`,mime,size:image.length,sha256:await sha256Hex(image)}});
        files.set(`${peer}:${imageId}`,image);
      }
      data.chats.order.unshift(account.accountId);data.chats.byPeer[account.accountId]={contact:'accepted',messages:[{id:'20000000-0000-4000-8000-000000000006',from:account.accountId,text:'Saved historical fixture',timestamp:old-1,direction:'outgoing',delivery:'delivered'}]};
      await saveLocalSessionData(key,account.accountId,data,files);for(const content of files.values())content.fill(0);return hash;
    }finally{account.identitySeed.fill(0);account.provider.dispose();}
  },{phrase:phrases[0],peer:bob.address});
  await unlock(a);await unlock(b);const panel=await manager(a),linked=await enroll(panel,c,'History fixture phone');
  await linked.workspace.locator(`.conversation-row[title="${bob.address}"]`).waitFor({timeout:30000});
  const openTransfer=async attachments=>{
    await panel.getByRole('button',{name:'Перенести историю: History fixture phone',exact:true}).click();
    const sendPanel=a.getByRole('region',{name:'Перенос истории на устройство',exact:true});
    await sendPanel.getByRole('checkbox',{name:/Contact fixture/}).check();
    await sendPanel.getByRole('checkbox',{name:/Сохранённые/}).check();
    await sendPanel.getByRole('checkbox',{name:'Включить доступные вложения',exact:true}).setChecked(attachments);
    for(const width of [320,390,1920]){await a.setViewportSize({width,height:900});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    await a.setViewportSize({width:1280,height:900});
    await sendPanel.getByRole('button',{name:'Подготовить и предложить перенос',exact:true}).click();
    const receivePanel=c.getByRole('region',{name:'Получение старой истории',exact:true});await receivePanel.getByRole('button',{name:'Принять историю',exact:true}).waitFor({timeout:35000});
    return {sendPanel,receivePanel};
  };
  const cancelled=await openTransfer(false);
  await cancelled.sendPanel.getByRole('button',{name:'Остановить и закрыть перенос',exact:true}).click();
  await cancelled.receivePanel.getByText('Перенос остановлен. Рабочая переписка не изменена.',{exact:true}).waitFor();
  const first=await openTransfer(true);
  console.log('History fixture: real device enrollment and consent offer ready.');
  await a.setViewportSize({width:390,height:900});await a.screenshot({path:resolve(root,'.release/history-owner-390.png'),fullPage:true});await a.setViewportSize({width:1280,height:900});
  await c.setViewportSize({width:390,height:900});assert.equal(await c.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await c.screenshot({path:resolve(root,'.release/history-receive-390.png'),fullPage:true});await c.setViewportSize({width:1280,height:900});
  await c.locator(`.conversation-row[title="${bob.address}"]`).click();assert.equal(await c.locator('.message-text').filter({hasText:'Historical fixture text'}).count(),0);
  await send(b,alice.address,'Live before history consent');await c.locator('.message-text').filter({hasText:'Live before history consent'}).waitFor({timeout:35000});
  await first.receivePanel.getByRole('button',{name:'Принять историю',exact:true}).click();
  await c.getByRole('progressbar',{name:'Получение истории',exact:true}).waitFor({timeout:30000});
  await until(()=>c.getByRole('progressbar',{name:'Получение истории',exact:true}).getAttribute('value').then(value=>Number(value)>0),'first history chunk');
  await c.evaluate(()=>{for(const pc of window.__historyFixturePCs)if(pc.connectionState!=='closed')pc.close();});
  await send(b,alice.address,'Live during history transfer');
  await c.locator('.message-text').filter({hasText:'Live during history transfer'}).waitFor({timeout:35000});
  await first.sendPanel.getByText('История сохранена на устройстве. Перенос завершён.',{exact:true}).waitFor({timeout:90000});
  console.log('History fixture: resumed after real WebRTC interruption, live text arrived, archive committed.');
  await first.receivePanel.getByRole('button',{name:'Скрыть перенос',exact:true}).click();
  await c.locator('.message-text').filter({hasText:'Historical fixture text'}).waitFor();
  assert.equal(await c.locator('.message-text').filter({hasText:'Protected history must not transfer'}).count(),0);
  assert.equal(await c.locator('.conversation-row').first().getAttribute('title'),alice.address);
  assert.match(await c.locator(`.conversation-row[title="${bob.address}"] .chat-preview`).innerText(),/Live during/);
  await c.getByRole('button',{name:/^Мой профиль:/}).click();
  const profileDialog=c.getByRole('dialog',{name:'Мой профиль',exact:true}),publicQr=profileDialog.getByAltText('QR-код моего Account ID',{exact:true});await publicQr.waitFor();
  assert.equal(await publicQr.evaluate(async img=>{const {readQrImage}=await import('/src/lib/transport/qr-reader.ts');const bytes=Uint8Array.from(atob(img.src.split(',')[1]),c=>c.charCodeAt(0));return readQrImage(new File([bytes],'public-id.png',{type:'image/png'}));}),alice.address);
  await profileDialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  for(const extension of ['png','jpg']){
    const image=c.getByRole('button',{name:`Открыть изображение old-history.${extension}`,exact:true});
    await c.locator('.chat-message').filter({hasText:`Historical ${extension} caption`}).scrollIntoViewIfNeeded();await image.waitFor();
    await until(()=>image.locator('img').evaluate(img=>img.complete&&img.naturalWidth===32),'verified image preview');
    await image.click();const viewer=c.getByRole('dialog',{name:'Просмотр фото и видео',exact:true});await viewer.getByAltText(`old-history.${extension}`,{exact:true}).waitFor();
    await viewer.getByRole('button',{name:'Действия с медиа',exact:true}).click();assert.equal(await viewer.getByRole('button',{name:'Переслать',exact:true}).isDisabled(),true);
    await viewer.getByRole('button',{name:'Закрыть просмотр',exact:true}).click();
  }
  await c.locator('.chat-message').filter({hasText:'Historical file caption'}).getByRole('button',{name:'Открыть сохранённое вложение',exact:true}).click();
  const downloadLink=c.getByRole('link',{name:'Скачать old-history.bin',exact:true});await downloadLink.waitFor();
  const [download]=await Promise.all([c.waitForEvent('download'),downloadLink.click()]);
  const path=join(directory,'received-old-history.bin');await download.saveAs(path);
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),expectedHash);
  assert.equal(await c.evaluate(()=>localStorage.getItem('vault')),null);
  await first.sendPanel.getByRole('button',{name:'Закрыть перенос',exact:true}).click();
  await c.reload();await c.getByLabel('Пароль',{exact:true}).fill('Incorrect-fixture-password-2026');await c.waitForTimeout(1200);
  assert.equal(await c.getByLabel('Пароль',{exact:true}).inputValue(),'Incorrect-fixture-password-2026');
  assert.equal(await c.getByRole('alert').count(),0);
  await c.getByLabel('Пароль',{exact:true}).fill(devicePassword);await c.getByRole('region',{name:'Чаты подключённого устройства',exact:true}).waitFor({timeout:30000});
  await c.locator(`.conversation-row[title="${bob.address}"]`).click();
  await c.locator('.message-text').filter({hasText:'Historical fixture text'}).waitFor();
  await c.locator('.message-text').filter({hasText:'Live during history transfer'}).waitFor();
  const repeated=await openTransfer(false);await repeated.receivePanel.getByRole('button',{name:'Принять историю',exact:true}).click();
  await repeated.sendPanel.getByText('История сохранена на устройстве. Перенос завершён.',{exact:true}).waitFor({timeout:90000});
  assert.equal(await c.locator('.message-text').filter({hasText:'Historical fixture text'}).count(),1);
  await c.locator('.chat-message').filter({hasText:'Historical file caption'}).getByRole('button',{name:'Открыть сохранённое вложение',exact:true}).click();await c.getByRole('link',{name:'Скачать old-history.bin',exact:true}).waitFor();
  const composer=c.getByRole('textbox',{name:'Сообщение',exact:true});await composer.fill('Line one');await composer.press('Shift+Enter');await composer.pressSequentially('Line two');
  assert.equal(await composer.inputValue(),'Line one\nLine two');await composer.fill('Live reply after historical merge');await composer.press('Enter');
  await b.locator('.message-text').filter({hasText:'Live reply after historical merge'}).waitFor({timeout:35000});
  await until(()=>c.locator('.chat-message').filter({hasText:'Live reply after historical merge'}).locator('.delivery-status.confirmed').count().then(n=>n===1),'confirmed green status');
  await composer.fill('ab');await composer.press('ArrowLeft');await c.getByRole('button',{name:'Выбрать эмодзи',exact:true}).click();await c.getByRole('button',{name:'Вставить 😀',exact:true}).click();
  assert.equal(await composer.inputValue(),'a😀b');await c.getByRole('button',{name:'Закрыть эмодзи',exact:true}).click();await composer.fill('');
  for(const theme of ['light','dark']){
    await c.getByRole('button',{name:'Настройки',exact:true}).click();await c.getByRole('button',{name:/Приложение/}).first().click();await c.getByLabel('Цветовая тема').selectOption(theme);await closeSettings(c);
    for(const width of [320,390,1920]){await c.setViewportSize({width,height:900});assert.equal(await c.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(width!==320)await c.screenshot({path:resolve(root,`.release/linked-chat-${theme}-${width}.png`),fullPage:true});}
  }
  await c.setViewportSize({width:1280,height:900});
  await c.locator('.chat-message').filter({hasText:'Historical file caption'}).getByRole('button',{name:'Действия с сообщением',exact:true}).click();
  await c.getByRole('dialog',{name:'Действия с сообщением',exact:true}).getByRole('button',{name:'Удалить у меня',exact:true}).click();
  await until(async()=>await c.locator('.message-text').filter({hasText:'Historical file caption'}).count()===0,'historical file deleted');
  await repeated.sendPanel.getByRole('button',{name:'Закрыть перенос',exact:true}).click();
  const afterDeletion=await openTransfer(true);await afterDeletion.receivePanel.getByRole('button',{name:'Принять историю',exact:true}).click();
  await afterDeletion.sendPanel.getByText('История сохранена на устройстве. Перенос завершён.',{exact:true}).waitFor({timeout:90000});
  assert.equal(await c.locator('.message-text').filter({hasText:'Historical file caption'}).count(),0);
  await c.getByRole('button',{name:'Настройки',exact:true}).click();await c.getByRole('button',{name:/Безопасность/}).first().click();
  c.once('dialog',dialog=>dialog.accept());await c.getByRole('button',{name:'Удалить перенесённую историю и вложения',exact:true}).click();
  await until(async()=>await c.getByRole('button',{name:'Удалить перенесённую историю и вложения',exact:true}).count()===0,'historical store cleared');
  await closeSettings(c);await c.locator(`.conversation-row[title="${bob.address}"]`).click();
  assert.equal(await c.locator('.message-text').filter({hasText:'Historical fixture text'}).count(),0);
  await c.locator('.message-text').filter({hasText:'Live during history transfer'}).waitFor();
  await c.reload();await unlock(c,devicePassword);await c.locator(`.conversation-row[title="${bob.address}"]`).click();
  assert.equal(await c.locator('.message-text').filter({hasText:'Historical fixture text'}).count(),0);
  await c.locator('.message-text').filter({hasText:'Live reply after historical merge'}).waitFor();
  assert.equal(await c.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('automesh-device-history-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['history','files'],'readonly'),history=tx.objectStore('history').count(),files=tx.objectStore('files').count();tx.oncomplete=()=>{db.close();resolve(history.result+files.result);};tx.onabort=()=>{db.close();reject(tx.error);};};})),0);
  assert.equal(requests.some(path=>path.startsWith('/devices/')),false,'History must not create a node/device mail job');
  assert.deepEqual(errors,[]);await ac.close();await bc.close();await cc.close();
  console.log('Passed history/linked UI: consent and cancel, WebRTC interruption/resume, 1 MiB file/hash, automatic PNG/JPEG previews/shared viewer, account QR, Saved ordering, automatic password unlock, Enter/Shift+Enter, caret emoji, green confirmed statuses, live delivery during import, reload/repeat/deletion, no seed vault or history node mail, 320/390/1920 light/dark.');
}
async function chatUxBaseline(){
  const ac=await context(),bc=await context(),a=await ac.newPage(),b=await bc.newPage();
  const alice=await prepare(a,phrases[0],{noNode:true}),bob=await prepare(b,phrases[1],{peer:alice.address,noNode:true});
  await prepare(a,phrases[0],{peer:bob.address,noNode:true});
  await a.evaluate(async({phrase,peer})=>{
    const {accountFromMnemonic}=await import('/src/lib/application/account.ts');
    const {deriveChatStoreKey,loadLocalChatData,saveLocalChatData}=await import('/src/lib/chat/local-store.ts');
    const account=await accountFromMnemonic(phrase);
    try{const key=await deriveChatStoreKey(account.identitySeed,account.accountId),data=await loadLocalChatData(key,account.accountId);
      const historyTime=new Date(2026,9,21,10).getTime();
      data.chats.byPeer[peer].messages=Array.from({length:65},(_,i)=>({id:crypto.randomUUID(),text:`History fixture ${i}`,from:account.accountId,timestamp:historyTime+i*1000,direction:'outgoing',delivery:'delivered'}));
      const missing=crypto.randomUUID();data.chats.byPeer[peer].messages.push({id:missing,text:'',from:account.accountId,timestamp:historyTime+65000,direction:'outgoing',delivery:'delivered',fileDeleted:true,fileStatus:'ready',file:{id:missing,name:'missing-fixture.bin',size:1,mime:'application/octet-stream',sha256:'a'.repeat(64)}});
      await saveLocalChatData(key,account.accountId,data);
    }finally{account.identitySeed.fill(0);account.provider.dispose();}
  },{phrase:phrases[0],peer:bob.address});
  await unlock(a);await unlock(b);await a.locator(`.conversation-row[title="${bob.address}"]`).click();
  const scroll=a.locator('[data-chat-scroll]');
  await until(()=>scroll.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight<3),'initial history opens at bottom');
  await scroll.locator('[data-chat-message-id]').last().evaluate(n=>n.style.minHeight='800px');
  await until(()=>scroll.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight<3),'late media resize stays anchored');
  await scroll.locator('[data-chat-message-id]').last().evaluate(n=>n.style.minHeight='');
  let unexpectedDownloads=0;const countUnexpected=()=>unexpectedDownloads++;a.on('download',countUnexpected);
  await scroll.getByText('📎 missing-fixture.bin',{exact:true}).dblclick();await a.getByRole('button',{name:'Скачать выбранные сообщения',exact:true}).click();await a.getByRole('region',{name:'Действия с выбранными сообщениями'}).waitFor();assert.equal(unexpectedDownloads,0);a.removeListener('download',countUnexpected);await a.getByRole('button',{name:'Отменить выбор сообщений',exact:true}).click();
  await scroll.evaluate(n=>n.scrollTop=0);await a.getByRole('button',{name:'К последним сообщениям',exact:true}).waitFor();
  await a.getByRole('button',{name:'К последним сообщениям',exact:true}).click();
  await until(()=>scroll.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight<3),'jump down');
  await a.getByRole('button',{name:'Поиск в чате',exact:true}).click();await a.getByLabel('Текст сообщения',{exact:true}).fill('History fixture 12');
  await a.getByRole('button',{name:'Перейти к совпадению',exact:true}).click();await a.locator('.chat-message.highlighted').filter({hasText:'History fixture 12'}).waitFor();
  await a.getByLabel('Текст сообщения',{exact:true}).fill('');const date='2026-10-21';
  await a.getByLabel('Дата сообщения',{exact:true}).fill(date);assert.match(await a.locator('.chat-search').innerText(),/66/);
  await a.getByRole('button',{name:'Закрыть поиск',exact:true}).click();
  await scroll.locator('.message-text').filter({hasText:'History fixture 12'}).dblclick();await a.getByRole('region',{name:'Действия с выбранными сообщениями'}).waitFor();
  const download=a.waitForEvent('download');await a.getByRole('button',{name:'Скачать выбранные сообщения',exact:true}).click();await download;
  await a.getByRole('region',{name:'Действия с выбранными сообщениями'}).waitFor({state:'detached'});
  assert.deepEqual(errors,[],'selection download must not trigger reactive loops');
  const tapTarget=scroll.locator('.message-text').filter({hasText:'History fixture 12'});
  for(let i=0;i<2;i++){await tapTarget.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,clientX:120,clientY:200});await tapTarget.dispatchEvent('pointerup',{pointerType:'touch',isPrimary:true,clientX:120,clientY:200});if(!i)await a.waitForTimeout(80);}
  await a.getByRole('region',{name:'Действия с выбранными сообщениями'}).waitFor();await a.getByRole('button',{name:'Отменить выбор сообщений',exact:true}).click();
  await a.getByLabel('Сообщение',{exact:true}).fill('Long hold fixture');const sendBox=await a.getByRole('button',{name:'Отправить сообщение',exact:true}).boundingBox();await a.mouse.move(sendBox.x+sendBox.width/2,sendBox.y+sendBox.height/2);await a.mouse.down();await a.waitForTimeout(600);await a.mouse.up();const sendOptions=a.getByRole('dialog',{name:'Настройки следующей отправки'});await sendOptions.waitFor();assert.equal(await a.locator('.message-text').filter({hasText:'Long hold fixture'}).count(),0);await sendOptions.getByRole('button',{name:'Закрыть настройки отправки',exact:true}).click();
  await a.getByLabel('Сообщение',{exact:true}).fill('AB');await a.getByLabel('Сообщение',{exact:true}).evaluate(n=>{n.focus();n.setSelectionRange(1,1);n.dispatchEvent(new Event('select',{bubbles:true}));});
  await a.getByRole('button',{name:'Выбрать эмодзи',exact:true}).click();await a.getByRole('button',{name:'Вставить 😀',exact:true}).click();assert.equal(await a.getByLabel('Сообщение',{exact:true}).inputValue(),'A😀B');
  await a.getByRole('button',{name:'Закрыть эмодзи',exact:true}).click();await a.getByLabel('Сообщение',{exact:true}).fill('');
  for(const mode of ['light','dark']){await a.evaluate(mode=>document.documentElement.dataset.theme=mode,mode);for(const width of [320,390,1920]){await a.setViewportSize({width,height:950});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(width!==320)await a.screenshot({path:resolve(root,`.release/chat-ux-${mode}-${width}.png`),fullPage:true});}}
  await a.setViewportSize({width:1000,height:950});
  await send(a,bob.address,'Ordinary before ephemeral');await b.locator(`.conversation-row[title="${alice.address}"]`).click();await b.locator('.message-text').filter({hasText:'Ordinary before ephemeral'}).waitFor({timeout:35000});
  async function options({seconds='0',views='1',allow=false}={}){await a.getByRole('button',{name:'Настройки отправки',exact:true}).click();const dialog=a.getByRole('dialog',{name:'Настройки следующей отправки'});await dialog.getByLabel('Удалить после первого открытия').selectOption(seconds);await dialog.getByLabel('Количество открытий').selectOption(views);if(allow)await dialog.getByLabel('Разрешить скачивание').check();await dialog.getByRole('button',{name:'Применить',exact:true}).click();}
  await options();await send(a,bob.address,'One-view private fixture');
  let card=b.locator('.chat-message').filter({hasText:'◷ Исчезающее сообщение'}).last();await card.getByRole('button',{name:'Открыть',exact:true}).waitFor({timeout:35000});
  assert.equal(await b.locator('.message-text').filter({hasText:'One-view private fixture'}).count(),0);
  await card.getByRole('button',{name:'Открыть',exact:true}).click();let viewer=b.getByRole('dialog',{name:'Исчезающее сообщение'});await viewer.getByText('One-view private fixture',{exact:true}).waitFor();assert.equal(await viewer.getByRole('button',{name:/Скачать/}).count(),0);
  await viewer.getByRole('button',{name:'Закрыть просмотр',exact:true}).click();await b.getByText('◷ Сообщение исчезло',{exact:true}).waitFor();
  await unlock(b);await b.locator(`.conversation-row[title="${alice.address}"]`).click();await b.getByText('◷ Сообщение исчезло',{exact:true}).waitFor();assert.equal(await b.getByText('One-view private fixture',{exact:true}).count(),0);
  await options({seconds:'10',views:'0',allow:true});await send(a,bob.address,'Timed private fixture');
  card=b.locator('.chat-message').filter({hasText:'◷ Исчезающее сообщение'}).last();await card.getByRole('button',{name:'Открыть',exact:true}).waitFor({timeout:35000});await card.getByRole('button',{name:'Открыть',exact:true}).click();viewer=b.getByRole('dialog',{name:'Исчезающее сообщение'});await viewer.getByText('Timed private fixture',{exact:true}).waitFor();
  assert.equal(await viewer.getByRole('button',{name:'Скачать текст',exact:true}).count(),1);await viewer.getByRole('button',{name:'Закрыть просмотр',exact:true}).click();await unlock(b);await b.locator(`.conversation-row[title="${alice.address}"]`).click();
  await until(async()=>await b.getByText('◷ Сообщение исчезло',{exact:true}).count()===2,'timer survives reload',15000);
  await until(async()=>await a.locator('.peer-status').filter({hasText:'● На связи'}).count()>0&&await b.locator('.peer-status').filter({hasText:'● На связи'}).count()>0,'both direct peers reconnect after repeated unlock',65000);
  const png=await a.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;const ctx=canvas.getContext('2d');ctx.fillStyle='#123456';ctx.fillRect(0,0,20,20);return canvas.toDataURL('image/png').split(',')[1];});
  await options();await a.getByLabel('Выбрать файлы для отправки',{exact:true}).setInputFiles({name:'private.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await a.getByRole('button',{name:'Отправить сообщение',exact:true}).click();card=b.locator('.chat-message').filter({hasText:'◷ Исчезающее вложение'}).last();
  await card.waitFor({timeout:35000});if(await card.getByRole('button',{name:'Получить файл',exact:true}).count())await card.getByRole('button',{name:'Получить файл',exact:true}).click();
  await until(()=>card.getByRole('button',{name:'Открыть',exact:true}).isEnabled(),'protected file received');await card.getByRole('button',{name:'Открыть',exact:true}).click();viewer=b.getByRole('dialog',{name:'Исчезающее сообщение'});await viewer.getByAltText('Исчезающее изображение',{exact:true}).waitFor();
  await viewer.getByRole('button',{name:'Закрыть просмотр',exact:true}).click();await until(async()=>await b.getByText('◷ Сообщение исчезло',{exact:true}).count()===3,'image expires');
  await send(b,alice.address,'Ordinary after ephemeral');await a.locator('.message-text').filter({hasText:'Ordinary after ephemeral'}).waitFor({timeout:35000});
  assert.deepEqual(errors,[]);await ac.close();await bc.close();console.log('Passed chat UX: open/late resize bottom, 12-message jump, text/date search, double click selection and download reset, caret emoji insertion, 320/390/1920 light/dark; real direct ephemeral text/view limits, persisted timer and protected image; ordinary delivery before/after.');
}
async function ephemeralCourierBaseline(){
  const ac=await context(),bc=await context(),a=await ac.newPage(),b=await bc.newPage();
  const alice=await prepare(a,phrases[0]),bob=await prepare(b,phrases[1],{peer:alice.address});await prepare(a,phrases[0],{peer:bob.address});
  await node.state.change(next=>{next.owner=alice;next.primaryAddress=alice.address;next.senders=[bob.address];next.members=[{...alice,senders:[bob.address]},{...bob,senders:[alice.address]}];});
  await unlock(a);await unlock(b);await send(a,bob.address,'Courier baseline A');await b.locator(`.conversation-row[title="${alice.address}"]`).click();await b.locator('.message-text').filter({hasText:'Courier baseline A'}).waitFor({timeout:35000});
  await send(b,alice.address,'Courier baseline B');await a.locator('.message-text').filter({hasText:'Courier baseline B'}).waitFor({timeout:35000});
  await until(()=>a.evaluate(async peer=>{const {accountFromMnemonic}=await import('/src/lib/application/account.ts');const {deriveChatStoreKey,loadLocalChatData}=await import('/src/lib/chat/local-store.ts');const x=await accountFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');try{const d=await loadLocalChatData(await deriveChatStoreKey(x.identitySeed,x.accountId),x.accountId),s=d?.courierState;return !!s?.bundles[peer]?.body.keys.some(k=>!s.used[k.id]);}finally{x.identitySeed.fill(0);x.provider.dispose();}},bob.address),'offline recipient keys');
  const png=await a.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;const ctx=canvas.getContext('2d');ctx.fillStyle='#123456';ctx.fillRect(0,0,20,20);return canvas.toDataURL('image/png').split(',')[1];});
  await b.close();
  async function oneView(){await a.getByRole('button',{name:'Настройки отправки',exact:true}).click();const d=a.getByRole('dialog',{name:'Настройки следующей отправки'});await d.getByLabel('Количество открытий').selectOption('1');await d.getByRole('button',{name:'Применить',exact:true}).click();}
  await oneView();await send(a,bob.address,'Offline protected fixture');
  await oneView();await a.getByLabel('Выбрать файлы для отправки',{exact:true}).setInputFiles({name:'offline-private.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await a.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
  await until(()=>[...node.courier.box.records.values()].filter(r=>r.sender===alice.address).length===2,'two protected offline envelopes deposited',40000);
  await a.close();
  const receiver=await bc.newPage();await receiver.goto(origin);await unlock(receiver);await receiver.locator(`.conversation-row[title="${alice.address}"]`).click();
  let card=receiver.locator('.chat-message').filter({hasText:'◷ Исчезающее сообщение'}).last();await card.getByRole('button',{name:'Открыть',exact:true}).waitFor({timeout:40000});await card.getByRole('button',{name:'Открыть',exact:true}).click();let viewer=receiver.getByRole('dialog',{name:'Исчезающее сообщение'});await viewer.getByText('Offline protected fixture',{exact:true}).waitFor();await viewer.getByRole('button',{name:'Закрыть просмотр',exact:true}).click();
  card=receiver.locator('.chat-message').filter({hasText:'◷ Исчезающее вложение'}).last();await card.waitFor({timeout:40000});if(await card.getByRole('button',{name:'Получить файл',exact:true}).count())await card.getByRole('button',{name:'Получить файл',exact:true}).click();
  await until(()=>card.getByRole('button',{name:'Открыть',exact:true}).isEnabled(),'offline protected file received',40000);await card.getByRole('button',{name:'Открыть',exact:true}).click();viewer=receiver.getByRole('dialog',{name:'Исчезающее сообщение'});await viewer.getByAltText('Исчезающее изображение',{exact:true}).waitFor();await viewer.getByRole('button',{name:'Закрыть просмотр',exact:true}).click();
  await until(async()=>await receiver.getByText('◷ Сообщение исчезло',{exact:true}).count()===2,'receiver protected tombstones');
  await until(()=>[...node.courier.box.records.values()].filter(r=>r.sender===bob.address).length===2,'open reports queued while sender offline',40000);
  const sender=await ac.newPage();await sender.goto(origin);await unlock(sender);await sender.locator(`.conversation-row[title="${bob.address}"]`).click();await until(async()=>await sender.getByText('◷ Сообщение исчезло',{exact:true}).count()===2,'offline open reports retire sender copies',40000);
  await until(()=>receiver.evaluate(async({phrase,peer})=>{const {accountFromMnemonic}=await import('/src/lib/application/account.ts');const {deriveChatStoreKey,loadLocalChatData,loadLocalFileData}=await import('/src/lib/chat/local-store.ts');const x=await accountFromMnemonic(phrase);try{const key=await deriveChatStoreKey(x.identitySeed,x.accountId),data=await loadLocalChatData(key,x.accountId);const rows=data.chats.byPeer[peer].messages.filter(m=>m.details?.ephemeral);if(rows.length!==2||rows.some(m=>!m.ephemeralState?.expired||m.text||m.file))return false;for(const row of rows){if(await loadLocalFileData(key,x.accountId,`${peer}:${row.id}`))return false;}return true;}finally{x.identitySeed.fill(0);x.provider.dispose();}}, {phrase:phrases[1],peer:alice.address}),'durable file cleanup and empty tombstones');
  assert.equal(requests.some(p=>p.startsWith('/devices/')),false);assert.deepEqual(errors,[]);await ac.close();await bc.close();console.log(`Passed protected courier: text and file received with sender closed via ${nodeOrigin}; recipient open reports queued offline, sender copies retired after unlock, durable content/file deletion verified.`);
}
async function backHierarchyBaseline(){
  const ctx=await context();await ctx.addInitScript(()=>{try{localStorage.setItem('automesh.ui-language.v1','ru');}catch{}});
  const a=await ctx.newPage();await a.setViewportSize({width:390,height:844});
  const owner=await prepare(a,phrases[0],{noNode:true});await unlock(a);
  const row=a.locator(`.conversation-row[title="${owner.address}"]`);
  await row.click();await a.locator('.chat-layout.show-chat').waitFor();
  const png=await a.evaluate(()=>{const c=document.createElement('canvas');c.width=24;c.height=24;const x=c.getContext('2d');x.fillStyle='#3a6841';x.fillRect(0,0,24,24);return c.toDataURL('image/png').split(',')[1];});
  await a.getByLabel('Выбрать файлы для отправки',{exact:true}).setInputFiles(Array.from({length:8},(_,i)=>({name:`back-${i}.png`,mimeType:'image/png',buffer:Buffer.from(png,'base64')})));
  await a.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
  await until(()=>a.locator('.message-image').count().then(n=>n===8),'eight local media fixtures');
  const viewer=a.getByRole('dialog',{name:'Просмотр фото и видео',exact:true});
  for(const close of ['native-cancel','toolbar','browser']){
    const length=await a.evaluate(()=>history.length);
    await a.locator('.message-image').first().click();await viewer.waitFor();
    for(let photo=0;photo<20;photo++)await a.keyboard.press('ArrowRight');
    assert.equal(await a.evaluate(()=>history.length),length+1,'photos must share one viewer history entry');
    const scroll=await a.locator('[data-chat-scroll]').evaluate(n=>n.scrollTop);
    const mediaState=await a.evaluate(()=>JSON.stringify(history.state));
    if(close==='native-cancel')await a.keyboard.press('Escape');
    else if(close==='toolbar')await viewer.getByRole('button',{name:'Закрыть просмотр',exact:true}).click();
    else await a.goBack();
    await viewer.waitFor({state:'hidden'});await a.locator('.chat-layout.show-chat').waitFor();
    await until(()=>a.evaluate(before=>JSON.stringify(history.state)!==before,mediaState),'viewer history level consumed');
    assert.ok(Math.abs(await a.locator('[data-chat-scroll]').evaluate(n=>n.scrollTop)-scroll)<=1,'closing media preserves the chat scroll position');
    if(close==='toolbar')await a.locator('.chat-back').click();else await a.goBack();
    await a.locator('.chat-layout.show-list').waitFor();assert.equal(await viewer.count(),0);
    await row.click();await a.locator('.chat-layout.show-chat').waitFor();
  }
  // Closing media to reply must wait for the native history traversal too.
  await a.locator('.message-image').first().click();await viewer.waitFor();
  await viewer.getByRole('button',{name:'Действия с медиа',exact:true}).click();
  await viewer.getByRole('button',{name:'Ответить',exact:true}).click();
  await viewer.waitFor({state:'hidden'});await a.locator('.composer-reply').waitFor();
  await a.goBack();await a.locator('.chat-layout.show-list').waitFor();
  // The same shared history controller must retain settings parent levels.
  await a.getByRole('button',{name:'Настройки',exact:true}).click();await a.getByRole('button',{name:/Связь и ноды/}).first().click();
  await a.locator('nav[aria-label="Связь и ноды"]').getByRole('button',{name:/Ноды доставки/}).click();
  await a.getByRole('button',{name:'Получение сообщений',exact:true}).click();
  const back=()=>a.getByRole('button',{name:'Назад',exact:true}).click();
  await back();await a.getByRole('heading',{name:'Мои ноды',exact:true}).waitFor();
  await back();await a.getByRole('region',{name:'Обзор подключений',exact:true}).waitFor();
  await back();await a.getByRole('heading',{name:'Настройки',exact:true}).waitFor();
  await back();await a.locator('.chat-layout.show-list').waitFor();
  assert.deepEqual(errors,[]);await ctx.close();
  console.log('Passed mobile Back hierarchy: 20-photo browsing per open, native modal cancel, viewer/chat Back buttons, browser Back, repeated reopen, preserved scroll, reply after close and settings parents.');
}
async function interfaceBaseline(){
  const ac=await context(),a=await ac.newPage();await prepare(a,phrases[0],{noNode:true});await unlock(a);
  await a.getByRole('button',{name:'Настройки',exact:true}).click();await a.getByRole('button',{name:/Связь и ноды/}).first().click();
  await a.locator('nav[aria-label="Связь и ноды"]').getByRole('button',{name:/Ноды доставки/}).click();
  await a.getByRole('button',{name:'Получение сообщений',exact:true}).click();
  const back=()=>a.getByRole('button',{name:'Назад',exact:true}).click();
  await back();await a.getByRole('heading',{name:'Мои ноды',exact:true}).waitFor();
  await back();await a.getByRole('region',{name:'Обзор подключений',exact:true}).waitFor();
  // Cross-section sibling navigation must not become the Back path.
  for(const name of ['Безопасность','Медиа и хранилище','Приложение','Профиль','Приложение']){
    await a.getByRole('button',{name:'Перейти в раздел',exact:true}).click();await a.getByRole('option',{name:new RegExp('^'+name)}).click();
  }
  await a.getByLabel('Цветовая тема').selectOption('dark');
  assert.equal(await a.evaluate(()=>document.documentElement.dataset.theme),'dark');
  assert.equal(await a.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()),'#14232c');
  await back();await a.getByRole('heading',{name:'Настройки',exact:true}).waitFor();
  await back();await a.getByRole('button',{name:'Настройки',exact:true}).waitFor();
  await a.getByRole('button',{name:'Сканировать QR Account ID',exact:true}).click();
  const scanner=a.getByRole('region',{name:'Добавить контакт по QR',exact:true});
  for(const width of [320,390,600,1920]){await a.setViewportSize({width,height:900});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(width===390||width===600)await scanner.screenshot({path:resolve(root,`.release/contact-scanner-dark-${width}.png`)});}
  await scanner.getByLabel('Выбрать изображение QR контакта').setInputFiles({name:'no-qr.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
  await a.getByRole('alert').filter({hasText:'QR не найден'}).waitFor();await scanner.getByRole('button',{name:'Закрыть сканирование',exact:true}).click();
  await a.reload();await a.getByRole('heading',{name:'Вход 🔐',exact:true}).waitFor();
  assert.equal(await a.evaluate(()=>document.documentElement.dataset.theme),'dark');
  await unlock(a);await a.getByRole('button',{name:'Настройки',exact:true}).click();await a.getByRole('button',{name:/Приложение/}).first().click();
  await a.getByLabel('Цветовая тема').selectOption('system');await a.emulateMedia({colorScheme:'light'});
  assert.equal(await a.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()),'#ffffff');
  await a.emulateMedia({colorScheme:'dark'});assert.equal(await a.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()),'#14232c');
  for(const mode of ['light','dark']){
    await a.getByLabel('Цветовая тема').selectOption(mode);
    for(const width of [320,390,1920]){await a.setViewportSize({width,height:900});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    const p=await ac.newPage();await p.goto(origin+'/dev/chat');await p.locator('.transfer-badge').first().waitFor();
    for(const width of [390,1920]){await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:resolve(root,`.release/interface-${mode}-${width}.png`),fullPage:true});}
    assert.ok((await p.locator('.transfer-badge').first().innerText()).includes('2'));
    await p.close();
  }
  assert.deepEqual(errors,[]);await ac.close();console.log('Passed interface baseline: settings parent hierarchy after sibling browsing, persisted and OS-following themes, transfer/wait badges, 320/390/1920px without overflow or page errors.');
}
try{
  await until(async()=>{try{return (await fetch(origin)).ok;}catch{return false;}},'vite:'+diagnostic);
  const executablePath=[chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);browser=await chromium.launch({executablePath,headless:true});
  if(process.argv.includes('--back-hierarchy-only'))await backHierarchyBaseline();else if(process.argv.includes('--history-only'))await historyBaseline();else if(process.argv.includes('--ephemeral-courier-only'))await ephemeralCourierBaseline();else if(process.argv.includes('--chat-ux-only'))await chatUxBaseline();else if(process.argv.includes('--interface-only'))await interfaceBaseline();else if(process.argv.includes('--primary-only'))await primaryBaseline();else{
  if (!process.argv.includes('--direct-only')) {
  const faults={denyPublish:true},ac=await context(),bc=await context(faults),cc=await context();const a=await ac.newPage(),b=await bc.newPage(),c=await cc.newPage();
  const alice=await prepare(a,phrases[0]),bob=await prepare(b,phrases[1],{peer:alice.address,personal:true});await prepare(a,phrases[0],{peer:bob.address});
  await node.state.change(next=>{next.owner=alice;next.primaryAddress=alice.address;next.senders=[bob.address];next.members=[{...alice,senders:[bob.address]},{...bob,senders:[alice.address]}];});
  await unlock(a);await headers(a,'owner');await networkScreens(a);await unlock(b);const panel=await manager(b);
  await panel.getByText('Прямой режим · без ноды. Для проверки прав нужен доступный владелец; отложенной доставки нет.',{exact:true}).waitFor({timeout:30000});
  assert.equal(await panel.getByRole('button',{name:'Подключить новое устройство',exact:true}).isEnabled(),true);faults.denyPublish=false;
  const linked=await enroll(panel,c,'Independent fixture phone');await headers(c,'linked');
  await linked.workspace.locator(`.conversation-row[title="${alice.address}"]`).waitFor({timeout:30000});
  await until(()=>a.evaluate(async peer=>{const {accountFromMnemonic}=await import('/src/lib/application/account.ts');const {deriveChatStoreKey,loadLocalChatData}=await import('/src/lib/chat/local-store.ts');const account=await accountFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');try{const data=await loadLocalChatData(await deriveChatStoreKey(account.identitySeed,account.accountId),account.accountId);return !!data?.deviceSettings?.peers.some(roster=>roster.record.author===peer&&roster.record.body.devices.length>0)&&!!data.deviceSettings.peers.find(roster=>roster.record.author===account.accountId)?.record.body.directory;}finally{account.identitySeed.fill(0);account.provider.dispose();}},bob.address),'verified advertisement and independent sender directory');
  await send(b,alice.address,'Owner outgoing copy on phone');
  await c.locator(`.conversation-row[title="${alice.address}"]`).click();await c.locator('.message-text').filter({hasText:'Owner outgoing copy on phone'}).waitFor({timeout:35000});
  await send(a,bob.address,'Ordinary incoming on both devices');
  await c.locator('.message-text').filter({hasText:'Ordinary incoming on both devices'}).waitFor({timeout:35000});
  await b.locator('.message-text').filter({hasText:'Ordinary incoming on both devices'}).waitFor({timeout:35000});
  assert.equal(await c.locator('.message-text').filter({hasText:'Ordinary incoming on both devices'}).count(),1);
  await linked.workspace.getByRole('button',{name:'Быстрая блокировка',exact:true}).click();await unlock(c,devicePassword);
  await until(()=>node.devices.entries.get(bob.address)?.keys.some(k=>k.bundle.body.device===linked.id),'node prekeys');
  await b.close();await c.reload();await send(a,bob.address,'Offline node delivery while owner and sender closed');
  const offlineId=await a.locator('[data-chat-message-id]').filter({hasText:'Offline node delivery while owner and sender closed'}).getAttribute('data-chat-message-id');assert.ok(offlineId);
  await until(async()=>(await (await node.devices.box(bob.address,linked.id)).list()).some(e=>e.sender===alice.address&&JSON.parse(Buffer.from(e.ciphertext,'base64url').toString()).body.eventId===offlineId),'exact offline message deposit from actual sender');await a.close();await unlock(c,devicePassword);
  await c.locator(`.conversation-row[title="${alice.address}"]`).click();await c.locator('.message-text').filter({hasText:'Offline node delivery while owner and sender closed'}).waitFor({timeout:30000});
  await send(c,alice.address,'Independent node reply');const ar=await ac.newPage();await ar.goto(origin);await unlock(ar);await ar.locator(`.conversation-row[title="${bob.address}"]`).click();await ar.locator('.message-text').filter({hasText:'Independent node reply'}).waitFor({timeout:30000});
  const br=await bc.newPage();await br.goto(origin);await unlock(br);const revoke=await manager(br);
  await revoke.getByRole('button',{name:'Отозвать доступ: Independent fixture phone',exact:true}).click();await revoke.getByRole('button',{name:'Да, отозвать доступ',exact:true}).click();await revoke.getByText('Нода подтвердила отзыв',{exact:false}).waitFor();
  await c.reload();await c.getByLabel('Пароль',{exact:true}).fill(devicePassword);await c.getByRole('button',{name:'Войти',exact:true}).click();await c.getByRole('alert').filter({hasText:'Подключение не подтверждено'}).waitFor({timeout:30000});
  await ac.close();await bc.close();await cc.close();
  console.log('Passed browser phase: owner-only QR, node-backed enrollment, independent offline delivery, reply and shared header geometry.');
  }
  if (!process.argv.includes('--linked-node-only')) {
  const fc=await context(),gc=await context(),hc=await context();const f=await fc.newPage(),g=await gc.newPage(),h=await hc.newPage();
  const frank=await prepare(f,phrases[2],{noNode:true}),grace=await prepare(g,phrases[3],{peer:frank.address,noNode:true});await prepare(f,phrases[2],{peer:grace.address,noNode:true});
  await unlock(f);await unlock(g);const directPanel=await manager(f);const phone=await enroll(directPanel,h,'Direct fixture phone');
  await phone.workspace.locator(`.conversation-row[title="${grace.address}"]`).waitFor({timeout:30000});await send(h,grace.address,'Browser direct no-node delivery');await g.locator(`.conversation-row[title="${frank.address}"]`).click();await g.locator('.message-text').filter({hasText:'Browser direct no-node delivery'}).waitFor({timeout:35000});
  await send(f,grace.address,'Root-only online warmup');await g.locator('.message-text').filter({hasText:'Root-only online warmup'}).waitFor({timeout:35000});
  // No node and no live owner: never silently use an old approval as fresh.
  await f.close();await send(h,grace.address,'Must wait for owner');await phone.workspace.getByRole('alert').filter({hasText:'Сообщение пока не отправлено'}).waitFor({timeout:30000});assert.equal(await g.locator('.message-text').filter({hasText:'Must wait for owner'}).count(),0);
  const fr=await fc.newPage();await fr.goto(origin);await unlock(fr);await send(h,grace.address,'Direct resumes with owner');await g.locator('.message-text').filter({hasText:'Direct resumes with owner'}).waitFor({timeout:35000});
  console.log('Passed browser phase: real P2P without node, strict wait with offline owner and resume.');
  // Upgrade the same account/device keys to a node, no new QR or seed.
  await node.state.change(next=>{next.members.push({...frank,senders:[grace.address]},{...grace,senders:[frank.address]});});
  const upgradePanel=await manager(fr);await addNode(upgradePanel);await deliveryRole(fr);
  await g.close();await send(fr,grace.address,'Root-only offline courier regression');
  await until(()=>[...node.courier.box.records.values()].some(r=>r.sender===frank.address),'root-only recipient no owner presence: actual courier deposit');
  const gr=await gc.newPage();await gr.goto(origin);await unlock(gr);const gp=await manager(gr);await addNode(gp);await deliveryRole(gr);
  await closeSettings(gr);await gr.locator(`.conversation-row[title="${frank.address}"]`).click();await gr.locator('.message-text').filter({hasText:'Root-only offline courier regression'}).waitFor({timeout:35000});
  console.log('Passed browser phase: ordinary offline courier delivery after root-only direct advertisement, no owner-unavailable trap.');
  await h.getByRole('button',{name:'Настройки',exact:true}).click();await h.getByRole('button',{name:/Связь и ноды/}).first().click();
  await h.getByText('Через ноду · первое устройство можно выключить.',{exact:true}).waitFor({timeout:45000});assert.equal(await h.evaluate(()=>localStorage.getItem('automesh-device-lab-id-v1')),phone.id);
  await until(()=>node.devices.entries.get(frank.address)?.keys.some(k=>k.bundle.body.device===phone.id),'upgraded prekeys');
  console.log('Passed browser phase: same-key direct-to-node upgrade, no new QR.');
  await h.getByRole('button',{name:'Назад',exact:true}).click();await h.reload();await fr.close();await send(gr,frank.address,'Node delivery after direct-to-node upgrade');
  await until(async()=>(await (await node.devices.box(frank.address,phone.id)).list()).some(e=>e.sender===grace.address),'upgraded deposit from actual sender');await gr.close();await unlock(h,devicePassword);await h.locator(`.conversation-row[title="${grace.address}"]`).click();await h.locator('.message-text').filter({hasText:'Node delivery after direct-to-node upgrade'}).waitFor({timeout:30000});
  console.log('Passed browser phase: offline node delivery after upgrade with owner and sender closed.');
  const ownerAgain=await fc.newPage();await ownerAgain.goto(origin);await unlock(ownerAgain);const revokePanel=await manager(ownerAgain);await revokePanel.getByRole('button',{name:'Отозвать доступ: Direct fixture phone',exact:true}).click();await revokePanel.getByRole('button',{name:'Да, отозвать доступ',exact:true}).click();await revokePanel.getByText('Нода подтвердила отзыв',{exact:false}).waitFor();
  await h.reload();await h.getByLabel('Пароль',{exact:true}).fill(devicePassword);await h.getByRole('button',{name:'Войти',exact:true}).click();await h.getByRole('alert').filter({hasText:'Подключение не подтверждено'}).waitFor({timeout:30000});
  assert.deepEqual(errors,[]);console.log('Passed: owner-only one real QR, auto request/approval, same code throughout, pending reload, old incoming node, shared 320–1920px header, independent node delivery, true browser P2P without node, strict offline-owner wait, same-key direct-to-node upgrade, offline delivery after upgrade, revocation and no page errors.');
  }
  assert.deepEqual(errors,[]);
  }
}catch(error){console.error('Fixture responses:',responses.slice(-12));for(const ctx of browser?.contexts()??[])for(const page of ctx.pages()){console.error('Fixture UI:',(await page.locator('body').innerText().catch(()=>'' )).slice(-1500));if(process.argv.includes('--chat-ux-only')||process.argv.includes('--trace-chat-transport')){console.error('Fixture transport trace:',JSON.stringify(await page.evaluate(()=>window.__chatFixtureTrace?.slice(-40)??[]).catch(()=>[])));console.error('Fixture connection state:',JSON.stringify(await page.evaluate(()=>window.__chatFixtureState?.()??[]).catch(()=>[])));}}throw error;}
finally{await browser?.close();server.kill();await signal.close();await node.close();await rm(directory,{recursive:true,force:true});}
