import fs from 'node:fs/promises';
import path from 'node:path';

const counters = ['input_tokens', 'output_tokens', 'total_tokens', 'cached_read_tokens', 'cached_write_tokens'];
const validCount = n => Number.isSafeInteger(n) && n >= 0;

// Inspect only completed-call metric records. Never return raw log payloads,
// prompts, generated text, account data, or native conversation identifiers.
export function parseModelCallUsage(texts, nativeSessionId) {
  const calls = new Map();
  for (const text of texts) for (const line of text.split('\n')) {
    if (!line.includes('[ModelProvider]') || !line.includes('agent.model_call.completed')) continue;
    try {
      const o = JSON.parse(line.slice(line.indexOf('{')));
      if (o.event_name !== 'agent.model_call.completed' || o.conversation_id !== nativeSessionId) continue;
      if (typeof o.conversation_request_id !== 'string' || typeof o.conversation_message_id !== 'string' || !validCount(o.step) || !validCount(o.attempt_no)) continue;
      const key = JSON.stringify([o.conversation_request_id, o.conversation_message_id, o.step, o.attempt_no]);
      calls.set(key, Object.fromEntries(counters.filter(k => validCount(o[k])).map(k => [k, o[k]])));
    } catch { /* Unrelated, partial, or changed log formats are not usage. */ }
  }
  if (!calls.size) return undefined;
  const usable = [...calls.values()].filter(o => counters.slice(0, 3).every(k => validCount(o[k])));
  if (!usable.length) return undefined;
  const result = { source: 'native_model_call_log', coverage: 'completed_model_calls_with_reported_usage', reported_calls: usable.length, calls_without_usage: calls.size - usable.length };
  for (const key of counters) {
    if (!usable.every(o => validCount(o[key]))) continue;
    const sum = usable.reduce((n, o) => n + o[key], 0);
    if (!validCount(sum)) return undefined;
    result[key] = sum;
  }
  return result;
}

async function logFiles(profileDir) {
  const root = path.join(profileDir, 'logs');
  try {
    const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
    return entries.filter(e => e.isFile() && e.name.endsWith('.log')).map(e => path.join(e.parentPath, e.name));
  } catch { return []; }
}

export async function captureUsageBoundary(profileDir) {
  const offsets = new Map();
  for (const file of await logFiles(profileDir)) {
    try { offsets.set(file, (await fs.stat(file)).size); } catch { /* Rotated. */ }
  }
  return offsets;
}

export async function readWorkerUsage(profileDir, nativeSessionId, offsets = new Map()) {
  try {
    const texts = []; let total = 0;
    for (const file of await logFiles(profileDir)) {
      const size = (await fs.stat(file)).size, start = offsets.get(file) ?? 0;
      if (size < start || size - start > 8 * 1024 * 1024 || (total += size - start) > 32 * 1024 * 1024) return undefined;
      if (size === start) continue;
      const handle = await fs.open(file, 'r');
      try {
        const buffer = Buffer.alloc(size - start);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        texts.push(text.slice(0, text.lastIndexOf('\n') + 1));
      } finally { await handle.close(); }
    }
    return parseModelCallUsage(texts, nativeSessionId);
  } catch { return undefined; }
}
