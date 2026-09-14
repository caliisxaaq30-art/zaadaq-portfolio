const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = 7;
const isProduction = process.env.NODE_ENV === 'production';
const dbFolder = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(dbFolder, { recursive: true });
const db = new DatabaseSync(path.join(dbFolder, 'zaadaq.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const requests = new Map();
function allowRequest(ip, limit = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const history = (requests.get(ip) || []).filter(time => now - time < windowMs);
  if (history.length >= limit) return false;
  history.push(now); requests.set(ip, history); return true;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function matchesPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(cookie => {
    const index = cookie.indexOf('='); return [cookie.slice(0, index).trim(), decodeURIComponent(cookie.slice(index + 1))];
  }));
}
function sessionCookie(token, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  return `zaadaq_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isProduction ? '; Secure' : ''}`;
}
function send(response, status, data, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(data));
}
async function body(request) {
  let raw = '';
  for await (const chunk of request) { raw += chunk; if (raw.length > 10_000) throw new Error('Request too large'); }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid request data'); }
}
function getUser(request) {
  const token = parseCookies(request).zaadaq_session;
  if (!token) return null;
  const row = db.prepare(`SELECT users.id, users.name, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(hashToken(token), Date.now());
  return row || null;
}
function createSession(response, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expiresAt);
  response.setHeader('Set-Cookie', sessionCookie(token));
}
function userShape(user) { return { id: user.id, name: user.name, email: user.email }; }

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const ip = request.socket.remoteAddress || 'unknown';
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    if (url.pathname === '/healthz' && request.method === 'GET') return send(response, 200, { ok: true });
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      if (!allowRequest(ip)) return send(response, 429, { error: 'Too many attempts. Please wait and try again.' });
      const { name = '', email = '', password = '' } = await body(request);
      const cleanName = String(name).trim().slice(0, 80); const cleanEmail = String(email).trim().toLowerCase();
      if (cleanName.length < 2) return send(response, 400, { error: 'Enter a name with at least 2 characters.' });
      if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) return send(response, 400, { error: 'Enter a valid email address.' });
      if (String(password).length < 8) return send(response, 400, { error: 'Password must contain at least 8 characters.' });
      try {
        const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(cleanName, cleanEmail, hashPassword(String(password)));
        const user = { id: Number(result.lastInsertRowid), name: cleanName, email: cleanEmail }; createSession(response, user.id); return send(response, 201, { user: userShape(user) });
      } catch (error) { return send(response, error.message.includes('UNIQUE') ? 409 : 500, { error: error.message.includes('UNIQUE') ? 'An account with this email already exists.' : 'Could not create the account.' }); }
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      if (!allowRequest(ip)) return send(response, 429, { error: 'Too many attempts. Please wait and try again.' });
      const { email = '', password = '' } = await body(request); const cleanEmail = String(email).trim().toLowerCase();
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
      if (!user || !matchesPassword(String(password), user.password_hash)) return send(response, 401, { error: 'Incorrect email or password.' });
      createSession(response, user.id); return send(response, 200, { user: userShape(user) });
    }
    if (url.pathname === '/api/auth/me' && request.method === 'GET') { const user = getUser(request); return user ? send(response, 200, { user: userShape(user) }) : send(response, 401, { error: 'Not logged in.' }); }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') { const token = parseCookies(request).zaadaq_session; if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token)); return send(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) }); }
    if (url.pathname.startsWith('/api/')) return send(response, 404, { error: 'Not found.' });
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^[/\\]+/, '');
    const file = path.resolve(ROOT, relative); if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end('Not found'); }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(file).pipe(response);
  } catch (error) { send(response, 400, { error: error.message || 'Request failed.' }); }
});
server.listen(PORT, () => console.log(`ZAADAQ running at http://localhost:${PORT}`));
