'use strict';
// Runs inside the installed WorkBuddy executable. Credentials remain in this
// worker's memory; the parent MCP server never receives the access token.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

if (process.env.WORKBUDDY_LISTENER_SKILL_FILE) {
  // Inject the supported argument after process creation, avoiding Windows'
  // command-line size limit for longer selected skill instructions.
  const text = fs.readFileSync(process.env.WORKBUDDY_LISTENER_SKILL_FILE, 'utf8');
  process.argv.push('--append-system-prompt', text);
  delete process.env.WORKBUDDY_LISTENER_SKILL_FILE;
}

function fail(code) { process.stderr.write(`[workbuddy-link] ${code}\n`); process.exit(2); }
function bytes(value, size) {
  if (typeof value !== 'string') throw Error('format');
  const data = Buffer.from(value, 'base64');
  if (data.toString('base64') !== value || (size !== undefined && data.length !== size)) throw Error('format');
  return data;
}
function unlock(value) {
  if (typeof value === 'string') return value;
  if (value?.$wbEncrypted !== 1) throw Error('unsupported');
  const envelope = JSON.parse(bytes(value.envelope).toString('utf8'));
  if (envelope.suite !== 1 || !/^[a-f0-9]{16}$/.test(envelope.keyId)) throw Error('unsupported');
  const store = process._linkedBinding('electron_browser_workbuddy_storage');
  const native = JSON.parse(store.loggerGet());
  const secret = bytes(native.atRestSecretKey, 32);
  if (!secret.some(x => x !== 0)) throw Error('unavailable');
  secret.fill(0);
  const key = crypto.createHash('sha256').update(native.atRestSecretKey, 'utf8').digest();
  let plain;
  try {
    if (crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) !== envelope.keyId) throw Error('mismatch');
    const prefix = text => { const data = Buffer.from(text); const n = Buffer.alloc(4); n.writeUInt32BE(data.length); return Buffer.concat([n, data]); };
    const aad = Buffer.concat([Buffer.from('WB-AAD\0', 'ascii'), Buffer.from([1]), prefix('WBEV1'), prefix('sym-v1'), Buffer.from([0, 0, 0, 1]), prefix(envelope.keyId), Buffer.from([2, 0, 0])]);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes(envelope.nonce, 12));
    decipher.setAAD(aad); decipher.setAuthTag(bytes(envelope.authTag, 16));
    plain = Buffer.concat([decipher.update(bytes(envelope.ciphertext)), decipher.final()]);
    return plain.toString('utf8');
  } finally { key.fill(0); plain?.fill(0); }
}

if (process.env.WORKBUDDY_LISTENER_AUTH !== 'none') {
  try {
    const authPath = process.env.WORKBUDDY_AUTH_FILE ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info');
    const session = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const token = unlock(session.auth?.accessToken);
    if (!token || token.length > 32768 || !/^[A-Za-z0-9._~+/=-]+$/.test(token)) fail('AUTH_TOKEN_INVALID');
    if (!session.account?.uid) fail('AUTH_ACCOUNT_MISSING');
    process.env.CODEBUDDY_AUTH_TOKEN = token;
    process.env.ACC_USER_ID = String(session.account.uid);
    process.env.ACC_USER_NICKNAME = 'WorkBuddy-Link';
    process.env.CODEBUDDY_CUSTOM_HEADERS = [`X-User-Id: ${String(session.account.uid).replace(/[\r\n]/g, '')}`, ...(session.auth.domain ? [`X-Domain: ${String(session.auth.domain).replace(/[\r\n]/g, '')}`] : [])].join('\n');
    process.env.CODEBUDDY_DISABLE_PRODUCT_CACHE = '1';
  } catch { fail('DESKTOP_AUTH_UNAVAILABLE'); }
}
