import type{FileOffer}from'./file-transfer';
import type{ChatEntry,SessionChats}from'./session-chats';
import type{MediaLibrary,MediaAsset}from'./media-library';
// Rebase a UI edit made before another receive/save completed. Existing hashes
// keep their canonical storage UUID; concurrent cache additions are not lost.
export function rebaseMediaLibrary(next:MediaLibrary,baseline:MediaLibrary,current:MediaLibrary,chats:SessionChats):MediaLibrary{
 const assets=next.assets.map(a=>{const saved=current.assets.find(b=>b.hash===a.hash);return saved?{...a,id:saved.id,usedAt:Math.max(a.usedAt,saved.usedAt)}:a;});
 const added=current.assets.filter(a=>!baseline.assets.some(b=>b.hash===a.hash)&&!assets.some(b=>b.hash===a.hash));
 const cached=[...new Set([...(next.cached??[]),...(current.cached??[]).filter(h=>!baseline.cached?.includes(h))])];
 return retainMessageMedia({...next,assets:[...assets,...added],cached},current,chats);
}
export function reusableMedia(offer:FileOffer):boolean{
 return !offer.details?.ephemeral&&['sticker','gif'].includes(offer.details?.media?.kind??'')&&['image/png','image/webp','image/gif'].includes(offer.mime);
}
export function reusableAsset(library:MediaLibrary,offer:FileOffer):MediaAsset|undefined{
 return reusableMedia(offer)?library.assets.find(a=>a.hash===offer.sha256&&a.size===offer.size&&a.mime===offer.mime):undefined;
}
export function linkCachedMedia(chats:SessionChats,asset:MediaAsset):{chats:SessionChats;logical:string[]}{
 const byPeer={...chats.byPeer},logical:string[]=[];
 for(const peer of chats.order){
  let changed=false;const messages=chats.byPeer[peer].messages.map(m=>{
   if(!m.file||m.fileDeleted||!reusableMedia({...m.file,details:m.details??m.file.details})||m.file.sha256!==asset.hash||m.file.size!==asset.size||m.file.mime!==asset.mime)return m;
   logical.push(peer+':'+m.id);if(m.mediaRef===asset.id)return m;changed=true;return {...m,mediaRef:asset.id};
  });
  if(changed)byPeer[peer]={...byPeer[peer],messages};
 }
 return {chats:{...chats,byPeer},logical};
}
// Removing a collection never deletes bytes still referenced by a live message.
export function retainMessageMedia(next:MediaLibrary,previous:MediaLibrary,chats:SessionChats):MediaLibrary{
 const ids=new Set(chats.order.flatMap(peer=>chats.byPeer[peer].messages.filter(m=>!m.fileDeleted).map(m=>m.mediaRef)));
 const retained=previous.assets.filter(a=>ids.has(a.id)&&!next.assets.some(n=>n.hash===a.hash));
 return {...next,assets:[...next.assets,...retained],...(retained.length?{cached:[...new Set([...(next.cached??[]),...retained.map(a=>a.hash)])]}:{})};
}
export function packRequested(messages:readonly ChatEntry[],packId:string):boolean{
 return messages.some(m=>m.direction==='outgoing'&&m.details?.media?.kind==='pack-request'&&m.details.media.packId===packId)||
 messages.some(m=>m.direction==='incoming'&&m.details?.media?.kind==='sticker-pack'&&m.details.media.packId===packId);
}
export function packRequestAnswered(messages:readonly ChatEntry[],request:ChatEntry):boolean{
 return messages.some(m=>m.direction==='outgoing'&&m.details?.media?.kind==='sticker-pack'&&(m.details.media.packId===request.details?.media?.packId||m.details.reply?.id===request.id)&&m.timestamp>=request.timestamp);
}
