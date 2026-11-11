<script lang="ts">
 import {onDestroy} from 'svelte';
 import {WebCryptoIdentity} from '$lib/identity/webcrypto';
 import {getAccountId} from '$lib/addressing/address';
 import {bytesToHex} from '$lib/message/encoding';
 import {ChatService} from '$lib/chat/ChatService';
 import {RoutedWebRTCTransport} from '$lib/transport/RoutedWebRTCTransport';
 let endpoint=$state('wss://localhost:3003/signal'),busy=$state(false),result=$state(''),lines=$state<string[]>([]);
 let clients:ChatService[]=[];
 onDestroy(()=>{for(const c of clients)void c.disconnect();});
 async function run(){
  busy=true;result='';lines=[];
  const log=(s:string)=>{lines=[...lines,s];};
  const identity=async()=>{const provider=new WebCryptoIdentity();const seed=crypto.getRandomValues(new Uint8Array(32));try{return{provider,address:await getAccountId(bytesToHex((await provider.fromSeed(seed)).publicKey))};}finally{seed.fill(0);}};
  const wait=async(f:()=>boolean)=>{const until=Date.now()+30000;while(!f()){if(Date.now()>until)throw Error('direct_connection_timeout');await new Promise(r=>setTimeout(r,50));}};
  const routers:RoutedWebRTCTransport[]=[];
  try{
   const aIdentity=await identity(),bIdentity=await identity();
   const endpoints=[{url:endpoint,kind:'lan' as const}];
   const ar=new RoutedWebRTCTransport(endpoints),br=new RoutedWebRTCTransport(endpoints);routers.push(ar,br);
   const a=new ChatService(ar),b=new ChatService(br);clients=[a,b];
   let aReady=false,bReady=false,received=0,receipts=0;
   for(const [name,c] of [['A',a],['B',b]] as const){c.onStatusChange(s=>log(name+' signal: '+s));c.onPeerChange((_,e)=>{log(name+' secure: '+e);if(name==='A')aReady=e==='joined';else bReady=e==='joined';});}
   a.onMessage(()=>{received++;});b.onMessage(()=>{received++;});a.onReceipt(()=>{receipts++;});b.onReceipt(()=>{receipts++;});
   await Promise.all([a.init(aIdentity),b.init(bIdentity)]);
   await Promise.all([a.connect(bIdentity.address),b.connect(aIdentity.address)]);
   await wait(()=>aReady&&bReady);
   await a.send('Local isolated diagnostic',bIdentity.address);await b.send('Local isolated reply',aIdentity.address);
   await wait(()=>received===2&&receipts===2);
   result='Успешно: два клиента, прямое шифрованное соединение, сообщения и квитанции в обе стороны.';
  }catch(e){result=e instanceof Error?e.message:'check_failed';for(const [i,r]of routers.entries())log(JSON.stringify({client:i,nodes:r.getNodeStates(),routes:r.getPeerRoutes()}));}
  finally{await Promise.all(clients.map(c=>c.disconnect()));clients=[];busy=false;}
 }
</script>
<svelte:head><title>Локальная проверка прямого соединения</title></svelte:head>
<main style="padding:24px;max-width:850px;margin:auto">
 <h1>Прямое соединение двух временных клиентов</h1>
 <p>Только локальная разработка. Ключи — в памяти, ваши аккаунты и очередь ноды не используются.</p>
 <label>Сигналинг <input bind:value={endpoint} disabled={busy}/></label>
 <button onclick={run} disabled={busy}>{busy?'Проверяем…':'Проверить прямое соединение'}</button>
 <p role="status">{result}</p><pre>{lines.join('\n')}</pre>
</main>
