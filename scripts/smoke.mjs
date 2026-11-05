import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbuddy-link-smoke-'));
const config=path.join(dir,'listener.config.json');await fs.writeFile(config,'{}');
const generated=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/print-config.mjs')],{encoding:'utf8'}));
const entry=generated.mcpServers['workbuddy-link'];
assert.equal(entry.command,process.execPath);assert.ok(path.isAbsolute(entry.args[0]));
const transport=new StdioClientTransport({...entry,cwd:os.tmpdir(),env:{...process.env,WORKBUDDY_LISTENER_DATA:path.join(dir,'data'),WORKBUDDY_LISTENER_CONFIG:config,WORKBUDDY_HOME:dir},stderr:'pipe'});
transport.stderr.on('data',()=>{});
const client=new Client({name:'workbuddy-link-smoke',version:'0.1.0'});
try{
 await client.connect(transport);
 assert.equal(client.getServerVersion().name,'workbuddy-link');
 const result=await client.listTools();
 assert.deepEqual(result.tools.map(t=>t.name).sort(),['send_message','get_message','select_model','wait_for_message','get_status','stop_task','select_mcp_or_skills'].sort());
 const status=await client.callTool({name:'get_status',arguments:{}});
 assert.notEqual(status.isError,true);assert.equal(status.structuredContent.status,'ready');
 assert.equal(status.structuredContent.server,'workbuddy-link');
 assert.deepEqual(status.structuredContent.managed_sessions,[]);
 console.log('PASS MCP handshake, project name, seven tools, isolated state, and launch from another working directory. No native worker or model request was started.');
}finally{await client.close();await fs.rm(dir,{recursive:true,force:true});}
