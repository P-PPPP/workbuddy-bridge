import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveSelection } from '../src/catalog.mjs';

test('new and legacy worker names cannot be selected recursively', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbuddy-recursion-test-'));
 const previous=process.env.WORKBUDDY_LISTENER_CONFIG;
 const names=['workbuddy-bridge','workbuddy_bridge','WorkBuddyBridge','workbuddy-local-worker','workbuddy_local_worker','WorkbuddyLocalWorker','workbuddy-listener'];
 const config=path.join(dir,'listener.config.json');
 await fs.writeFile(config,JSON.stringify({mcpServers:Object.fromEntries([...names,'ordinary-echo'].map(id=>[id,{command:'node',args:[]}]))}));
 process.env.WORKBUDDY_LISTENER_CONFIG=config;
 try{
  for(const name of names)await assert.rejects(resolveSelection({mcp_servers:[name],skills:[]}),e=>e.code==='RECURSIVE_LISTENER');
  assert.ok((await resolveSelection({mcp_servers:['ordinary-echo'],skills:[]})).mcpServers['ordinary-echo']);
 }finally{if(previous===undefined)delete process.env.WORKBUDDY_LISTENER_CONFIG;else process.env.WORKBUDDY_LISTENER_CONFIG=previous;await fs.rm(dir,{recursive:true,force:true});}
});

test('live tests refuse execution without explicit opt-in and chosen models',()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const r=spawnSync(process.execPath,[path.join(root,'test/live.mjs')],{encoding:'utf8',cwd:root,env:{...process.env,WORKBUDDY_LIVE_TESTS:'',WORKBUDDY_TEST_MODEL:'',WORKBUDDY_TEST_SECOND_MODEL:''},windowsHide:true,timeout:15000});
 assert.equal(r.status,1);assert.match(r.stderr,/Live tests make real model calls/);assert.doesNotMatch(r.stdout,/PASS|Report:/);
});
