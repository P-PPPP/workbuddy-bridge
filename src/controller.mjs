import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AcpWorker } from './acp.mjs';
import { Journal } from './journal.mjs';
import { STATE, TERMINAL, ListenerError, clean, publicError, now } from './common.mjs';
import { catalogs, publicCatalog, resolveSelection } from './catalog.mjs';

export class Controller {
  constructor({ dataDir = STATE, workerFactory = options => new AcpWorker(options) } = {}) {
    this.dataDir = dataDir; this.workerFactory = workerFactory; this.journal = new Journal(path.join(dataDir, 'journal.sqlite'));
    this.bus = new EventEmitter(); this.bus.setMaxListeners(200); this.live = new Map(); this.sessions = new Map(); this.submissionTail = Promise.resolve(); this.closing = false;
    this.defaults = this.journal.getMeta('defaults', { model: undefined, mcp_servers: [], skills: [] });
    for (const s of this.journal.sessions()) { s.connection = 'disconnected'; s.active_task_id = null; this.sessions.set(s.id, s); this.journal.saveSession(s); }
    for (const t of this.journal.tasks()) if (!TERMINAL.has(t.status)) { t.status = 'unknown'; t.error = { code: 'SERVER_RESTARTED', message: 'The listener restarted before it could confirm this task outcome. Start a new managed session; journaled messages remain available.' }; this.journal.saveTask(t); this.journal.event(t.id, { type: 'task_state', status: 'unknown', error: t.error }); }
  }
  getSession(id) { const s = this.sessions.get(id); if (!s) throw new ListenerError('SESSION_NOT_FOUND', 'The managed session does not exist.'); return s; }
  getTask(id) { const t = this.journal.task(id); if (!t) throw new ListenerError('TASK_NOT_FOUND', 'The task does not exist.'); return t; }
  saveSession(s) { s.updated_at = now(); this.journal.saveSession(s); }
  emit(t, event) { const result = this.journal.event(t.id, event); t.last_event_at = result.timestamp; this.journal.saveTask(t); this.bus.emit(t.id); return result; }
  setState(t, status, error) { t.status = status; if (error) t.error = publicError(error); t.updated_at = now(); this.journal.saveTask(t); this.emit(t, { type: 'task_state', status, ...(t.error ? { error: t.error } : {}) }); }
  async newSession(cwd) {
    cwd = path.resolve(cwd ?? process.env.WORKBUDDY_LISTENER_WORKSPACE ?? path.join(this.dataDir, 'workspace'));
    await fs.mkdir(cwd, { recursive: true });
    const s = { id: `session_${randomUUID()}`, cwd, created_at: now(), connection: 'not_started', active_task_id: null, model: this.defaults.model, mcp_servers: [...this.defaults.mcp_servers], skills: [...this.defaults.skills] };
    this.sessions.set(s.id, s); this.saveSession(s); return s;
  }
  async ensureWorker(s) {
    if (this.live.has(s.id)) return this.live.get(s.id).ready;
    if (s.connection === 'disconnected' || s.connection === 'expired') throw new ListenerError('SESSION_EXPIRED', 'This session no longer has a live worker. Send without session_id to create a new session; old messages remain readable.');
    const selection = await resolveSelection(s);
    const worker = this.workerFactory({ profileDir: path.join(this.dataDir, 'workers', s.id), cwd: s.cwd, model: s.model, ...selection });
    const live = { worker, pendingInput: new Map() };
    this.live.set(s.id, live); s.connection = 'starting'; this.saveSession(s);
    worker.on('notification', frame => this.onNotification(s, frame));
    worker.on('request', frame => this.onRequest(s, live, frame));
    worker.on('disconnected', error => {
      s.connection = 'disconnected'; this.saveSession(s);
      const task = s.active_task_id && this.journal.task(s.active_task_id);
      if (task && !TERMINAL.has(task.status)) { this.setState(task, task.status === 'starting' ? 'failed' : 'unknown', error); s.active_task_id = null; this.saveSession(s); }
    });
    live.ready = (async () => {
      try {
        const info = await worker.start();
        const result = await worker.request('session/new', { cwd: s.cwd, mcpServers: [] }, 60000);
        s.native_session_id = result.sessionId; s.models = result.models?.availableModels ?? []; s.model = result.models?.currentModelId ?? s.model;
        s.native_capabilities = clean(info.agentCapabilities ?? {}); s.connection = 'connected'; s.selection_state = 'loaded'; this.saveSession(s);
        if (!s.native_session_id) throw new ListenerError('SESSION_CREATE_FAILED', 'WorkBuddy returned no native session ID.');
        return live;
      } catch (e) { s.connection = 'disconnected'; this.saveSession(s); await worker.close(); throw e; }
    })();
    return live.ready;
  }
  onNotification(s, frame) {
    const u = frame.params?.update;
    if (frame.method !== 'session/update' || !u) return;
    if (u.sessionUpdate === 'config_option_update') {
      const model = u.configOptions?.find(x => x.category === 'model' || x.id === 'model');
      if (model) { s.model = model.currentValue; s.models = model.options?.map(x => ({ modelId: x.value, name: x.name })) ?? s.models; this.saveSession(s); }
    }
    const task = s.active_task_id && this.journal.task(s.active_task_id);
    if (!task || TERMINAL.has(task.status)) return;
    if (u.sessionUpdate === 'agent_message_chunk') {
      const text = u.content?.text ?? '';
      task.response_model = u._meta?.['codebuddy.ai/responseModelId'] ?? task.response_model;
      task.answer = (task.answer ?? '') + text;
      this.emit(task, { type: 'assistant_message_delta', text, is_final: false });
    } else if (u.sessionUpdate === 'agent_thought_chunk') {
      // Private reasoning is not collected or relayed. Report only activity.
      if (task.phase !== 'thinking') { task.phase = 'thinking'; this.emit(task, { type: 'activity', phase: 'thinking' }); }
    } else if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      this.emit(task, { type: 'tool_activity', tool_call_id: u.toolCallId, title: u.title, status: u.status, content: u.content, raw_output: u.rawOutput });
    } else if (u.sessionUpdate === 'session_info_update') {
      const phase = u._meta?.['codebuddy.ai/agentPhase']?.phase;
      if (phase && phase !== task.phase) { task.phase = phase; this.emit(task, { type: 'activity', phase }); }
    } else if (u.sessionUpdate === 'available_commands_update') { s.available_commands = u.availableCommands?.map(x => x.name); this.saveSession(s); }
  }
  onRequest(s, live, frame) {
    const task = s.active_task_id && this.journal.task(s.active_task_id);
    if (!task || TERMINAL.has(task.status)) { live.worker.respond(frame.id, { outcome: { outcome: 'cancelled' } }); return; }
    const id = `input_${randomUUID()}`;
    live.pendingInput.set(id, frame);
    task.pending_input = { id, method: frame.method, params: clean(frame.params) };
    this.setState(task, 'waiting_for_user'); this.emit(task, { type: 'input_required', ...task.pending_input });
  }
  async sendMessage(args) {
    if (args.reply_to_interruption_id) return this.replyInput(args);
    if (!args.message?.trim()) throw new ListenerError('MESSAGE_REQUIRED', 'message must contain text.');
    // Serialize admission across requests, including new-session creation.
    const run = this.submissionTail.then(() => this.admitMessage(args)); this.submissionTail = run.catch(() => {}); return run;
  }
  async admitMessage(args) {
    const fingerprint = createHash('sha256').update(JSON.stringify({ message: args.message, session_id: args.session_id ?? null, cwd: args.cwd ?? null })).digest('hex');
    if (args.request_id) {
      const previous = this.journal.request(args.request_id);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ListenerError('REQUEST_ID_CONFLICT', 'request_id was already used with different content.');
        return { ...this.taskSummary(this.getTask(previous.task_id)), duplicate: true };
      }
    }
    const s = args.session_id ? this.getSession(args.session_id) : await this.newSession(args.cwd);
    if (s.active_task_id) throw new ListenerError('SESSION_BUSY', 'Wait for or stop the active task before sending another turn.');
    if (s.connection === 'disconnected' || s.connection === 'expired') throw new ListenerError('SESSION_EXPIRED', 'Send without session_id to start a fresh managed session.');
    const t = { id: `task_${randomUUID()}`, session_id: s.id, status: 'starting', message: args.message, answer: '', created_at: now(), updated_at: now() };
    this.journal.saveTask(t); if (args.request_id) this.journal.recordRequest(args.request_id, fingerprint, t.id);
    s.active_task_id = t.id; this.saveSession(s); this.emit(t, { type: 'user_message', text: args.message });
    setImmediate(() => this.runTask(s, t.id).catch(() => {}));
    return this.taskSummary(t);
  }
  taskSummary(t) { return clean({ task_id: t.id, session_id: t.session_id, status: t.status, error: t.error ?? null }); }
  async runTask(s, id) {
    let task = this.getTask(id);
    try {
      const live = await this.ensureWorker(s);
      task = this.getTask(id); if (TERMINAL.has(task.status)) return;
      if (task.cancel_requested) { this.setState(task, 'cancelled'); return; }
      this.setState(task, 'running');
      const result = await live.worker.request('session/prompt', { sessionId: s.native_session_id, prompt: [{ type: 'text', text: task.message }] }, Number(process.env.WORKBUDDY_LISTENER_TASK_TIMEOUT_MS ?? 1800000));
      task = this.getTask(id); if (TERMINAL.has(task.status)) return;
      task.native_stop_reason = result.stopReason;
      const nativeError = result._meta?.['codebuddy.ai/errorMessage'] ?? result.errorMessage;
      if (result.stopReason === 'cancelled') this.setState(task, 'cancelled');
      else if (nativeError || result.stopReason === 'refusal') {
        this.setState(task, 'failed', new ListenerError(/auth/i.test(nativeError ?? '') ? 'AUTH_REQUIRED' : 'WORKBUDDY_REFUSED', nativeError ?? 'WorkBuddy refused the request.'));
      } else { this.emit(task, { type: 'assistant_message', text: task.answer ?? '', is_final: true }); this.setState(task, 'completed'); }
    } catch (e) {
      task = this.getTask(id);
      if (!TERMINAL.has(task.status)) {
        this.setState(task, e.code === 'ACP_TIMEOUT' ? 'unknown' : 'failed', e);
        if (e.code === 'ACP_TIMEOUT') await this.live.get(s.id)?.worker.close();
      }
    } finally {
      if (s.active_task_id === id) { s.active_task_id = null; this.saveSession(s); }
      const live = this.live.get(s.id); if (live) { clearInterval(live.cancelTimer); live.cancelTimer = undefined; live.pendingInput.clear(); }
    }
  }
  getMessage({ task_id, after_cursor = '0', limit = 100, include_partial = true }) {
    const t = this.getTask(task_id);
    if (!/^\d+$/.test(String(after_cursor)) || !Number.isSafeInteger(Number(after_cursor))) throw new ListenerError('CURSOR_INVALID', 'after_cursor must be a nonnegative integer string.');
    const { events, has_more } = this.journal.events(t.id, String(after_cursor), limit, include_partial);
    return { ...this.taskSummary(t), events, next_cursor: events.at(-1)?.cursor ?? String(after_cursor), has_more, ...(TERMINAL.has(t.status) ? { answer: t.answer ?? '' } : {}) };
  }
  async waitForMessage(args, signal) {
    const first = this.getMessage(args);
    if (first.events.length || TERMINAL.has(first.status) || first.status === 'waiting_for_user') return { ...first, timed_out: false };
    const ms = Math.min(60, Math.max(0, args.timeout_seconds ?? 30)) * 1000;
    let timer, listener, aborted;
    await new Promise(resolve => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(timer); this.bus.off(args.task_id, listener); signal?.removeEventListener('abort', aborted); resolve(); };
      listener = () => { const r = this.getMessage(args); if (r.events.length || TERMINAL.has(r.status) || r.status === 'waiting_for_user') finish(); }; aborted = finish;
      this.bus.on(args.task_id, listener); timer = setTimeout(finish, ms); signal?.addEventListener('abort', aborted, { once: true });
      // Recheck after subscription to avoid losing an event in the admission gap.
      const latest = this.getMessage(args); if (latest.events.length || TERMINAL.has(latest.status) || signal?.aborted) finish();
    });
    const result = this.getMessage(args);
    return { ...result, timed_out: !result.events.length && !TERMINAL.has(result.status) && result.status !== 'waiting_for_user' };
  }
  async selectModel({ session_id, model_id } = {}) {
    const s = session_id ? this.getSession(session_id) : await this.newSession();
    if (s.active_task_id) throw new ListenerError('SESSION_BUSY', 'Cannot change/list model configuration during an active turn.');
    const live = await this.ensureWorker(s);
    if (model_id) {
      if (!s.models.some(m => m.modelId === model_id)) throw new ListenerError('MODEL_NOT_AVAILABLE', 'Select one of the runtime-reported model IDs.');
      await live.worker.request('session/set_model', { sessionId: s.native_session_id, modelId: model_id });
      s.model = model_id; this.saveSession(s);
    }
    return { session_id: s.id, selected_model: s.model, available_models: s.models, acknowledged: true };
  }
  async selectMcpOrSkills(args = {}) {
    const catalog = await catalogs();
    const changing = args.mcp_servers !== undefined || args.skills !== undefined;
    const target = args.session_id ? this.getSession(args.session_id) : this.defaults;
    if (changing) {
      if (target.active_task_id) throw new ListenerError('SESSION_BUSY', 'Cannot change MCP servers or skills during an active task.');
      if (args.session_id && this.live.has(args.session_id)) throw new ListenerError('SESSION_ALREADY_STARTED', 'MCP/skill selections are immutable for a started worker. Select defaults, then send without session_id to create a new worker.');
      const selected = { mcp_servers: [...new Set(args.mcp_servers ?? target.mcp_servers)], skills: [...new Set(args.skills ?? target.skills)] };
      await resolveSelection(selected); Object.assign(target, selected);
      if (args.session_id) this.saveSession(target); else this.journal.setMeta('defaults', this.defaults);
    }
    return { scope: args.session_id ?? 'new_sessions', selection: { mcp_servers: target.mcp_servers, skills: target.skills }, state: args.session_id && this.live.has(args.session_id) ? 'loaded' : 'ready_for_next_session', ...publicCatalog(catalog) };
  }
  async replyInput(args) {
    if (!args.session_id) throw new ListenerError('SESSION_REQUIRED', 'session_id is required for an interruption reply.');
    const s = this.getSession(args.session_id), live = this.live.get(s.id), frame = live?.pendingInput.get(args.reply_to_interruption_id);
    if (!frame) throw new ListenerError('INPUT_NOT_FOUND', 'The pending interruption does not exist or has already been answered.');
    const t = this.getTask(s.active_task_id);
    let result;
    if (frame.method === 'session/request_permission') {
      const id = args.permission_option_id;
      if (!frame.params?.options?.some(x => x.optionId === id)) throw new ListenerError('OPTION_INVALID', 'permission_option_id must match a pending permission option.');
      result = { outcome: { outcome: 'selected', optionId: id } };
    } else if (frame.method === 'elicitation/create') {
      result = { action: args.elicitation_action ?? 'cancel', ...(args.elicitation_content ? { content: args.elicitation_content } : {}) };
    } else throw new ListenerError('INTERACTION_UNSUPPORTED', `The adapter does not implement replies to ${frame.method}. Stop the task or respond through a supported interface.`);
    live.worker.respond(frame.id, result); live.pendingInput.delete(args.reply_to_interruption_id); delete t.pending_input; this.journal.saveTask(t); this.setState(t, 'running'); return this.taskSummary(t);
  }
  async stopTask({ task_id, force = false }) {
    let t = this.getTask(task_id); if (TERMINAL.has(t.status)) return { ...this.taskSummary(t), already_terminal: true };
    const s = this.getSession(t.session_id), live = this.live.get(s.id);
    t.cancel_requested = true; this.journal.saveTask(t);
    if (!live || s.connection === 'starting') { this.setState(t, 'cancelling'); return this.taskSummary(t); }
    for (const [id, frame] of live.pendingInput) { live.worker.respond(frame.id, { outcome: { outcome: 'cancelled' } }); live.pendingInput.delete(id); }
    this.setState(t, 'cancelling'); live.worker.notify('session/cancel', { sessionId: s.native_session_id });
    // The native process may register the prompt's abort controller after it
    // accepts the ACP request. Repeat cancellation until the turn confirms its
    // outcome, including that short startup gap. Never retry another task.
    if (!live.cancelTimer) {
      live.cancelTimer = setInterval(() => {
        const current = this.journal.task(task_id);
        if (!current || TERMINAL.has(current.status) || s.active_task_id !== task_id) {
          clearInterval(live.cancelTimer); live.cancelTimer = undefined; return;
        }
        try { live.worker.notify('session/cancel', { sessionId: s.native_session_id }); }
        catch { clearInterval(live.cancelTimer); live.cancelTimer = undefined; }
      }, 1000);
      live.cancelTimer.unref();
    }
    if (force) {
      await new Promise(resolve => setTimeout(resolve, 1500)); t = this.getTask(task_id);
      if (!TERMINAL.has(t.status)) {
        // Record the distinction between verified native cancellation and killing
        // the listener-owned worker. The desktop application is never targeted.
        this.setState(t, 'cancelled'); t.forced_worker_termination = true; this.journal.saveTask(t);
        s.active_task_id = null; await live.worker.close(); this.saveSession(s);
      }
    }
    return { ...this.taskSummary(this.getTask(task_id)), forced_worker_termination: this.getTask(task_id).forced_worker_termination ?? false };
  }
  async getStatus({ task_id, session_id } = {}) {
    if (task_id) {
      const t = this.getTask(task_id), s = this.getSession(t.session_id);
      return { ...this.taskSummary(t), connection: s.connection, selected_model: s.model, response_model: t.response_model, mcp_servers: s.mcp_servers, skills: s.skills, phase: t.phase, pending_input: t.pending_input, last_event_at: t.last_event_at, forced_worker_termination: t.forced_worker_termination ?? false };
    }
    if (session_id) { const s = this.getSession(session_id); return clean({ session_id: s.id, connection: s.connection, active_task_id: s.active_task_id, selected_model: s.model, mcp_servers: s.mcp_servers, skills: s.skills, native_capabilities: s.native_capabilities }); }
    return { server: 'workbuddy-bridge', version: '0.1.0', transport: 'stdio', status: 'ready', managed_sessions: [...this.sessions.values()].map(s => ({ session_id: s.id, connection: s.connection, active_task_id: s.active_task_id, selected_model: s.model })), defaults: this.defaults, scope: 'listener-owned native ACP sessions', authentication: 'Desktop access token is loaded inside each native worker, kept in memory, and never returned over MCP.', ...publicCatalog(await catalogs()) };
  }
  async close() {
    this.closing = true;
    for (const live of this.live.values()) { clearInterval(live.cancelTimer); live.cancelTimer = undefined; }
    for (const s of this.sessions.values()) if (s.active_task_id) {
      const t = this.getTask(s.active_task_id);
      if (!TERMINAL.has(t.status)) this.setState(t, 'unknown', new ListenerError('LISTENER_CLOSED', 'Listener closed before the task outcome was confirmed.'));
    }
    await Promise.all([...this.live.values()].map(x => x.worker.close()));
    this.journal.close();
  }
}
