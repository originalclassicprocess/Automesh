import type {ChatEntry} from './session-chats';
import {canDownloadMessage,canStopFile} from './message-presentation';
import { transcript } from './chat-actions';
export type BulkAction='retry'|'cancel';
export type BulkTask={id:string;kind:'resume'|'new'|'file'|'node'};
export function bulkTasks(messages:readonly ChatEntry[],selected:readonly string[],action:BulkAction,self:string,nodePending:ReadonlySet<string>):BulkTask[]{
  const ids=new Set(selected);const result:BulkTask[]=[];
  for(const m of messages){
    if(!ids.delete(m.id)||m.localCall||m.details?.ephemeral||m.details?.ephemeralOpened||m.details?.pin||m.restoredFromBackup||m.importedFromDevice||m.deviceMessage||m.radioDelivery)continue;
    const own=m.direction==='outgoing'&&m.from===self;
    if(action==='cancel'){
      if(own&&nodePending.has(m.id)&&!m.nodeQueue&&!['delivered','read'].includes(m.delivery??''))result.push({id:m.id,kind:'node'});
      else if(!m.nodeQueue&&canStopFile(m))result.push({id:m.id,kind:'file'});
    }else if(own&&!m.fileDeleted&&m.delivery!=='saving'&&m.delivery!=='sending'&&!['sending','receiving'].includes(m.fileStatus??'')&&m.nodeQueue!=='canceling'){
      if(!m.delivery||['canceled','expired'].includes(m.nodeQueue??'')||['delivered','read'].includes(m.delivery??'')||['rejected','canceled'].includes(m.fileStatus??''))result.push({id:m.id,kind:'new'});
      else if(m.delivery!=='stored'&&!m.nodeQueue)result.push({id:m.id,kind:'resume'});
    }
  }return result;
}
export function downloadableSelection(messages:readonly ChatEntry[],selected:readonly string[]):ChatEntry[]{
  const ids=new Set(selected);return messages.filter(m=>ids.delete(m.id)&&!m.localCall&&!m.details?.pin&&!m.details?.ephemeralOpened&&canDownloadMessage(m));
}
export function archiveFileName(name:string,index:number):string{
  const clean=name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').replace(/^\.+/,'').trim().slice(0,120)||'file';
  return `files/${String(index+1).padStart(3,'0')}-${clean}`;
}

export async function messageArchive(messages: readonly ChatEntry[], load: (message: ChatEntry) => Promise<Uint8Array>) {
  if (messages.reduce((size, message) => size + (message.file?.size ?? 0) + message.text.length * 4, 0) > 64 * 1024 * 1024)
    throw new Error('Для одного архива выберите не больше 64 МБ. Скачайте остальные файлы отдельно.');
  const text = new TextEncoder().encode(transcript(messages));
  const files: Record<string, Uint8Array> = { 'messages.txt':text };
  let index = 0;
  try {
    for (const message of messages) if (message.file) {
      files[archiveFileName(message.file.name, index++)] = await load(message);
    }
    const bytes = index ? (await import('fflate')).zipSync(files, { level:0 }) : text.slice();
    return { bytes, name:`Automesh-messages-${new Date().toISOString().slice(0, 10)}.${index ? 'zip' : 'txt'}` };
  } finally { for (const bytes of Object.values(files)) bytes.fill(0); }
}
