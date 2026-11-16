import {describe,it,expect} from 'vitest';
import {bulkTasks,downloadableSelection,archiveFileName} from './bulk-actions';
import type {ChatEntry} from './session-chats';
const row=(id:string,patch:Partial<ChatEntry>={}):ChatEntry=>({id,text:id,from:'self',direction:'outgoing',timestamp:1,delivery:'queued',...patch});
const file={id:'file',name:'photo.png',size:2,mime:'image/png',sha256:'hash'};
describe('mixed message selections',()=>{
  it('distinguishes resumable work from explicit new copies, without resending stored or active work',()=>{
    const rows=[row('pending'),row('done',{delivery:'delivered'}),row('stored',{delivery:'stored'}),row('sending',{delivery:'sending'}),row('old',{delivery:undefined}),row('stopped',{nodeQueue:'canceled'}),row('in',{direction:'incoming'}),row('deleted',{file,fileDeleted:true})];
    expect(bulkTasks(rows,['pending','done','stored','sending','old','stopped','in','deleted','pending'],'retry','self',new Set())).toEqual([{id:'pending',kind:'resume'},{id:'done',kind:'new'},{id:'old',kind:'new'},{id:'stopped',kind:'new'}]);
  });
  it('rechecks receipts and node confirmation before cancellation',()=>{
    const pending=new Set(['node','done','canceling']);
    const rows=[row('node',{delivery:'stored'}),row('done',{delivery:'delivered'}),row('canceling',{nodeQueue:'canceling'}),row('file',{file,fileStatus:'receiving',direction:'incoming'}),row('ready',{file,fileStatus:'ready'})];
    expect(bulkTasks(rows,rows.map(m=>m.id),'cancel','self',pending)).toEqual([{id:'node',kind:'node'},{id:'file',kind:'file'}]);
    rows[0].delivery='read';expect(bulkTasks(rows,['node'],'cancel','self',pending)).toEqual([]);
  });
  it('does not retry radio, imported, device or disappearing messages',()=>{
    const rows=[row('backup',{restoredFromBackup:true}),row('device',{importedFromDevice:true}),row('secret',{details:{ephemeral:{allowDownload:false}} as ChatEntry['details']}),row('radio',{radioDelivery:{} as ChatEntry['radioDelivery']})];
    expect(bulkTasks(rows,rows.map(m=>m.id),'retry','self',new Set())).toEqual([]);
  });
  it('downloads only available entries, keeps order and deduplicates selection',()=>{
    const rows=[row('text'),row('incoming',{file,direction:'incoming',fileStatus:'receiving'}),row('ready',{file,direction:'incoming',fileStatus:'ready'}),row('gone',{file,fileDeleted:true}),row('secret',{details:{ephemeral:{allowDownload:true}} as ChatEntry['details']})];
    expect(downloadableSelection(rows,['ready','text','text','incoming','gone','secret']).map(m=>m.id)).toEqual(['text','ready']);
    expect(archiveFileName('../../photo.png',0)).toBe('files/001-_.._photo.png');
    expect(archiveFileName('photo.png',1)).toBe('files/002-photo.png');
  });
});
