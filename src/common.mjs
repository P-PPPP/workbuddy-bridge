import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATE = path.resolve(process.env.WORKBUDDY_LISTENER_DATA ?? path.join(PROJECT, 'data'));
export const APP = process.env.WORKBUDDY_INSTALL_DIR ?? path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'WorkBuddy');
export const WBHOME = process.env.WORKBUDDY_HOME ?? path.join(os.homedir(), '.workbuddy');
export const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'unknown']);
export class ListenerError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
export function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key, val]) => !/token|secret|authorization|password|ticket|envelope|credential/i.test(key) || (/^(input_tokens|output_tokens|total_tokens|thought_tokens|cached_read_tokens|cached_write_tokens)$/.test(key) && Number.isSafeInteger(val) && val >= 0)).map(([key, val]) => [key, clean(val)]));
  if (typeof value === 'string') return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
  return value;
}
export function publicError(e) { return clean({ code: e.code ?? 'INTERNAL_ERROR', message: e.message ?? String(e), ...(e.details ? { details: e.details } : {}) }); }
export const now = () => new Date().toISOString();
