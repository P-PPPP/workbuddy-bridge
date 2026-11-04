import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Controller } from '../src/controller.mjs';
import { ListenerError } from '../src/common.mjs';
import { workerEnvironment } from '../src/acp.mjs';

class FakeWorker extends EventEmitter {
  constructor() { super(); this.calls = []; this.closed = false; }
  async start() { return { agentCapabilities: {} }; }
  request(method, params) {
    this.calls.push({ method, params });
    if (method === 'session/new') return Promise.resolve({ sessionId: 'native1', models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto' }, { modelId: 'model2' }] } });
    if (method === 'session/set_model') return Promise.resolve({});
    if (method === 'session/prompt') return new Promise((resolve, reject) => { this.promptResolve = resolve; this.promptReject = reject; });
    return Promise.resolve({});
  }
  notify(method) { if (method === 'session/cancel') this.promptResolve?.({ stopReason: 'cancelled' }); }
  respond(id, result) { this.lastResponse = { id, result }; }
  chunk(text) { this.emit('notification', { method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { text } } } }); }
  finish() { this.promptResolve({ stopReason: 'end_turn' }); }
  async close() { this.closed = true; this.promptReject?.(new ListenerError('WORKER_CLOSED', 'Worker closed.')); }
}
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-listener-test-'));
  const workers = [];
  const c = new Controller({ dataDir: dir, workerFactory: () => { const w = new FakeWorker(); workers.push(w); return w; } });
  t.after(async () => { if (!c.testClosed) await c.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { c, workers, dir };
}
async function running(c, task) {
  for (let i = 0; i < 50; i++) { const t = c.getTask(task.task_id); if (t.status === 'running') return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('Fake task did not start.');
}
async function terminal(c, task) {
  for (let i = 0; i < 50; i++) { if (['completed','failed','cancelled','unknown'].includes(c.getTask(task.task_id).status)) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('Fake task did not finish.');
}
test('concurrent retries submit exactly one native prompt', async t => {
  const { c, workers } = await setup(t);
  const args = { message: 'hello', request_id: 'same' };
  const tasks = await Promise.all([c.sendMessage(args), c.sendMessage(args), c.sendMessage(args)]);
  assert.equal(new Set(tasks.map(x => x.task_id)).size, 1);
  await running(c, tasks[0]); assert.equal(workers[0].calls.filter(x => x.method === 'session/prompt').length, 1);
  await assert.rejects(c.sendMessage({ message: 'different', request_id: 'same' }), e => e.code === 'REQUEST_ID_CONFLICT');
});
test('cursor ordering, Unicode chunks and final answer survive persistence', async t => {
  const { c, workers } = await setup(t); const task = await c.sendMessage({ message: 'hello' }); await running(c, task);
  workers[0].chunk('你好'); workers[0].chunk('🌏'); workers[0].finish(); await terminal(c, task);
  const r = c.getMessage({ task_id: task.task_id, include_partial: false }); assert.equal(r.answer, '你好🌏'); assert.ok(r.events.some(e => e.is_final));
  assert.equal(c.getMessage({ task_id: task.task_id, after_cursor: r.next_cursor }).events.length, 0);
  assert.throws(() => c.getMessage({ task_id: task.task_id, after_cursor: '-1' }), e => e.code === 'CURSOR_INVALID');
});
test('wait timeout leaves task running and hidden deltas do not end the wait', async t => {
  const { c, workers } = await setup(t); const task = await c.sendMessage({ message: 'hello' }); await running(c, task);
  const cursor = c.getMessage({ task_id: task.task_id }).next_cursor;
  const start = Date.now();
  const waiting = c.waitForMessage({ task_id: task.task_id, after_cursor: cursor, timeout_seconds: 0.08, include_partial: false });
  setTimeout(() => workers[0].chunk('partial'), 10);
  const result = await waiting; assert.ok(Date.now() - start >= 60); assert.equal(result.timed_out, true); assert.equal(result.status, 'running');
});
test('wait returns new events once and terminal wait returns immediately', async t => {
  const { c, workers } = await setup(t); const task = await c.sendMessage({ message: 'hello' }); await running(c, task);
  const cursor = c.getMessage({ task_id: task.task_id }).next_cursor;
  const wait = c.waitForMessage({ task_id: task.task_id, after_cursor: cursor, timeout_seconds: 1 });
  workers[0].chunk('new'); assert.equal((await wait).events[0].text, 'new'); workers[0].finish(); await terminal(c, task);
  const end = c.getMessage({ task_id: task.task_id }).next_cursor;
  assert.equal((await c.waitForMessage({ task_id: task.task_id, after_cursor: end, timeout_seconds: 10 })).status, 'completed');
});
test('native cancellation is confirmed and repeated stop is idempotent', async t => {
  const { c } = await setup(t); const task = await c.sendMessage({ message: 'hello' }); await running(c, task);
  await c.stopTask({ task_id: task.task_id }); await terminal(c, task);
  assert.equal(c.getTask(task.task_id).status, 'cancelled'); assert.equal((await c.stopTask({ task_id: task.task_id })).already_terminal, true);
});
test('cancellation before worker startup never submits a prompt', async t => {
  const { c, workers } = await setup(t); const task = await c.sendMessage({ message: 'hello' });
  await c.stopTask({ task_id: task.task_id }); await terminal(c, task);
  assert.equal(c.getTask(task.task_id).status, 'cancelled'); assert.equal(workers[0].calls.some(x => x.method === 'session/prompt'), false);
});

test('startup cancellation retries until native confirmation', async t => {
  const { c, workers } = await setup(t); const task = await c.sendMessage({ message: 'hello' }); await running(c, task);
  let attempts = 0;
  workers[0].notify = method => { if (method === 'session/cancel' && ++attempts === 2) workers[0].promptResolve({ stopReason: 'cancelled' }); };
  await c.stopTask({ task_id: task.task_id });
  await new Promise(resolve => setTimeout(resolve, 1150));
  assert.equal(c.getTask(task.task_id).status, 'cancelled'); assert.equal(attempts, 2);
  assert.equal(c.live.get(task.session_id).cancelTimer, undefined);
});

test('native worker strips inherited routing and credentials but keeps the proxy', () => {
  const env = workerEnvironment({ PATH: 'keep', HTTPS_PROXY: 'http://127.0.0.1:7897', CODEBUDDY_BASE_URL: 'https://wrong.invalid', CODEBUDDY_AUTH_TOKEN: 'old', ACC_PRODUCT_CONFIG_V3: 'custom', ANTHROPIC_API_KEY: 'old', OPENAI_API_KEY: 'old', NODE_OPTIONS: '--require unrelated.cjs', WORKBUDDY_LISTENER_SKILL_FILE: 'unselected.md' }, { profileDir: 'isolated' });
  for (const key of ['CODEBUDDY_BASE_URL', 'CODEBUDDY_AUTH_TOKEN', 'ACC_PRODUCT_CONFIG_V3', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'WORKBUDDY_LISTENER_SKILL_FILE']) assert.equal(env[key], undefined);
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7897'); assert.equal(env.CODEBUDDY_CONFIG_DIR, 'isolated'); assert.ok(env.ACC_PRODUCT_CONFIG_PATH.endsWith('product.json'));
});
test('worker failure reports unknown instead of pretending completion', async t => {
  const { c, workers } = await setup(t); const task = await c.sendMessage({ message: 'hello' }); await running(c, task);
  workers[0].chunk('saved'); workers[0].emit('disconnected', new ListenerError('WORKER_EXITED', 'Process exited.'));
  assert.equal(c.getTask(task.task_id).status, 'unknown'); assert.equal(c.getMessage({ task_id: task.task_id }).answer, 'saved');
});
test('restart preserves output, marks unfinished outcome unknown, and rejects expired session', async t => {
  const { c, workers, dir } = await setup(t); const task = await c.sendMessage({ message: 'hello' }); await running(c, task); workers[0].chunk('durable');
  await c.close(); c.testClosed = true;
  const recovered = new Controller({ dataDir: dir });
  try { assert.equal(recovered.getTask(task.task_id).status, 'unknown'); assert.equal(recovered.getMessage({ task_id: task.task_id }).answer, 'durable'); await assert.rejects(recovered.sendMessage({ session_id: task.session_id, message: 'resume' }), e => e.code === 'SESSION_EXPIRED'); }
  finally { await recovered.close(); }
});
test('model selection validates actual models and rejects busy changes', async t => {
  const { c } = await setup(t); const selected = await c.selectModel({ model_id: 'model2' }); assert.equal(selected.selected_model, 'model2');
  await assert.rejects(c.selectModel({ session_id: selected.session_id, model_id: 'missing' }), e => e.code === 'MODEL_NOT_AVAILABLE');
  const task = await c.sendMessage({ session_id: selected.session_id, message: 'hello' });
  await assert.rejects(c.selectModel({ session_id: selected.session_id, model_id: 'auto' }), e => e.code === 'SESSION_BUSY'); await running(c, task);
});
test('MCP/skill selection rejects missing packages and mutation of started workers', async t => {
  const { c } = await setup(t); await assert.rejects(c.selectMcpOrSkills({ skills: ['missing-test-skill-94827'] }), e => e.code === 'SKILL_NOT_FOUND');
  await assert.rejects(c.selectMcpOrSkills({ mcp_servers: ['missing-test-server-94827'] }), e => e.code === 'MCP_NOT_FOUND');
  const s = await c.selectModel({}); await assert.rejects(c.selectMcpOrSkills({ session_id: s.session_id, skills: [] }), e => e.code === 'SESSION_ALREADY_STARTED');
});
test('permission requests pause execution until an exact structured answer', async t => {
  const { c, workers } = await setup(t); const task = await c.sendMessage({ message: 'hello' }); await running(c, task);
  workers[0].emit('request', { jsonrpc: '2.0', id: 91, method: 'session/request_permission', params: { options: [{ optionId: 'allow1', kind: 'allow_once' }] } });
  const state = await c.getStatus({ task_id: task.task_id }); assert.equal(state.status, 'waiting_for_user'); assert.equal(workers[0].lastResponse, undefined);
  await assert.rejects(c.sendMessage({ session_id: task.session_id, reply_to_interruption_id: state.pending_input.id, permission_option_id: 'invalid' }), e => e.code === 'OPTION_INVALID');
  await c.sendMessage({ session_id: task.session_id, reply_to_interruption_id: state.pending_input.id, permission_option_id: 'allow1' });
  assert.deepEqual(workers[0].lastResponse.result, { outcome: { outcome: 'selected', optionId: 'allow1' } });
  assert.equal(c.getTask(task.task_id).status, 'running');
});
