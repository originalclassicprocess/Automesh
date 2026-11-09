import {test} from 'vitest';
import assert from 'node:assert/strict';
import {nodeUpdateSettings} from '../scripts/update-hosted-node.mjs';
const env={SSH_USER:'example',SSH_HOST:'hosting.example',SSH_PORT:'21098',DEPLOY_ROOT:'/home/example/automesh-app',
 DEPLOY_NODE_BIN:'/home/example/nodevenv/automesh-app/24/bin/node',DEPLOY_ORIGIN:'https://chat.example',NODE_ORIGIN:'https://node.chat.example',DEPLOY_RUN_ID:'123-1'};
test('node update derives a separate target and requires explicit HTTPS node identity',()=>{
 const c=nodeUpdateSettings(env);assert.equal(c.root,'/home/example/automesh-node-app');assert.equal(c.node,'/home/example/nodevenv/automesh-node-app/24/bin/node');
 assert.equal(c.stage,'/home/example/.automesh-node-updates/123-1');
 for(const edit of [{NODE_ORIGIN:env.DEPLOY_ORIGIN},{NODE_ORIGIN:'http://node.chat.example'},{NODE_ORIGIN:'https://node.chat.example/secret'},
  {NODE_ORIGIN:'https://user:secret@node.chat.example'},{DEPLOY_RUN_ID:'../../outside'},{SSH_USER:'../../outside'}])assert.throws(()=>nodeUpdateSettings({...env,...edit}));
});
