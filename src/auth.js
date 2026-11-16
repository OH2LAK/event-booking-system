'use strict';
const crypto = require('crypto');

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'vushf_admin';

const DEFAULT_MARKER = 'change-me';
function usingDefaults() {
  const found = [];
  ['ADMIN_PASSWORD', 'SESSION_SECRET', 'POSTGRES_PASSWORD', 'SMTP_PASS'].forEach(k => {
    const v = process.env[k];
    if (v && v.startsWith(DEFAULT_MARKER)) found.push(k);
  });
  return found;
}

function secret() { return process.env.SESSION_SECRET || 'change-me-session-secret'; }
function sign(payload) { return crypto.createHmac('sha256', secret()).update(payload).digest('hex'); }

function checkPassword(pw) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected || typeof pw !== 'string') return false;
  return crypto.timingSafeEqual(sha(pw), sha(expected));
}

function makeCookie(secure) {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const val = `${exp}.${sign(exp)}`;
  return `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}
function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`; }

function readCookie(req, name) {
  const h = req.headers.cookie || '';
  const m = h.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
function isAdmin(req) {
  const v = readCookie(req, COOKIE);
  const [exp, sig] = v.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

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

module.exports = { usingDefaults, checkPassword, makeCookie, clearCookie, isAdmin, throttled, recordFailure, clearFailures };
