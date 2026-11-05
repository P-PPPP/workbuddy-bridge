import fs from 'node:fs/promises';
import path from 'node:path';
import { APP, WBHOME, PROJECT, ListenerError } from './common.mjs';

async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw new ListenerError('CONFIG_INVALID', `Could not read configuration: ${file}`); } }
export async function catalogs() {
  const configFile = process.env.WORKBUDDY_LISTENER_CONFIG ?? path.join(PROJECT, 'listener.config.json');
  const local = await readJson(configFile, {});
  const desktop = await readJson(path.join(WBHOME, 'mcp.json'), {});
  const servers = { ...desktop.mcpServers, ...local.mcpServers };
  const skills = {};
  const roots = [path.join(WBHOME, 'skills'), path.join(APP, 'resources', 'app.asar.unpacked', 'resources', 'plugins', 'workbuddy-builtin', 'skills')];
  for (const root of roots) {
    let dirs; try { dirs = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const file = path.join(root, dir.name, 'SKILL.md');
      try { const st = await fs.stat(file); if (st.isFile() && !skills[dir.name]) skills[dir.name] = file; } catch {}
    }
  }
  for (const [id, file] of Object.entries(local.skills ?? {})) skills[id] = path.resolve(path.dirname(configFile), file);
  return { servers, skills, configFile };
}
export function publicCatalog(c) {
  return {
    mcp_servers: Object.entries(c.servers).map(([id, s]) => ({ id, transport: s.type ?? (s.url ? 'http' : 'stdio'), desktop_disabled: !!s.disabled })),
    skills: Object.entries(c.skills).map(([id, file]) => ({ id, path: file })),
    skill_mode: 'Selected SKILL.md instructions are appended to the worker system prompt. Referenced files keep their original absolute paths. Scripts run only when requested by the skill and approved through normal tool permissions.'
  };
}
export async function resolveSelection(selection) {
  const c = await catalogs();
  const servers = {};
  for (const id of selection.mcp_servers) {
    const entry = c.servers[id];
    if (!entry) throw new ListenerError('MCP_NOT_FOUND', `MCP server '${id}' is not configured.`);
    if (/workbuddy[-_]?(?:link|bridge|listener|local[-_]?worker)/i.test(id)) throw new ListenerError('RECURSIVE_LISTENER', 'WorkBuddy-Link cannot load itself as a worker MCP server.');
    servers[id] = { ...entry, disabled: false };
  }
  const text = [];
  for (const id of selection.skills) {
    const file = c.skills[id];
    if (!file) throw new ListenerError('SKILL_NOT_FOUND', `Skill '${id}' is not installed/configured.`);
    const stat = await fs.stat(file);
    if (stat.size > 256000) throw new ListenerError('SKILL_TOO_LARGE', `Skill '${id}' exceeds 256 KB.`);
    text.push(`Selected skill: ${id}\nSkill directory: ${path.dirname(file)}\nResolve relative resources against that directory.\n<selected_skill>\n${await fs.readFile(file, 'utf8')}\n</selected_skill>`);
  }
  return { mcpServers: servers, skillText: text.join('\n\n') };
}
