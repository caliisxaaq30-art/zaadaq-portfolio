'use strict';
const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ── Config ────────────────────────────────────────────
const ROOT         = __dirname;
const PORT         = Number(process.env.PORT || 3000);
const SESSION_DAYS = 7;
const isProduction = process.env.NODE_ENV === 'production';
const dbFolder     = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

// ── Database setup ────────────────────────────────────
fs.mkdirSync(dbFolder, { recursive: true });
const db = new DatabaseSync(path.join(dbFolder, 'zaadaq.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT    NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Remove expired sessions on startup to keep the DB tidy
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

// ── Rate limiter ──────────────────────────────────────
// Keyed by ip (or ip + ':login' for the login route).
const requestHistory = new Map();

function allowRequest(key, limit = 10, windowMs = 15 * 60 * 1000) {
  const now     = Date.now();
  const history = (requestHistory.get(key) || []).filter(t => now - t < windowMs);
  if (history.length >= limit) return false;
  history.push(now);
  requestHistory.set(key, history);
  return true;
}

// ── Password helpers ──────────────────────────────────
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function matchesPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Cookie / session helpers ──────────────────────────
function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie || '').split(';').filter(Boolean).map(cookie => {
      const index = cookie.indexOf('=');
      return [cookie.slice(0, index).trim(), decodeURIComponent(cookie.slice(index + 1))];
    })
  );
}

function sessionCookie(token, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  return (
    `zaadaq_session=${encodeURIComponent(token)}; ` +
    `HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}` +
    (isProduction ? '; Secure' : '')
  );
}

function getUser(request) {
  const token = parseCookies(request).zaadaq_session;
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.name, users.email
    FROM   sessions
    JOIN   users ON users.id = sessions.user_id
    WHERE  sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now()) || null;
}

function createSession(response, userId) {
  const token     = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, expiresAt);
  response.setHeader('Set-Cookie', sessionCookie(token));
}

function userShape(user) {
  return { id: user.id, name: user.name, email: user.email };
}

// ── HTTP helpers ──────────────────────────────────────
function send(response, status, data, headers = {}) {
  response.writeHead(status, {
    'Content-Type':  'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Request too large');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid request data'); }
}

// ── Static file config ────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// These extensions get a one-day cache; HTML is always revalidated.
const CACHEABLE_EXTS = new Set(['.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.ico']);

// ── Security headers ──────────────────────────────────
function applySecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options',  'nosniff');
  response.setHeader('X-Frame-Options',          'DENY');
  response.setHeader('Referrer-Policy',          'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy',       'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "style-src 'self' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
}

// ── Request handler ───────────────────────────────────
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const ip  = request.socket.remoteAddress || 'unknown';

  applySecurityHeaders(response);

  try {
    // ── Health check ──────────────────────────────────
    if (url.pathname === '/healthz' && request.method === 'GET') {
      return send(response, 200, { ok: true });
    }

    // ── Register (10 per 15 min per IP) ───────────────
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      if (!allowRequest(ip, 10, 15 * 60 * 1000)) {
        return send(response, 429, { error: 'Too many attempts. Please wait and try again.' });
      }
      const { name = '', email = '', password = '' } = await readBody(request);
      const cleanName  = String(name).trim().slice(0, 80);
      const cleanEmail = String(email).trim().toLowerCase();
      if (cleanName.length < 2)
        return send(response, 400, { error: 'Enter a name with at least 2 characters.' });
      if (!/^\S+@\S+\.\S+$/.test(cleanEmail))
        return send(response, 400, { error: 'Enter a valid email address.' });
      if (String(password).length < 8)
        return send(response, 400, { error: 'Password must contain at least 8 characters.' });
      try {
        const result = db.prepare(
          'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)'
        ).run(cleanName, cleanEmail, hashPassword(String(password)));
        const user = { id: Number(result.lastInsertRowid), name: cleanName, email: cleanEmail };
        createSession(response, user.id);
        return send(response, 201, { user: userShape(user) });
      } catch (error) {
        const isConflict = error.message.includes('UNIQUE');
        return send(response, isConflict ? 409 : 500, {
          error: isConflict
            ? 'An account with this email already exists.'
            : 'Could not create the account.',
        });
      }
    }

    // ── Login (tighter: 5 per 15 min per IP) ─────────
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      if (!allowRequest(ip + ':login', 5, 15 * 60 * 1000)) {
        return send(response, 429, { error: 'Too many login attempts. Please wait and try again.' });
      }
      const { email = '', password = '' } = await readBody(request);
      const cleanEmail = String(email).trim().toLowerCase();
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
      if (!user || !matchesPassword(String(password), user.password_hash)) {
        return send(response, 401, { error: 'Incorrect email or password.' });
      }
      createSession(response, user.id);
      return send(response, 200, { user: userShape(user) });
    }

    // ── Me ────────────────────────────────────────────
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const user = getUser(request);
      return user
        ? send(response, 200, { user: userShape(user) })
        : send(response, 401, { error: 'Not logged in.' });
    }

    // ── Logout ────────────────────────────────────────
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      const token = parseCookies(request).zaadaq_session;
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      return send(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }

    // ── Unknown API ───────────────────────────────────
    if (url.pathname.startsWith('/api/')) {
      return send(response, 404, { error: 'Not found.' });
    }

    // ── Static files ──────────────────────────────────
    const relative = url.pathname === '/'
      ? 'index.html'
      : decodeURIComponent(url.pathname).replace(/^[/\\]+/, '');
    const file = path.resolve(ROOT, relative);

    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      return response.end('Not found');
    }

    const ext         = path.extname(file).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const cacheCtrl   = CACHEABLE_EXTS.has(ext) ? 'public, max-age=86400' : 'no-cache';

    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheCtrl });
    fs.createReadStream(file).pipe(response);

  } catch (error) {
    send(response, 400, { error: error.message || 'Request failed.' });
  }
});

server.listen(PORT, () => console.log(`ZAADAQ running at http://localhost:${PORT}`));
