import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { APP, ListenerError, clean } from './common.mjs';

export function workerEnvironment(source, options, skillFile) {
  const env = { ...source };
  // Desktop credentials must use the installed product's endpoint, never an
  // inherited API key, custom gateway, product override, or child Node preload.
  for (const key of Object.keys(env)) {
    if (/^(CODEBUDDY_|ACC_|ANTHROPIC_|OPENAI_)/i.test(key) || /^(NODE_OPTIONS|ELECTRON_RUN_AS_NODE|WORKBUDDY_LISTENER_SKILL_FILE)$/i.test(key)) delete env[key];
  }
  return { ...env, ELECTRON_RUN_AS_NODE: '1', CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1', CODEBUDDY_FORCE_HEADLESS_BUNDLE: '1', DISABLE_AUTOUPDATER: '1', CODEBUDDY_DISABLE_CRON: '1', CODEBUDDY_API_KEY_HELPER_DISABLED: '1', CODEBUDDY_SKIP_GIT_BASH_CHECK: '1', CODEBUDDY_CONFIG_DIR: options.profileDir, WORKBUDDY_CONFIG_DIR: options.profileDir, CODEBUDDY_HOST: 'workbuddy-desktop', ACC_PRODUCT_CONFIG_PATH: path.join(APP, 'resources', 'app.asar.unpacked', 'cli', 'product.json'), ...(skillFile ? { WORKBUDDY_LISTENER_SKILL_FILE: skillFile } : {}) };
}

export class AcpWorker extends EventEmitter {
  constructor(options) { super(); this.options = options; this.pending = new Map(); this.nextId = 1; this.closed = false; this.stderrTail = ''; }
  async start() {
    const o = this.options;
    await fs.mkdir(o.profileDir, { recursive: true });
    const mcpPath = path.join(o.profileDir, 'selected-mcp.json');
    await fs.writeFile(mcpPath, JSON.stringify({ mcpServers: o.mcpServers ?? {} }));
    const args = ['--require', fileURLToPath(new URL('./worker-auth.cjs', import.meta.url)), path.join(APP, 'resources', 'app.asar', 'cli', 'bin', 'codebuddy'), '--serve', '--port', '0', '--host', '127.0.0.1', '--acp', '--no-session-persistence', '--setting-sources', '', '--permission-mode', 'default', '--strict-mcp-config', '--mcp-config', mcpPath];
    if (o.tools !== undefined) args.push('--tools', o.tools);
    if (o.model) args.push('--model', o.model);
    let skillFile;
    if (o.skillText) {
      const file = path.join(o.profileDir, 'selected-skills.md');
      await fs.writeFile(file, o.skillText);
      skillFile = file;
    }
    const env = workerEnvironment(process.env, o, skillFile);
    this.child = spawn(path.join(APP, 'WorkBuddy.exe'), args, { cwd: o.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    this.child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > 8 * 1024 * 1024) { this.fail(new ListenerError('FRAME_TOO_LARGE', 'WorkBuddy emitted an oversized ACP frame.')); return; }
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        this.frame(frame);
      }
    });
    this.child.stderr.on('data', chunk => { this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000); });
    this.child.stdin.on('error', () => {});
    this.child.on('error', () => this.fail(new ListenerError('WORKER_START_FAILED', 'Could not launch the installed WorkBuddy runtime.')));
    this.child.on('exit', (code, signal) => this.fail(new ListenerError('WORKER_EXITED', `WorkBuddy worker exited (code ${code}, signal ${signal}).`)));
    this.info = await this.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'workbuddy-local-worker', version: '0.1.0' } }, 30000);
    return this.info;
  }
  frame(frame) {
    if (frame.id !== undefined && frame.method) {
      if (this.listenerCount('request')) this.emit('request', frame);
      else this.respond(frame.id, { outcome: { outcome: 'cancelled' } });
    } else if (frame.id !== undefined) {
      const item = this.pending.get(frame.id);
      if (!item) return;
      clearTimeout(item.timer); this.pending.delete(frame.id);
      if (frame.error) item.reject(new ListenerError('ACP_ERROR', frame.error.message ?? 'WorkBuddy rejected the request.', clean({ nativeCode: frame.error.code, data: frame.error.data })));
      else item.resolve(frame.result);
    } else if (frame.method) this.emit('notification', frame);
  }
  write(frame) {
    if (this.closed || !this.child?.stdin.writable) throw new ListenerError('WORKER_NOT_CONNECTED', 'The managed WorkBuddy worker is not connected.');
    this.child.stdin.write(JSON.stringify(frame) + '\n');
  }
  request(method, params, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new ListenerError('ACP_TIMEOUT', `WorkBuddy did not acknowledge ${method} in time.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ jsonrpc: '2.0', id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  notify(method, params) { this.write({ jsonrpc: '2.0', method, params }); }
  respond(id, result) { this.write({ jsonrpc: '2.0', id, result }); }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear(); this.emit('disconnected', error);
  }
  async close() {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      this.fail(new ListenerError('WORKER_CLOSED', 'Managed worker was closed.'));
      // Windows process-tree termination is scoped to this exact owned worker,
      // including any MCP children it launched. Never target an image name.
      if (process.platform === 'win32' && this.child.pid) {
        await new Promise(resolve => {
          const killer = spawn('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.once('error', () => { this.child.kill(); resolve(); });
          killer.once('exit', code => { if (code && this.child.exitCode === null) this.child.kill(); resolve(); });
        });
      } else this.child.kill();
      this.child.stdin.end();
      await new Promise(resolve => { if (this.child.exitCode !== null) return resolve(); const timer = setTimeout(resolve, 3000); this.child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
  }
}
