import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, nickname TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, banned INTEGER NOT NULL DEFAULT 0, invite_id TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, expires INTEGER, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS players(id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT REFERENCES users(id), name TEXT NOT NULL, color TEXT NOT NULL, model TEXT NOT NULL, source TEXT NOT NULL, hash TEXT, status TEXT NOT NULL, system INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, registered_at INTEGER, retired_at INTEGER, cooldown INTEGER NOT NULL DEFAULT 0, average REAL, appearances INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX IF NOT EXISTS registered_name ON players(name COLLATE NOCASE) WHERE registered_at IS NOT NULL;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), candidate INTEGER, kind TEXT NOT NULL, status TEXT NOT NULL, total INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0, seed TEXT NOT NULL, plan TEXT, roster TEXT NOT NULL, created_at INTEGER NOT NULL, finished_at INTEGER, error TEXT, applied INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS games(job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, round INTEGER NOT NULL, seed TEXT NOT NULL, results TEXT NOT NULL, replay BLOB NOT NULL, PRIMARY KEY(job_id,round));
      CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT NOT NULL, target TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);`);
    this.transaction(() => {
      for (const [table, column, type] of [['users','guide_disabled','INTEGER NOT NULL DEFAULT 0'],['users','announcement_disabled','INTEGER NOT NULL DEFAULT 0'],['users','announcement_seen','INTEGER NOT NULL DEFAULT 0'],['users','invite_limit','INTEGER NOT NULL DEFAULT 5'],['invites','owner','TEXT REFERENCES users(id)'],['invites','superseded','INTEGER NOT NULL DEFAULT 0'],['players','removed_at','INTEGER'],['players','best_rank','INTEGER'],['players','best_rank_at','INTEGER']]) {
        if (!this.all(`PRAGMA table_info(${table})`).some(c => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS personal_invite ON invites(owner) WHERE owner IS NOT NULL AND superseded=0;
        CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS private_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL REFERENCES users(id),sender TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER);
        CREATE INDEX IF NOT EXISTS private_thread ON private_messages(owner,id);`);
      if (!this.get('peak-rank-migrated', false)) {
        const ranking = this.get('ranking', {order:[],history:[]});
        for (const event of [...ranking.history].sort((a,b)=>a.at-b.at)) this.recordPeaks(event.after || [], event.at || null);
        this.recordPeaks(ranking.order, null);
        this.set('peak-rank-migrated', true);
      }
      const order=this.get('ranking',{order:[]}).order;
      for(const p of this.all("SELECT id FROM players WHERE system=0 AND status='retired' AND appearances=0 AND best_rank IS NULL AND removed_at IS NULL")) {
        if(!order.includes(p.id))this.run("UPDATE players SET source='',removed_at=? WHERE id=?",Date.now(),p.id);
      }
      if(!this.get('community-v1-migrated',false)) {
        this.run('INSERT INTO announcements(title,body,created_at) VALUES(?,?,?)','邀请朋友，一起完善竞技台','账户设置新增个人邀请码：拥有至少一名未退役的注册选手即可生成，默认可邀请 5 个账户。邀请名额不会因更换邀请码而重置。\n同时新增“与服主对话”，可以私下向服主反馈问题并查看回复。\n通知可临时关闭，也可永久关闭自动弹出；右上角通知入口始终保留。',Date.now());
        this.set('community-v1-migrated',true);
      }
    });
  }
  recordPeaks(order, at) {
    order.forEach((id, i) => this.run('UPDATE players SET best_rank=?,best_rank_at=? WHERE id=? AND (best_rank IS NULL OR best_rank>?)', i+1, at, id, i+1));
  }
  one(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  get(key, fallback = null) { const row = this.one('SELECT value FROM settings WHERE key=?', key); return row ? JSON.parse(row.value) : fallback; }
  set(key, value) { this.run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  audit(actor, action, target) { this.run('INSERT INTO audit(actor,action,target,created_at) VALUES(?,?,?,?)', actor, action, String(target), Date.now()); }
  close() { this.db.close(); }
}
