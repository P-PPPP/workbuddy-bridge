import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { clean, now } from './common.mjs';

export class Journal {
  constructor(file) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, task_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(cursor INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_by_task ON events(task_id,cursor);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, body TEXT NOT NULL);`);
  }
  saveSession(s) { this.db.prepare('INSERT INTO sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(s.id, JSON.stringify(clean(s))); }
  sessions() { return this.db.prepare('SELECT body FROM sessions').all().map(x => JSON.parse(x.body)); }
  saveTask(t) { this.db.prepare('INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(t.id, JSON.stringify(clean(t))); }
  task(id) { const row = this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id); return row ? JSON.parse(row.body) : undefined; }
  tasks() { return this.db.prepare('SELECT body FROM tasks').all().map(x => JSON.parse(x.body)); }
  request(id) { return this.db.prepare('SELECT fingerprint,task_id FROM requests WHERE id=?').get(id); }
  recordRequest(id, fingerprint, taskId) { this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(id, fingerprint, taskId); }
  event(taskId, event) {
    const body = clean({ timestamp: now(), ...event });
    const row = this.db.prepare('INSERT INTO events(task_id,body) VALUES(?,?)').run(taskId, JSON.stringify(body));
    return { cursor: String(row.lastInsertRowid), ...body };
  }
  events(taskId, cursor = '0', limit = 100, includePartial = true) {
    // Filtering takes place before pagination, so hidden partial events do not
    // cause the cursor to skip final/state events.
    const rows = this.db.prepare('SELECT cursor,body FROM events WHERE task_id=? AND cursor>? ORDER BY cursor').all(taskId, Number(cursor));
    const filtered = rows.map(x => ({ cursor: String(x.cursor), ...JSON.parse(x.body) })).filter(x => includePartial || !x.type.endsWith('_delta'));
    return { events: filtered.slice(0, limit), has_more: filtered.length > limit };
  }
  getMeta(key, fallback) { const row = this.db.prepare('SELECT body FROM metadata WHERE key=?').get(key); return row ? JSON.parse(row.body) : fallback; }
  setMeta(key, value) { this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key, JSON.stringify(clean(value))); }
  close() { this.db.close(); }
}
