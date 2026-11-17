'use strict';
const crypto = require('crypto');

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'ebs_admin';

const DEFAULT_MARKER = 'change-me';
function usingDefaults() {
  const found = [];
  ['ADMIN_PASSWORD', 'SETUP_PASSWORD', 'SESSION_SECRET', 'POSTGRES_PASSWORD', 'SMTP_PASS'].forEach(k => {
    const v = process.env[k];
    if (v && v.startsWith(DEFAULT_MARKER)) found.push(k);
  });
  return found;
}

function secret() { return process.env.SESSION_SECRET || 'change-me-session-secret'; }
function sign(payload) { return crypto.createHmac('sha256', secret()).update(payload).digest('hex'); }

// Two roles:
//   setup - event setup (event config, currencies, structure, room types, prices, translations, shutdown) and everything admin can do
//   admin - day-to-day booking administration (bookings, registration open/close, report and check-in)
// SETUP_PASSWORD gives the setup role, ADMIN_PASSWORD the admin role. If SETUP_PASSWORD is not set,
// ADMIN_PASSWORD gives the setup role (single-password mode).
function matches(pw, expected) {
  return !!expected && typeof pw === 'string' && crypto.timingSafeEqual(sha(pw), sha(expected));
}
function checkPassword(pw) {
  const setupPw = process.env.SETUP_PASSWORD || process.env.ADMIN_PASSWORD || '';
  if (matches(pw, setupPw)) return 'setup';
  if (matches(pw, process.env.ADMIN_PASSWORD || '')) return 'admin';
  return null;
}

function makeCookie(role, secure) {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const body = `${role}.${exp}`;
  const val = `${body}.${sign(body)}`;
  return `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}
function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`; }

function readCookie(req, name) {
  const h = req.headers.cookie || '';
  const m = h.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
// Returns 'setup', 'admin' or '' (not logged in).
function role(req) {
  const [r, exp, sig] = readCookie(req, COOKIE).split('.');
  if ((r !== 'setup' && r !== 'admin') || !exp || !sig || Number(exp) < Date.now()) return '';
  const expected = sign(`${r}.${exp}`);
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok ? r : '';
}
const isAdmin = req => role(req) !== '';
const isSetup = req => role(req) === 'setup';

// Login throttling: 10 failed attempts per 15 minutes per IP
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}
function recordFailure(ip) { const l = attempts.get(ip) || []; l.push(Date.now()); attempts.set(ip, l); }
function clearFailures(ip) { attempts.delete(ip); }

module.exports = { usingDefaults, checkPassword, makeCookie, clearCookie, role, isAdmin, isSetup, throttled, recordFailure, clearFailures };
