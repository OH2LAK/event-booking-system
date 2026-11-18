'use strict';
// Test helper: signs in to a running instance with real accounts and a real second factor (TOTP computed from the secret).
// The first call on a fresh database does the first-time setup (setup code = SETUP_PASSWORD or ADMIN_PASSWORD from the environment)
// and creates a setup account and, when asked for, a booking admin account. Secrets and sessions are cached in the temp directory.
//   const { signIn } = require('./adminSession');  cookie = await signIn(BASE, 'setup' | 'admin');
const fs = require('fs'), os = require('os'), path = require('path');
const C = require('../src/adminCrypto');

const PASSWORD = { setup: 'Quiet-Harbor-Lantern-42', admin: 'Silver-Maple-Compass-77' };
const EMAIL = { setup: 'setup@test.example', admin: 'admin@test.example' };
const file = base => path.join(os.tmpdir(), 'ebs-auth-' + base.replace(/[^a-z0-9]/gi, '_') + '.json');
const load = base => { try { return JSON.parse(fs.readFileSync(file(base), 'utf8')); } catch (_) { return {}; } };
const save = (base, st) => fs.writeFileSync(file(base), JSON.stringify(st));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(base, p, body, cookie) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookie || '' }, body: JSON.stringify(body || {}) });
  const sc = r.headers.get('set-cookie');
  return { status: r.status, json: await r.json().catch(() => ({})), cookie: sc ? sc.split(';')[0] : '' };
}
const get = async (base, p, cookie) => { const r = await fetch(base + p, { headers: { cookie: cookie || '' } }); return r.json(); };

async function enrolTotp(base, cookie) {
  const b = await post(base, '/api/auth/totp/begin', {}, cookie);
  const secret = b.json.secret;
  const c = await post(base, '/api/auth/totp/confirm', { code: C.totpAt(secret, Date.now()) }, cookie);
  if (!c.json.ok) throw new Error('TOTP enrolment failed: ' + JSON.stringify(c.json));
  return { secret, recovery: c.json.recoveryCodes || [] };
}
async function totpLogin(base, role, st) {
  const l = await post(base, '/api/auth/login', { email: EMAIL[role], password: PASSWORD[role], mode: role }, '');
  if (!l.json.ok) throw new Error('login failed: ' + JSON.stringify(l.json));
  if (l.json.stage === 'ok') return l.cookie;
  // a code can be used once: take the next unused 30 s step, waiting when needed
  for (let i = 0; i < 4; i++) {
    const now = Date.now();
    const used = st[role].lastStep || 0;
    const step = Math.max(Math.floor(now / 30000), used + 1);
    if (step > Math.floor(now / 30000) + 1) { await sleep((step - 1) * 30000 - now + 500); continue; }
    const v = await post(base, '/api/auth/verify', { method: 'totp', code: C.totpAt(st[role].secret, step * 30000) }, l.cookie);
    st[role].lastStep = step;
    if (v.json.ok) return v.cookie || l.cookie;
    await sleep(1000);
  }
  throw new Error('second factor failed');
}
async function signIn(base, role) {
  role = role || 'setup';
  let st = load(base);
  const state = await get(base, '/api/auth/state', '');
  if (state.bootstrapNeeded) {
    st = {};
    const code = process.env.SETUP_PASSWORD || process.env.ADMIN_PASSWORD;
    const b = await post(base, '/api/auth/bootstrap', { code, email: EMAIL.setup, name: 'Test Setup', password: PASSWORD.setup }, '');
    if (!b.json.ok) throw new Error('bootstrap failed: ' + JSON.stringify(b.json));
    const e = await enrolTotp(base, b.cookie);
    st.setup = { secret: e.secret, recovery: e.recovery, cookie: b.cookie, lastStep: Math.floor(Date.now() / 30000) };
    save(base, st);
  }
  // cached session still alive?
  if (st[role] && st[role].cookie) {
    const a = await post(base, '/api/auth/account', {}, st[role].cookie);
    if (a.json.ok) return st[role].cookie;
  }
  if (role === 'admin' && !st.admin) {
    const sc = await signIn(base, 'setup');
    st = load(base);
    const inv = await post(base, '/api/rpc/inviteAdminUser', { args: [{ email: EMAIL.admin, name: 'Test Admin', role: 'admin' }] }, sc);
    const link = inv.json.result && inv.json.result.link;
    if (!link) throw new Error('invite failed: ' + JSON.stringify(inv.json));
    const token = new URL(link).searchParams.get('token');
    const acc = await post(base, '/api/auth/accept', { token, name: 'Test Admin', password: PASSWORD.admin }, '');
    const e = await enrolTotp(base, acc.cookie);
    st.admin = { secret: e.secret, recovery: e.recovery, cookie: acc.cookie, lastStep: Math.floor(Date.now() / 30000) };
    save(base, st);
    return acc.cookie;
  }
  if (!st[role]) throw new Error('no stored secret for ' + role + ' (is the database fresh?)');
  const cookie = await totpLogin(base, role, st);
  st[role].cookie = cookie; save(base, st);
  return cookie;
}

module.exports = { signIn, post, get, enrolTotp, PASSWORD, EMAIL };
