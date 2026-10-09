import { randomBytes, randomUUID, createHash, scrypt as rawScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(rawScrypt);
export const token = () => randomBytes(32).toString('base64url');
export const digest = text => createHash('sha256').update(text).digest('hex');
export function validUsername(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{3,24}$/.test(value)) throw Object.assign(new Error('用户名需要3～24位字母、数字或下划线'),{status:400});
  return value;
}
export function validPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw Object.assign(new Error('密码需要12～128个字符'),{status:400});
  return value;
}
export async function hashPassword(password) {
  validPassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 32, { N:32768, r:8, p:3, maxmem:64 * 1024 * 1024 });
  return `scrypt$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, saved) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [, salt, expected] = saved.split('$');
  const actual = await scrypt(password, salt, 32, { N:32768, r:8, p:3, maxmem:64 * 1024 * 1024 });
  const wanted = Buffer.from(expected, 'hex');
  return wanted.length === actual.length && timingSafeEqual(wanted, actual);
}
export function openSession(store, id) {
  const secret = token(), csrf = token(), expires = Date.now() + 7 * 86400000;
  store.run('DELETE FROM sessions WHERE expires<?', Date.now());
  store.run('INSERT INTO sessions VALUES(?,?,?,?)', digest(secret), id, csrf, expires);
  return { secret, csrf };
}
export function readSession(store, req) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('arena_session='))?.slice(14);
  if (!cookie) return null;
  return store.one('SELECT u.*,s.csrf,s.hash AS session_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.banned=0', digest(cookie), Date.now());
}
export async function bootstrap(store, username, password) {
  if (store.one("SELECT id FROM users WHERE role='admin'")) throw new Error('管理员已存在，不会覆盖');
  validUsername(username);
  const hash = await hashPassword(password), id = randomUUID();
  store.run('INSERT INTO users(id,username,nickname,password,role,created_at) VALUES(?,?,?,?,?,?)', id, username, username, hash, 'admin', Date.now());
  return id;
}
export function publicUser(row) { return { id: row.id, username:row.username, nickname:row.nickname, role:row.role, guideDisabled:!!row.guide_disabled, announcementDisabled:!!row.announcement_disabled, announcementSeen:row.announcement_seen||0 }; }
export function rateLimit(store, key, maximum, window) {
  const now = Date.now(), old = store.one('SELECT * FROM limits WHERE key=?', key);
  if (old && old.reset > now && old.count >= maximum) throw Object.assign(new Error('操作过于频繁，请稍后再试'), { status:429 });
  store.run('INSERT INTO limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset=excluded.reset', key, old && old.reset > now ? old.count + 1 : 1, old && old.reset > now ? old.reset : now + window);
  store.run('DELETE FROM limits WHERE reset<?', now);
}
