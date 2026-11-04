import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.WORKBUDDY_LIVE_TESTS !== '1' || !process.env.WORKBUDDY_TEST_MODEL || !process.env.WORKBUDDY_TEST_SECOND_MODEL) {
  throw Error('Live tests make real model calls. Set WORKBUDDY_LIVE_TESTS=1, WORKBUDDY_TEST_MODEL, and WORKBUDDY_TEST_SECOND_MODEL to two runtime-supported model IDs before running them.');
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(root, 'test-results', stamp);
await fs.mkdir(dir, { recursive: true });
const config = path.join(dir, 'listener.config.json');
await fs.writeFile(config, JSON.stringify({ mcpServers: { 'listener-test-echo': { type: 'stdio', command: process.execPath, args: [path.join(root, 'test', 'fixtures', 'echo-server.mjs')] } }, skills: { 'listener-test-sentinel': path.join(root, 'test', 'fixtures', 'sentinel-skill', 'SKILL.md') } }));
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src', 'server.mjs')], cwd: root, env: { ...process.env, WORKBUDDY_LISTENER_DATA: path.join(dir, 'data'), WORKBUDDY_LISTENER_CONFIG: config }, stderr: 'pipe' });
const client = new Client({ name: 'workbuddy-bridge-integration-test', version: '0.1.0' });
transport.stderr.on('data', () => {});
const report = { started_at: new Date().toISOString(), tests: [], evidence: {}, live_model_requests: 'Short text checks, one selected tool/skill check, and a cancellable response.' };
const record = (name, detail) => { report.tests.push({ name, passed: true, detail }); process.stdout.write(`PASS ${name}\n`); };
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const data = response.structuredContent ?? JSON.parse(response.content.find(c => c.type === 'text').text);
  if (response.isError) { const e = Error(`${data.error?.code}: ${data.error?.message}`); e.code = data.error?.code; throw e; }
  return data;
}
async function finishTask(task, { timeout = 120000, approveEcho = false } = {}) {
  let cursor = '0'; const all = []; const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await call('wait_for_message', { task_id: task.task_id, after_cursor: cursor, timeout_seconds: 20, limit: 500 });
    all.push(...result.events); cursor = result.next_cursor;
    if (result.status === 'waiting_for_user') {
      const status = await call('get_status', { task_id: task.task_id });
      const pending = status.pending_input;
      if (approveEcho && pending?.method === 'session/request_permission') {
        const visible = JSON.stringify(pending.params);
        if (!/listener_test_echo|listener-test-echo/.test(visible)) throw Error('Unexpected permission request; no authorization was sent.');
        const option = pending.params.options?.find(x => x.kind === 'allow_once');
        assert.ok(option, 'Expected a one-time permission option');
        await call('send_message', { session_id: task.session_id, reply_to_interruption_id: pending.id, permission_option_id: option.optionId });
      } else throw Error(`Task requires unsupported/unexpected input: ${pending?.method}`);
    }
    if (['completed', 'cancelled', 'failed', 'unknown'].includes(result.status)) return { ...result, collected_events: all };
  }
  await call('stop_task', { task_id: task.task_id, force: true });
  throw Error('Live task exceeded test timeout.');
}
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(x => x.name).sort(), ['send_message', 'get_message', 'select_model', 'wait_for_message', 'get_status', 'stop_task', 'select_mcp_or_skills'].sort());
  record('MCP handshake and exactly seven tools', tools.tools.map(x => x.name));
  const health = await call('get_status'); assert.equal(health.status, 'ready'); record('get_status', 'Server ready; catalogs returned.');
  const selected = await call('select_mcp_or_skills', { mcp_servers: [], skills: [] }); assert.deepEqual(selected.selection, { mcp_servers: [], skills: [] });
  const initialModel = await call('select_model', { model_id: process.env.WORKBUDDY_TEST_MODEL });
  assert.ok(initialModel.available_models.some(x => x.modelId === process.env.WORKBUDDY_TEST_SECOND_MODEL), 'Second requested model must be available.');
  assert.notEqual(initialModel.selected_model, process.env.WORKBUDDY_TEST_SECOND_MODEL, 'Select two distinct models for the switch test.');
  const firstArgs = { session_id: initialModel.session_id, message: 'Reply with exactly WORKBUDDY_MCP_OK. Do not use any tools.', request_id: 'test-idempotency-1' };
  const first = await call('send_message', firstArgs);
  const duplicate = await call('send_message', firstArgs);
  assert.equal(duplicate.task_id, first.task_id); assert.equal(duplicate.duplicate, true); record('Idempotent send_message', 'Retry returned the existing task.');
  await assert.rejects(call('send_message', { message: 'Different message', request_id: 'test-idempotency-1' }), e => e.code === 'REQUEST_ID_CONFLICT'); record('Conflicting request ID rejected', 'No second model submission.');
  await assert.rejects(call('send_message', { message: 'Busy turn', session_id: first.session_id }), e => e.code === 'SESSION_BUSY'); record('Busy session rejects concurrent turn', 'Active task preserved.');
  const result = await finishTask(first); assert.equal(result.status, 'completed'); assert.equal(result.answer.trim(), 'WORKBUDDY_MCP_OK');
  report.evidence.first_round_trip = { task_id: first.task_id, answer: result.answer, events: result.collected_events.length };
  record('Authenticated send/get/wait round trip', result.answer);
  const read = await call('get_message', { task_id: first.task_id, include_partial: false }); assert.ok(read.events.some(e => e.type === 'assistant_message' && e.is_final));
  const empty = await call('get_message', { task_id: first.task_id, after_cursor: read.next_cursor }); assert.equal(empty.events.length, 0); record('Cursor pagination and final messages', 'Reading after the last cursor returns no duplicate events.');
  const terminalWait = await call('wait_for_message', { task_id: first.task_id, after_cursor: read.next_cursor, timeout_seconds: 30 }); assert.equal(terminalWait.status, 'completed'); assert.equal(terminalWait.timed_out, false); record('Terminal wait returns immediately', 'No unnecessary timeout.');
  const models = await call('select_model', { session_id: first.session_id }); assert.ok(models.available_models.length > 1);
  const model = models.available_models.find(x => x.modelId === process.env.WORKBUDDY_TEST_SECOND_MODEL);
  assert.ok(model, 'Second requested model must remain available.');
  const switched = await call('select_model', { session_id: first.session_id, model_id: model.modelId }); assert.equal(switched.selected_model, model.modelId); record('select_model acknowledged', model.modelId);
  const follow = await call('send_message', { session_id: first.session_id, message: 'Reply with exactly MODEL_SWITCH_OK. Do not use tools.' });
  const followResult = await finishTask(follow); assert.equal(followResult.status, 'completed'); assert.equal(followResult.answer.trim(), 'MODEL_SWITCH_OK'); record('Selected model executes next turn', followResult.answer);
  report.evidence.selected_model = model.modelId;
  await call('select_mcp_or_skills', { mcp_servers: ['listener-test-echo'], skills: ['listener-test-sentinel'] });
  const comboSession = await call('select_model', { model_id: process.env.WORKBUDDY_TEST_MODEL });
  const combo = await call('send_message', { session_id: comboSession.session_id, message: 'LISTENER_SKILL_CHECK. Call listener_test_echo exactly once with text "MCP_TOOL_ACTIVE_42". Then report its exact returned text. Do not use other tools.' });
  const comboResult = await finishTask(combo, { approveEcho: true });
  assert.equal(comboResult.status, 'completed'); assert.match(comboResult.answer, /MCP_TOOL_ACTIVE_42/); assert.match(comboResult.answer, /SKILL_ACTIVE_73/);
  assert.ok(comboResult.collected_events.some(e => e.type === 'tool_activity' && /echo/i.test(JSON.stringify(e))));
  report.evidence.mcp_and_skill = { answer: comboResult.answer, tool_events: comboResult.collected_events.filter(e => e.type === 'tool_activity').map(e => ({ title: e.title, status: e.status })) };
  record('Selected MCP tool and skill execute', comboResult.answer);
  await call('select_mcp_or_skills', { mcp_servers: [], skills: [] });
  const cancelSession = await call('select_model', { model_id: process.env.WORKBUDDY_TEST_MODEL });
  const long = await call('send_message', { session_id: cancelSession.session_id, message: 'Write a long numbered list of 300 detailed explanations of arithmetic, one paragraph for each number. Do not use tools.' });
  let seenRunning = false;
  for (let i = 0; i < 40; i++) {
    const state = await call('get_status', { task_id: long.task_id });
    if (state.status === 'running') { seenRunning = true; break; }
    if (['completed', 'failed', 'unknown'].includes(state.status)) throw Error('Cancellation test ended before cancellation.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(seenRunning, 'Expected a running task to cancel');
  await call('stop_task', { task_id: long.task_id });
  const cancelled = await finishTask(long, { timeout: 30000 }); assert.equal(cancelled.status, 'cancelled');
  const stopped = await call('stop_task', { task_id: long.task_id }); assert.equal(stopped.already_terminal, true); record('Native stop_task and repeated stop', 'WorkBuddy confirmed cancelled; no forced termination.');
  report.evidence.cancellation = { status: cancelled.status, task_id: long.task_id };
} catch (e) {
  report.tests.push({ name: 'Live integration failure', passed: false, detail: e.message }); report.error = e.message; process.exitCode = 1; process.stderr.write(`${e.message}\n`);
} finally {
  await client.close().catch(() => {});
  report.finished_at = new Date().toISOString(); report.passed = report.tests.every(x => x.passed);
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(root, 'test-results', 'latest-live-report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`Report: ${path.join(dir, 'report.json')}\n`);
}
