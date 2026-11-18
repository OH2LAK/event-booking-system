'use strict';
// HTTP routes for admin sign-in, account security and invitations: /api/auth/* and /auth/accept.
// The browser side is public/admin-auth.js.
const express = require('express');
const qrcode = require('qrcode-generator');
const db = require('./db');
const auth = require('./auth');
const adminUsers = require('./adminUsers');
const C = require('./adminCrypto');
const passkeys = require('./passkeys');
const emails = require('./emails');
const demo = require('./demo');
const { CONFIG } = require('./config');

const router = express.Router();
const secure = () => (process.env.PUBLIC_URL || '').startsWith('https://');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const log = (level, event, who, ip, extra) => db.logEvent(level, event, '', `user=${who}${ip ? ' ip=' + ip : ''}${extra ? ' ' + extra : ''}`);
const fail = (res, error, status) => res.status(status || 400).json({ ok: false, error });
const mailOn = () => emails.isEnabled();
const issuer = () => String(CONFIG.EVENT_SHORT || 'Event booking').replace(/[:]/g, ' ');

function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}
async function startSession(res, user, ip, mode) {
  const m = await adminUsers.methods(user);
  let stage = adminUsers.hasSecondFactor(m) ? 'mfa' : 'enrol';
  if (demo.enabled) stage = 'ok'; // public demo: no second factor
  const token = await adminUsers.createSession(user.id, stage, ip, {});
  res.set('Set-Cookie', auth.makeCookie(token, secure(), stage === 'ok' ? undefined : 600));
  if (stage === 'ok') await adminUsers.noteSuccess(user.id);
  return { stage, methods: { totp: m.totp, passkey: m.passkey, email: m.email && mailOn(), recovery: m.recovery } };
}
// Which actions a half-open or signed-in session may do
const needStage = (...stages) => (req, res, next) => {
  const s = req.adminSession;
  if (!s || !stages.includes(s.stage)) return fail(res, 'Not signed in.', 401);
  next();
};
async function userState(u) {
  const m = await adminUsers.methods(u);
  return { email: u.email, name: u.name, role: u.role, methods: { totp: m.totp, passkey: m.passkey, email: m.email && mailOn(), recovery: m.recovery } };
}

