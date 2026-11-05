import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config={mcpServers:{'workbuddy-link':{command:process.execPath,args:[path.join(root,'src','server.mjs')]}}};
const json=JSON.stringify(config,null,2)+'\n';
if(process.argv[2]==='--out'){
  if(!process.argv[3])throw Error('Supply an output filename after --out.');
  await fs.writeFile(path.resolve(process.argv[3]),json);
  process.stderr.write('Wrote local MCP configuration. Merge its server entry into your client settings.\n');
}else process.stdout.write(json);
