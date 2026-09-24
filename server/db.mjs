import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const databasePath = resolve(process.env.DATABASE_PATH || './data/nextwebec.db');
mkdirSync(dirname(databasePath), { recursive: true });
export const db = new Database(databasePath, { timeout: 5000 });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
export function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const name='001_initial.sql';
  if(!db.prepare('SELECT 1 FROM _migrations WHERE name=?').get(name)) {
    const sql=readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8');
    db.transaction(()=>{db.exec(sql);db.prepare('INSERT INTO _migrations(name,applied_at) VALUES(?,?)').run(name,new Date().toISOString());})();
  }
}
