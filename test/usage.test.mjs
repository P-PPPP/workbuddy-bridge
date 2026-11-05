import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseModelCallUsage, captureUsageBoundary, readWorkerUsage } from '../src/usage.mjs';

const record = (extra = {}) => '[Info] [ModelProvider] ' + JSON.stringify({ event_name:'agent.model_call.completed', conversation_id:'owned', conversation_request_id:'turn1', conversation_message_id:'message1', step:1, attempt_no:1, input_tokens:100, output_tokens:20, total_tokens:120, cached_read_tokens:50, cached_write_tokens:0, raw:'private data never returned', ...extra }) + '\n';

test('model-call metrics are deduplicated, session filtered, and cache is not added to totals', () => {
  const text = record() + record() + record({ conversation_id:'other' }) + record({ conversation_message_id:'message2', step:2 });
  const usage = parseModelCallUsage([text], 'owned');
  assert.equal(usage.reported_calls, 2);
  assert.equal(usage.input_tokens, 200);
  assert.equal(usage.total_tokens, 240);
  assert.equal(usage.cached_read_tokens, 100);
  assert.equal(JSON.stringify(usage).includes('private'), false);
  assert.equal(JSON.stringify(usage).includes('owned'), false);
});

test('missing and invalid metrics are never treated as zero consumption', () => {
  assert.equal(parseModelCallUsage([record({ input_tokens:'100' })], 'owned'), undefined);
  const usage = parseModelCallUsage([record() + record({ conversation_message_id:'missing', total_tokens:-1 })], 'owned');
  assert.equal(usage.calls_without_usage, 1);
  assert.equal(usage.total_tokens, 120);
});

test('per-turn log boundaries exclude prior turns and tolerate missing log directories', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-usage-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  assert.equal(await readWorkerUsage(dir, 'owned'), undefined);
  const logs = path.join(dir, 'logs', 'date'); await fs.mkdir(logs, { recursive:true });
  const file = path.join(logs, 'worker.log'); await fs.writeFile(file, record());
  const boundary = await captureUsageBoundary(dir);
  await fs.appendFile(file, record({ conversation_request_id:'turn2', input_tokens:200, total_tokens:220 }));
  const usage = await readWorkerUsage(dir, 'owned', boundary);
  assert.equal(usage.reported_calls, 1);
  assert.equal(usage.input_tokens, 200);
  assert.equal(usage.total_tokens, 220);
});
