'use strict';
// Request-level admin authentication. Accounts, sessions and second factors live in adminUsers.js; the HTTP routes in authRoutes.js.
//   setup - event setup (event config, currencies, structure, room types, prices, translations, API, shutdown) and everything admin can do
//   admin - day-to-day booking administration (bookings, registration open/close, report and check-in)
// A session is only "signed in" (req.admin is set) after the password AND a second factor have been accepted.
const crypto = require('crypto');
const adminUsers = require('./adminUsers');

const COOKIE = 'ebs_admin';

const DEFAULT_MARKER = 'change-me';
function usingDefaults() {
  const found = [];
  ['SESSION_SECRET', 'POSTGRES_PASSWORD', 'SMTP_PASS'].forEach(k => {
    const v = process.env[k];
    if (v && v.startsWith(DEFAULT_MARKER)) found.push(k);
  });
  return found;
}

// First-time setup code: SETUP_PASSWORD (or ADMIN_PASSWORD). It only authorises creating the first account;
// after that the account passwords and second factors are what counts. If it is empty or still a "change-me" placeholder,
// a random code is generated at startup and printed in the server log (see server.js), so a default .env is never a way in.
let generatedCode = '';
function bootstrapCode() {
  const e = process.env.SETUP_PASSWORD || process.env.ADMIN_PASSWORD || '';
  if (e && !e.startsWith(DEFAULT_MARKER)) return e;
  if (!generatedCode) generatedCode = crypto.randomBytes(9).toString('base64url');
  return generatedCode;
}
const bootstrapCodeIsGenerated = () => { const e = process.env.SETUP_PASSWORD || process.env.ADMIN_PASSWORD || ''; return !e || e.startsWith(DEFAULT_MARKER); };
function checkBootstrapCode(code) {
  const want = bootstrapCode();
  if (typeof code !== 'string') return false;
  const a = crypto.createHash('sha256').update(code.trim()).digest(), b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const h = req.headers.cookie || '';
  const m = h.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
const tokenOf = req => { const t = readCookie(req, COOKIE); return /^[A-Za-z0-9_-]{20,80}$/.test(t) ? t : ''; };
function makeCookie(token, secure, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec || adminUsers.SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
}
function clearCookie(secure) { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`; }

// Express middleware: looks the session up once per request. req.adminSession is any live session (also half-open ones);
// req.admin is set only for fully signed-in ones.
async function attach(req, res, next) {
  req.admin = null; req.adminSession = null;
  const token = tokenOf(req);
  if (!token) return next();
  try {
    const s = await adminUsers.getSession(token);
    if (s) {
      req.adminSession = s;
      if (s.stage === 'ok') req.admin = { id: s.user.id, email: s.user.email, name: s.user.name, role: s.user.role };
    }
  } catch (e) { console.error('auth attach failed', e.message); }
  next();
}

// Returns 'setup', 'admin' or '' (not signed in).
const role = req => (req.admin ? req.admin.role : '');
const isAdmin = req => role(req) !== '';
const isSetup = req => role(req) === 'setup';

// Throttling per IP: 10 failed attempts per 15 minutes (passwords, codes, setup code; AUTH_IP_FAILURES overrides, for tests)
const MAX_FAILURES = parseInt(process.env.AUTH_IP_FAILURES || '10', 10) || 10;
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= MAX_FAILURES;
}
function recordFailure(ip) { const l = attempts.get(ip) || []; l.push(Date.now()); attempts.set(ip, l); }
function clearFailures(ip) { attempts.delete(ip); }

module.exports = { usingDefaults, bootstrapCode, bootstrapCodeIsGenerated, checkBootstrapCode, tokenOf, makeCookie, clearCookie, attach, role, isAdmin, isSetup, throttled, recordFailure, clearFailures };