router.get('/api/auth/state', async (req, res) => {
  try {
    const n = await adminUsers.count();
    const s = req.adminSession;
    const out = { ok: true, bootstrapNeeded: n === 0 && !demo.enabled, mailEnabled: mailOn(), demo: demo.enabled, stage: s ? s.stage : 'none', user: null };
    if (out.bootstrapNeeded) {
      out.ownerEmail = process.env.OWNER_EMAIL || '';
      out.bootstrapReady = true;
      out.codeInLog = auth.bootstrapCodeIsGenerated();
    }
    if (s) { out.user = await userState(s.user); out.isDefaultTotp = false; }
    res.json(out);
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});

// ---- First account (needs the setup code from SETUP_PASSWORD / ADMIN_PASSWORD) ----
router.post('/api/auth/bootstrap', async (req, res) => {
  try {
    if (auth.throttled(req.ip)) return fail(res, 'Too many attempts, try again later.', 429);
    const b = req.body || {};
    if (await adminUsers.count() > 0) return fail(res, 'Setup has already been done. Sign in instead.');
    if (!auth.checkBootstrapCode(b.code)) { auth.recordFailure(req.ip); return fail(res, 'Wrong setup code.'); }
    const owner = process.env.OWNER_EMAIL;
    const r = await adminUsers.createOwner({ email: owner || b.email, name: b.name, password: b.password });
    if (r.error) return fail(res, r.error);
    auth.clearFailures(req.ip);
    await log('OK', 'admin_created', r.user.email, req.ip, 'first account');
    res.json(Object.assign({ ok: true }, await startSession(res, r.user, req.ip)));
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});

// ---- Password step ----
router.post('/api/auth/login', async (req, res) => {
  try {
    if (auth.throttled(req.ip)) return fail(res, 'Too many attempts, try again later.', 429);
    const b = req.body || {};
    const r = await adminUsers.checkLogin(b.email, String(b.password || ''));
    if (r.error) { auth.recordFailure(req.ip); await log('WARN', 'admin_login_failed', adminUsers.normEmail(b.email).slice(0, 80), req.ip); return fail(res, r.error, 401); }
    if (b.mode === 'setup' && r.user.role !== 'setup') return fail(res, 'This page needs an event setup account.', 403);
    auth.clearFailures(req.ip);
    res.json(Object.assign({ ok: true }, await startSession(res, r.user, req.ip)));
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});

// ---- Second factor at sign-in ----
router.post('/api/auth/verify', needStage('mfa'), async (req, res) => {
  try {
    const s = req.adminSession, b = req.body || {}, u = s.user;
    let ok = false, usedRecovery = false;
    if (b.method === 'totp') ok = await adminUsers.checkTotp(u, b.code);
    else if (b.method === 'recovery') { ok = await adminUsers.useRecovery(u, b.code); usedRecovery = ok; }
    else if (b.method === 'email') ok = u.email_otp_enabled && await adminUsers.checkEmailCode(s, b.code, 'login');
    else return fail(res, 'Unknown method.');
    if (!ok) {
      const killed = await adminUsers.failedFactor(s);
      await log('WARN', 'admin_2fa_failed', u.email, req.ip, 'method=' + b.method);
      if (killed) { res.set('Set-Cookie', auth.clearCookie(secure())); return fail(res, 'Too many wrong codes. Enter your password again.', 401); }
      return fail(res, 'That code is not correct.', 401);
    }
    await adminUsers.promote(s.hash);
    await adminUsers.noteSuccess(u.id);
    res.set('Set-Cookie', auth.makeCookie(auth.tokenOf(req), secure()));
    await log('OK', 'admin_login', u.email, req.ip, 'method=' + b.method);
    const left = usedRecovery ? (await adminUsers.byId(u.id)).recovery_codes.length : null;
    res.json({ ok: true, recoveryLeft: left });
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/email/send', needStage('mfa'), async (req, res) => {
  try {
    const s = req.adminSession;
    if (!mailOn() || !s.user.email_otp_enabled) return fail(res, 'Email codes are not available for this account.');
    const r = await adminUsers.issueEmailCode(s, 'login');
    if (r.error) return fail(res, r.error, 429);
    await emails.sendMail(s.user.email, `[${CONFIG.EVENT_SHORT}] Your sign-in code`, `Your sign-in code is ${r.code}\n\nIt is valid for 10 minutes. If you did not try to sign in, change your password.`, { noFooter: true });
    res.json({ ok: true });
  } catch (e) { console.error(e); fail(res, 'Could not send the email.', 500); }
});
router.post('/api/auth/passkey/options', needStage('mfa'), async (req, res) => {
  try { const r = await passkeys.authenticationOptions(req, req.adminSession); r.error ? fail(res, r.error) : res.json({ ok: true, options: r.options }); }
  catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/passkey/verify', needStage('mfa'), async (req, res) => {
  try {
    const s = req.adminSession;
    if (!(await passkeys.verifyAuthentication(req, s, (req.body || {}).response))) {
      const killed = await adminUsers.failedFactor(s);
      await log('WARN', 'admin_2fa_failed', s.user.email, req.ip, 'method=passkey');
      if (killed) { res.set('Set-Cookie', auth.clearCookie(secure())); return fail(res, 'Too many failed attempts. Enter your password again.', 401); }
      return fail(res, 'The passkey was not accepted.', 401);
    }
    await adminUsers.promote(s.hash); await adminUsers.noteSuccess(s.user.id);
    res.set('Set-Cookie', auth.makeCookie(auth.tokenOf(req), secure()));
    await log('OK', 'admin_login', s.user.email, req.ip, 'method=passkey');
    res.json({ ok: true });
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});

// ---- Enrolling a second factor (forced at the first sign-in; later from the account card) ----
async function finishEnrol(req, res, extra) {
  const s = req.adminSession;
  const codes = await adminUsers.ensureRecovery(s.user.id);
  if (s.stage === 'enrol') {
    await adminUsers.promote(s.hash); await adminUsers.noteSuccess(s.user.id);
    res.set('Set-Cookie', auth.makeCookie(auth.tokenOf(req), secure()));
    await log('OK', 'admin_login', s.user.email, req.ip, 'first 2fa enrolment');
  }
  res.json(Object.assign({ ok: true, recoveryCodes: codes }, extra || {}));
}
router.post('/api/auth/totp/begin', needStage('enrol', 'ok'), async (req, res) => {
  try {
    const s = req.adminSession;
    const secret = await adminUsers.startTotpEnrol(s);
    const uri = C.otpauthUri(secret, s.user.email, issuer());
    res.json({ ok: true, secret, uri, qr: qrSvg(uri) });
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/totp/confirm', needStage('enrol', 'ok'), async (req, res) => {
  try {
    if (auth.throttled(req.ip)) return fail(res, 'Too many attempts, try again later.', 429);
    const s = req.adminSession;
    const r = await adminUsers.finishTotpEnrol(s, (req.body || {}).code);
    if (r.error) { auth.recordFailure(req.ip); return fail(res, r.error); }
    await log('OK', 'admin_2fa_added', s.user.email, req.ip, 'method=totp');
    await finishEnrol(req, res);
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/passkey/register/options', needStage('enrol', 'ok'), async (req, res) => {
  try { res.json({ ok: true, options: await passkeys.registrationOptions(req, req.adminSession) }); }
  catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/passkey/register/verify', needStage('enrol', 'ok'), async (req, res) => {
  try {
    const s = req.adminSession, b = req.body || {};
    const r = await passkeys.verifyRegistration(req, s, b.response, b.name);
    if (r.error) return fail(res, r.error);
    await log('OK', 'admin_2fa_added', s.user.email, req.ip, 'method=passkey');
    await finishEnrol(req, res);
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/email/enrol/send', needStage('enrol', 'ok'), async (req, res) => {
  try {
    const s = req.adminSession;
    if (!mailOn()) return fail(res, 'This server cannot send email, so email codes are not available.');
    const r = await adminUsers.issueEmailCode(s, 'enrol');
    if (r.error) return fail(res, r.error, 429);
    await emails.sendMail(s.user.email, `[${CONFIG.EVENT_SHORT}] Confirm your email code`, `Your confirmation code is ${r.code}\n\nIt is valid for 10 minutes.`, { noFooter: true });
    res.json({ ok: true });
  } catch (e) { console.error(e); fail(res, 'Could not send the email.', 500); }
});
router.post('/api/auth/email/enrol/confirm', needStage('enrol', 'ok'), async (req, res) => {
  try {
    if (auth.throttled(req.ip)) return fail(res, 'Too many attempts, try again later.', 429);
    const s = req.adminSession;
    if (!(await adminUsers.checkEmailCode(s, (req.body || {}).code, 'enrol'))) { auth.recordFailure(req.ip); return fail(res, 'That code is not correct.'); }
    await adminUsers.setEmailCodeEnabled(s.user.id);
    await log('OK', 'admin_2fa_added', s.user.email, req.ip, 'method=email');
    await finishEnrol(req, res);
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});

// ---- Account card (signed in) ----
router.post('/api/auth/account', needStage('ok'), async (req, res) => {
  try {
    const u = req.adminSession.user;
    const pk = await adminUsers.passkeys(u.id);
    res.json({ ok: true, account: Object.assign(await adminUsers.publicView(u), { mailEnabled: mailOn(), passkeyList: pk.map(p => ({ id: p.id, name: p.name, created: p.created_at, lastUsed: p.last_used_at })) }) });
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
// Changes that weaken or replace credentials need the password again.
async function reauth(req, res) {
  const u = req.adminSession.user;
  if (auth.throttled(req.ip)) { fail(res, 'Too many attempts, try again later.', 429); return null; }
  if (!(await C.verifyPassword(String((req.body || {}).password || ''), u.password_hash))) { auth.recordFailure(req.ip); fail(res, 'The password is wrong.', 403); return null; }
  return u;
}
const remaining = async (id, drop) => { const m = await adminUsers.methods(await adminUsers.byId(id)); return [m.totp, m.passkey, m.email].filter(Boolean).length - (drop ? 1 : 0); };
router.post('/api/auth/totp/disable', needStage('ok'), async (req, res) => {
  try {
    const u = await reauth(req, res); if (!u) return;
    if (!u.totp_enabled) return fail(res, 'The authenticator app is not enabled.');
    if (!demo.enabled && await remaining(u.id, true) < 1) return fail(res, 'Add another second factor first: at least one is required.');
    await adminUsers.disableTotp(u.id); await log('OK', 'admin_2fa_removed', u.email, req.ip, 'method=totp'); res.json({ ok: true });
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/email/disable', needStage('ok'), async (req, res) => {
  try {
    const u = await reauth(req, res); if (!u) return;
    if (!u.email_otp_enabled) return fail(res, 'Email codes are not enabled.');
    if (!demo.enabled && await remaining(u.id, true) < 1) return fail(res, 'Add another second factor first: at least one is required.');
    await adminUsers.disableEmailCode(u.id); await log('OK', 'admin_2fa_removed', u.email, req.ip, 'method=email'); res.json({ ok: true });
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/passkey/remove', needStage('ok'), async (req, res) => {
  try {
    const u = await reauth(req, res); if (!u) return;
    const n = (await adminUsers.passkeys(u.id)).length;
    if (!demo.enabled && n === 1 && await remaining(u.id, true) < 1) return fail(res, 'Add another second factor first: at least one is required.');
    if (!(await adminUsers.removePasskey(u.id, parseInt((req.body || {}).id, 10)))) return fail(res, 'Passkey not found.');
    await log('OK', 'admin_2fa_removed', u.email, req.ip, 'method=passkey'); res.json({ ok: true });
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/recovery/regenerate', needStage('ok'), async (req, res) => {
  try {
    const u = await reauth(req, res); if (!u) return;
    await log('OK', 'admin_recovery_regenerated', u.email, req.ip);
    res.json({ ok: true, recoveryCodes: await adminUsers.ensureRecovery(u.id, true) });
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/password/change', needStage('ok'), async (req, res) => {
  try {
    if (demo.enabled) return fail(res, 'Changing the password is switched off in the demo.');
    if (auth.throttled(req.ip)) return fail(res, 'Too many attempts, try again later.', 429);
    const s = req.adminSession, b = req.body || {};
    const r = await adminUsers.changePassword(s.user.id, String(b.current || ''), String(b.next || ''));
    if (r.error) { auth.recordFailure(req.ip); return fail(res, r.error); }
    await adminUsers.endAllSessions(s.user.id, s.hash); // other devices are signed out
    await log('OK', 'admin_password_changed', s.user.email, req.ip);
    res.json({ ok: true });
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.post('/api/auth/logout', async (req, res) => {
  try { await adminUsers.endSession(auth.tokenOf(req)); } catch (_) { /* ignore */ }
  res.set('Set-Cookie', auth.clearCookie(secure())); res.json({ ok: true });
});
router.post('/api/auth/logout-others', needStage('ok'), async (req, res) => {
  try { await adminUsers.endAllSessions(req.adminSession.user.id, req.adminSession.hash); res.json({ ok: true }); }
  catch (e) { console.error(e); fail(res, 'Server error', 500); }
});

// ---- Invitations and password reset ----
router.post('/api/auth/forgot', async (req, res) => {
  try {
    if (demo.enabled) return res.json({ ok: true, mailEnabled: false });
    if (auth.throttled(req.ip)) return fail(res, 'Too many attempts, try again later.', 429);
    auth.recordFailure(req.ip); // counts as an attempt: this endpoint is public
    const r = mailOn() ? await adminUsers.requestReset((req.body || {}).email) : null;
    if (r) {
      const link = `${adminUsers.baseUrl() || req.protocol + '://' + req.get('host')}/auth/accept?token=${r.token}`;
      await emails.sendMail(r.user.email, `[${CONFIG.EVENT_SHORT}] Reset your admin password`, `Open this link to choose a new password (valid for one hour):\n\n${link}\n\nYour second factor stays the same. If you did not ask for this, ignore this message.`, { noFooter: true });
      await log('OK', 'admin_reset_requested', r.user.email, req.ip);
    }
    res.json({ ok: true, mailEnabled: mailOn() }); // same answer whether or not the account exists
  } catch (e) { console.error(e); res.json({ ok: true }); }
});
router.get('/auth/accept', (req, res) => {
  res.set('X-Frame-Options', 'DENY'); res.set('Referrer-Policy', 'no-referrer');
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(CONFIG.EVENT_SHORT)} — Admin account</title></head><body style="margin:0;background:#f6f8fa">
<div id="auth-root"></div><script src="/admin-auth.js"></script>
<script>EbsAuth.mount(document.getElementById('auth-root'), { mode: 'accept', token: ${JSON.stringify(String(req.query.token || ''))}, title: ${JSON.stringify(CONFIG.EVENT_NAME || '')}, onReady: function () { location.href = '/?admin=1'; } });</script></body></html>`);
});
router.post('/api/auth/accept', async (req, res) => {
  try {
    if (auth.throttled(req.ip)) return fail(res, 'Too many attempts, try again later.', 429);
    const b = req.body || {};
    const r = await adminUsers.acceptToken(String(b.token || ''), { name: b.name, password: b.password });
    if (r.error) { auth.recordFailure(req.ip); return fail(res, r.error); }
    await log('OK', r.kind === 'invite' ? 'admin_invite_accepted' : 'admin_password_reset', r.user.email, req.ip);
    res.json(Object.assign({ ok: true }, await startSession(res, r.user, req.ip)));
  } catch (e) { console.error(e); fail(res, 'Server error', 500); }
});
router.get('/api/auth/token-info', async (req, res) => {
  try { const u = await adminUsers.tokenUser(String(req.query.token || '')); res.json(u ? { ok: true, email: u.email, name: u.name, kind: u.token_kind } : { ok: false, error: 'This link is invalid or has expired. Ask for a new one.' }); }
  catch (e) { fail(res, 'Server error', 500); }
});

// ---- Managing accounts (setup role only; called from server.js RPC table) ----
const inviteMail = (u, link, name) => ({
  subject: `[${CONFIG.EVENT_SHORT}] You have been invited as ${u.role === 'setup' ? 'event setup administrator' : 'booking administrator'}`,
  body: `${name ? name + ' has' : 'You have been'} invited ${name ? 'you' : ''} to administer ${CONFIG.EVENT_NAME}.\n\nOpen this link to choose a password and set up two-factor authentication (valid for 7 days):\n\n${link}\n`,
});
const users = {
  list: async () => ({ success: true, users: await adminUsers.list(), mailEnabled: mailOn() }),
  invite: async (actor, input) => {
    const r = await adminUsers.invite(input || {});
    if (r.error) return { success: false, error: r.error };
    const link = `${adminUsers.baseUrl()}/auth/accept?token=${r.token}`;
    let mailed = false;
    if (mailOn()) { const m = inviteMail(r.user, link, actor.name || actor.email); try { await emails.sendMail(r.user.email, m.subject, m.body, { noFooter: true }); mailed = true; } catch (e) { console.error('invite mail failed', e.message); } }
    await log('OK', 'admin_invited', actor.email, '', `invited=${r.user.email} role=${r.user.role}`);
    return { success: true, link, mailed };
  },
  resend: async (actor, id) => {
    const r = await adminUsers.newInviteToken(id);
    if (r.error) return { success: false, error: r.error };
    const link = `${adminUsers.baseUrl()}/auth/accept?token=${r.token}`;
    let mailed = false;
    if (mailOn()) { const m = inviteMail(r.user, link, actor.name || actor.email); try { await emails.sendMail(r.user.email, m.subject, m.body, { noFooter: true }); mailed = true; } catch (e) { /* link is shown instead */ } }
    return { success: true, link, mailed };
  },
  update: async (actor, id, patch) => {
    if (id === actor.id) return { success: false, error: 'You cannot change your own role or disable yourself.' };
    const r = await adminUsers.update(id, patch || {});
    if (r.error) return { success: false, error: r.error };
    await log('OK', 'admin_updated', actor.email, '', `target=${r.user.email} ${JSON.stringify(patch)}`);
    return { success: true };
  },
  resetTwoFactor: async (actor, id) => {
    const r = await adminUsers.resetTwoFactor(id);
    if (r.error) return { success: false, error: r.error };
    await log('WARN', 'admin_2fa_reset', actor.email, '', `target=${r.user.email}`);
    return { success: true };
  },
  remove: async (actor, id) => {
    if (id === actor.id) return { success: false, error: 'You cannot delete your own account.' };
    const r = await adminUsers.remove(id);
    if (r.error) return { success: false, error: r.error };
    await log('WARN', 'admin_deleted', actor.email, '', `target=${r.user.email}`);
    return { success: true };
  },
};

module.exports = { router, users };
