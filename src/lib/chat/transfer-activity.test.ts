import { expect,it } from 'vitest';
import { transferActivity } from './transfer-activity';
import type { ChatEntry } from './session-chats';
const file = (patch:Partial<ChatEntry>={}):ChatEntry => ({id:'id',from:'peer',text:'',direction:'outgoing',timestamp:1,file:{id:'id',name:'file',mime:'application/octet-stream',size:100,sha256:'a'.repeat(64)},fileStatus:'queued',...patch});
it('counts directions separately, including queued files and byte-weighted progress',()=>{
  const summary=transferActivity([file({fileStatus:'sending',fileProgress:50}),file(),file({direction:'incoming',fileStatus:'receiving',fileProgress:20})]);
  expect(summary.outgoing).toMatchObject({count:2,active:1,waiting:1,failed:0,percent:25});
  expect(summary.incoming).toMatchObject({count:1,active:1,percent:20});
});
it('disappears after durable node/receiver confirmation, excludes unaccepted offers, and retains failures visibly',()=>{
  const result=transferActivity([file({delivery:'stored'}),file({fileStatus:'offered',fileProgress:100}),file({fileStatus:'ready'}),
    file({fileStatus:'canceled'}),file({fileStatus:'rejected'}),file({fileDeleted:true}),file({restoredFromBackup:true}),
    file({direction:'incoming',fileStatus:'offered'}),file({fileStatus:'failed'})]);
  expect(result.outgoing).toMatchObject({count:2,failed:1,waiting:1,active:0});expect(result.incoming.count).toBe(0);
  expect(transferActivity([file({direction:'incoming',fileStatus:'receiving',fileProgress:100})]).incoming.count).toBe(1); // still verifying/saving
});
it('includes explicitly accepted waiting downloads and clamps invalid byte progress',()=>{
  expect(transferActivity([file({direction:'incoming',fileStatus:'queued',fileAccepted:true,fileProgress:Infinity})]).incoming).toMatchObject({count:1,waiting:1,percent:0});
  expect(transferActivity([file({fileStatus:'sending',fileProgress:500})]).outgoing.percent).toBe(100);
  expect(transferActivity([file({fileStatus:'sending',fileProgress:-2})]).outgoing.percent).toBe(0);
});

it('does not mistake stale sending bytes during automatic retry or encryption for an active network upload',()=>{
 expect(transferActivity([file({fileStatus:'sending',fileProgress:50,courierStage:'retrying'})]).outgoing).toMatchObject({active:0,waiting:1,percent:50});
 expect(transferActivity([file({courierStage:'preparing'})]).outgoing).toMatchObject({active:0,waiting:1});
 expect(transferActivity([file({fileStatus:'sending',courierStage:'uploading'})]).outgoing).toMatchObject({active:1,waiting:0});
});
