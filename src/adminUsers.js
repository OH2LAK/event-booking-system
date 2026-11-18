'use strict';
// Admin accounts, login sessions and second factors (TOTP, recovery codes, email code, passkeys).
// HTTP routes are in authRoutes.js; request-level checks in auth.js.
const db = require('./db');
const C = require('./adminCrypto');
const { CONFIG } = require('./config');

const SESSION_MS = 12 * 60 * 60 * 1000;      // fully signed in
const PENDING_MS = 10 * 60 * 1000;           // password ok, second factor or enrolment still open
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_MS = 60 * 60 * 1000;
const LOCK_AFTER = 5, LOCK_MS = 15 * 60 * 1000;
const BOOTSTRAP_LOCK = 2026111801;

const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 150;
const cleanName = n => String(n || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);

const q = (t, p) => db.query(t, p);
async function count() { return (await q('SELECT count(*)::int AS n FROM admin_users')).rows[0].n; }
const byId = async id => (await q('SELECT * FROM admin_users WHERE id = $1', [id])).rows[0] || null;
const byEmail = async e => (await q('SELECT * FROM admin_users WHERE lower(email) = $1', [normEmail(e)])).rows[0] || null;

async function passkeyCount(id) { return (await q('SELECT count(*)::int AS n FROM admin_passkeys WHERE user_id = $1', [id])).rows[0].n; }
async function methods(u) {
  const pk = await passkeyCount(u.id);
  return { totp: !!u.totp_enabled, passkey: pk > 0, email: !!u.email_otp_enabled, recovery: (u.recovery_codes || []).length > 0, passkeys: pk };
}
const hasSecondFactor = m => m.totp || m.passkey || m.email;

async function publicView(u) {
  const m = await methods(u);
  return { id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled,
    pending: !u.password_hash, twoFactor: hasSecondFactor(m), totp: m.totp, passkeys: m.passkeys, emailCode: m.email,
    recoveryLeft: (u.recovery_codes || []).length, lastLogin: u.last_login_at, created: u.created_at };
}
async function list() {
  const rows = (await q('SELECT * FROM admin_users ORDER BY role DESC, lower(email)')).rows;
  return Promise.all(rows.map(publicView));
}

// ---- Creating accounts ----
// First account on a fresh system (or after all accounts were removed). Race-safe.
async function createOwner({ email, name, password }) {
  email = normEmail(email);
  if (!validEmail(email)) return { error: 'Enter a valid email address.' };
  const bad = C.passwordProblem(password, email);
  if (bad) return { error: bad };
  const hash = await C.hashPassword(password);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK]);
    if ((await client.query('SELECT count(*)::int AS n FROM admin_users')).rows[0].n > 0) { await client.query('ROLLBACK'); return { error: 'Setup has already been done.' }; }
    const r = await client.query(`INSERT INTO admin_users (email, name, role, password_hash) VALUES ($1,$2,'setup',$3) RETURNING *`, [email, cleanName(name), hash]);
    await client.query('COMMIT');
    return { user: r.rows[0] };
  } catch (e) { try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ } throw e; }
  finally { client.release(); }
}
async function invite({ email, name, role }) {
  email = normEmail(email);
  if (!validEmail(email)) return { error: 'Enter a valid email address.' };
  if (role !== 'setup' && role !== 'admin') return { error: 'Choose a role.' };
  if (await byEmail(email)) return { error: 'An account with this email already exists.' };
  const token = C.randomToken();
  const r = await q(`INSERT INTO admin_users (email, name, role, token_hash, token_kind, token_expires) VALUES ($1,$2,$3,$4,'invite', now() + $5 * interval '1 millisecond') RETURNING *`,
    [email, cleanName(name), role, C.sha256(token), INVITE_MS]);
  return { user: r.rows[0], token };
}
async function newInviteToken(id) {
  const u = await byId(id);
  if (!u || u.password_hash) return { error: 'This account has already accepted its invitation.' };
  const token = C.randomToken();
  await q(`UPDATE admin_users SET token_hash=$2, token_kind='invite', token_expires = now() + $3 * interval '1 millisecond' WHERE id=$1`, [id, C.sha256(token), INVITE_MS]);
  return { user: u, token };
}
async function requestReset(email) {
  const u = await byEmail(email);
  if (!u || u.disabled || !u.password_hash) return null; // pending invites use the invite link
  const token = C.randomToken();
  await q(`UPDATE admin_users SET token_hash=$2, token_kind='reset', token_expires = now() + $3 * interval '1 millisecond' WHERE id=$1`, [u.id, C.sha256(token), RESET_MS]);
  return { user: u, token };
}
async function tokenUser(token) {
  if (!token) return null;
  const r = await q(`SELECT * FROM admin_users WHERE token_hash = $1 AND token_hash <> '' AND token_expires > now() AND NOT disabled`, [C.sha256(token)]);
  return r.rows[0] || null;
}
// Invite or reset link: sets the password, ends all old sessions. Returns the user.
async function acceptToken(token, { name, password }) {
  const u = await tokenUser(token);
  if (!u) return { error: 'This link is invalid or has expired. Ask for a new one.' };
  const bad = C.passwordProblem(password, u.email);
  if (bad) return { error: bad };
  const hash = await C.hashPassword(password);
  await q(`UPDATE admin_users SET password_hash=$2, name = CASE WHEN $3 <> '' THEN $3 ELSE name END, token_hash='', token_kind='', token_expires=NULL, failed_logins=0, locked_until=NULL WHERE id=$1`, [u.id, hash, cleanName(name)]);
  await q('DELETE FROM admin_sessions WHERE user_id = $1', [u.id]);
  return { user: await byId(u.id), kind: u.token_kind };
}

// ---- Password login ----
let dummyHash = null;
async function checkLogin(email, password) {
  const u = await byEmail(email);
  if (!u || !u.password_hash || u.disabled) {
    if (!dummyHash) dummyHash = await C.hashPassword('dummy-password-for-timing');
    await C.verifyPassword(password, dummyHash); // same work for unknown accounts
    return { error: 'Wrong email or password.' };
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) return { error: 'This account is temporarily locked after too many failed attempts. Try again in 15 minutes.' };
  if (!(await C.verifyPassword(password, u.password_hash))) {
    const n = u.failed_logins + 1;
    await q('UPDATE admin_users SET failed_logins=$2::int, locked_until = CASE WHEN $2::int >= $3::int THEN now() + $4::int * interval \'1 millisecond\' ELSE locked_until END WHERE id=$1', [u.id, n, LOCK_AFTER, LOCK_MS]);
    return { error: 'Wrong email or password.' };
  }
  return { user: u };
}
async function noteSuccess(id) { await q('UPDATE admin_users SET failed_logins=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [id]); }
async function changePassword(id, current, next) {
  const u = await byId(id);
  if (!u || !(await C.verifyPassword(current, u.password_hash))) return { error: 'The current password is wrong.' };
  const bad = C.passwordProblem(next, u.email);
  if (bad) return { error: bad };
  await q('UPDATE admin_users SET password_hash=$2 WHERE id=$1', [id, await C.hashPassword(next)]);
  return { ok: true };
}

// ---- Sessions ----
async function createSession(userId, stage, ip, meta) {
  const token = C.randomToken();
  await q('DELETE FROM admin_sessions WHERE expires_at < now()');
  await q(`INSERT INTO admin_sessions (token_hash, user_id, stage, meta, ip, expires_at) VALUES ($1,$2,$3,$4,$5, now() + $6 * interval '1 millisecond')`,
    [C.sha256(token), userId, stage, JSON.stringify(meta || {}), String(ip || ''), stage === 'ok' ? SESSION_MS : PENDING_MS]);
  return token;
}
async function getSession(token) {
  if (!token) return null;
  const r = await q(`SELECT u.*, s.stage AS s_stage, s.meta AS s_meta, s.token_hash AS s_hash FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled`, [C.sha256(token)]);
  const x = r.rows[0];
  return x ? { hash: x.s_hash, stage: x.s_stage, meta: x.s_meta || {}, user: x } : null;
}
async function promote(hash) {
  await q(`UPDATE admin_sessions SET stage='ok', meta='{}', expires_at = now() + $2 * interval '1 millisecond' WHERE token_hash=$1`, [hash, SESSION_MS]);
}
async function setMeta(hash, patch) { await q(`UPDATE admin_sessions SET meta = meta || $2::jsonb WHERE token_hash=$1`, [hash, JSON.stringify(patch)]); }
async function endSession(token) { if (token) await q('DELETE FROM admin_sessions WHERE token_hash=$1', [C.sha256(token)]); }
async function endAllSessions(userId, exceptHash) { await q('DELETE FROM admin_sessions WHERE user_id=$1 AND token_hash <> $2', [userId, exceptHash || '']); }
// Counts a failed second-factor attempt; after 5 the half-open session is destroyed (the user must enter the password again).
async function failedFactor(sess) {
  const n = (sess.meta.fails || 0) + 1;
  if (n >= 5) { await q('DELETE FROM admin_sessions WHERE token_hash=$1', [sess.hash]); return true; }
  await setMeta(sess.hash, { fails: n });
  return false;
}

// ---- Second factors ----
// Returns true when the code is a valid current TOTP code (and was not used before).
async function checkTotp(u, code) {
  if (!u.totp_enabled) return false;
  const step = C.totpVerify(C.decrypt(u.totp_secret), code);
  if (!step || step <= Number(u.totp_last_step)) return false;
  const r = await q('UPDATE admin_users SET totp_last_step=$2 WHERE id=$1 AND totp_last_step < $2', [u.id, step]);
  return r.rowCount === 1;
}
// Single-use recovery code.
async function useRecovery(u, code) {
  const h = C.hashRecovery(code);
  const list = u.recovery_codes || [];
  if (!list.includes(h)) return false;
  const r = await q(`UPDATE admin_users SET recovery_codes = recovery_codes - $2 WHERE id=$1 AND recovery_codes ? $2`, [u.id, h]);
  return r.rowCount === 1;
}
async function startTotpEnrol(sess) {
  const secret = C.newTotpSecret();
  await setMeta(sess.hash, { pendingTotp: C.encrypt(secret) });
  return secret;
}
// Confirms the first code from the authenticator app (recovery codes are created by the route).
async function finishTotpEnrol(sess, code) {
  const secret = C.decrypt(sess.meta.pendingTotp);
  const step = C.totpVerify(secret, code);
  if (!secret || !step) return { error: 'That code is not correct. Check the time on your phone and try again.' };
  await q('UPDATE admin_users SET totp_secret=$2, totp_enabled=true, totp_last_step=$3 WHERE id=$1', [sess.user.id, C.encrypt(secret), step]);
  await setMeta(sess.hash, { pendingTotp: null });
  return { ok: true };
}
async function ensureRecovery(id, force) {
  const u = await byId(id);
  if (!force && (u.recovery_codes || []).length) return null;
  const codes = C.newRecoveryCodes(10);
  await q('UPDATE admin_users SET recovery_codes=$2::jsonb WHERE id=$1', [id, JSON.stringify(codes.map(C.hashRecovery))]);
  return codes;
}
async function disableTotp(id) {
  await q(`UPDATE admin_users SET totp_enabled=false, totp_secret='', totp_last_step=0 WHERE id=$1`, [id]);
}
async function disableEmailCode(id) { await q('UPDATE admin_users SET email_otp_enabled=false WHERE id=$1', [id]); }
async function setEmailCodeEnabled(id) { await q('UPDATE admin_users SET email_otp_enabled=true WHERE id=$1', [id]); }

// Email code: stored hashed in the session; 10 minutes, 5 tries, one resend per minute.
async function issueEmailCode(sess, purpose) {
  const last = Number(sess.meta.emailSentAt || 0);
  if (Date.now() - last < 60 * 1000) return { error: 'Wait a minute before asking for another code.' };
  const code = C.newEmailCode();
  await setMeta(sess.hash, { emailCode: C.sha256('ec|' + sess.hash + '|' + code), emailExp: Date.now() + 10 * 60 * 1000, emailSentAt: Date.now(), emailPurpose: purpose, emailTries: 0 });
  return { code };
}
async function checkEmailCode(sess, code, purpose) {
  const m = sess.meta;
  if (!m.emailCode || m.emailPurpose !== purpose || Number(m.emailExp) < Date.now()) return false;
  if ((m.emailTries || 0) >= 5) return false;
  await setMeta(sess.hash, { emailTries: (m.emailTries || 0) + 1 });
  const ok = C.safeEq(m.emailCode, C.sha256('ec|' + sess.hash + '|' + String(code || '').replace(/\s+/g, '')));
  if (ok) await setMeta(sess.hash, { emailCode: null });
  return ok;
}

// ---- Passkeys ----
const passkeys = async id => (await q('SELECT * FROM admin_passkeys WHERE user_id=$1 ORDER BY id', [id])).rows;
async function addPasskey(userId, { credId, publicKey, counter, transports, name }) {
  await q('INSERT INTO admin_passkeys (user_id, cred_id, public_key, counter, transports, name) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, credId, publicKey, counter, (transports || []).join(','), cleanName(name) || 'Passkey']);
}
async function touchPasskey(credId, counter) { await q('UPDATE admin_passkeys SET counter=$2, last_used_at=now() WHERE cred_id=$1', [credId, counter]); }
async function removePasskey(userId, id) { return (await q('DELETE FROM admin_passkeys WHERE user_id=$1 AND id=$2', [userId, id])).rowCount; }

// ---- Managing other accounts (setup role) ----
async function activeSetupCount(exceptId) { return (await q(`SELECT count(*)::int AS n FROM admin_users WHERE role='setup' AND NOT disabled AND password_hash <> '' AND id <> $1`, [exceptId || 0])).rows[0].n; }
async function update(id, { role, disabled }) {
  const u = await byId(id);
  if (!u) return { error: 'Account not found.' };
  const newRole = role || u.role, newDisabled = disabled === undefined ? u.disabled : !!disabled;
  if (newRole !== 'setup' && newRole !== 'admin') return { error: 'Invalid role.' };
  if (u.role === 'setup' && (newRole !== 'setup' || newDisabled) && (await activeSetupCount(id)) === 0) return { error: 'There must be at least one active setup account.' };
  await q('UPDATE admin_users SET role=$2, disabled=$3 WHERE id=$1', [id, newRole, newDisabled]);
  if (newDisabled || newRole !== u.role) await q('DELETE FROM admin_sessions WHERE user_id=$1', [id]);
  return { ok: true, user: u };
}
async function remove(id) {
  const u = await byId(id);
  if (!u) return { error: 'Account not found.' };
  if (u.role === 'setup' && (await activeSetupCount(id)) === 0) return { error: 'There must be at least one active setup account.' };
  await q('DELETE FROM admin_users WHERE id=$1', [id]);
  return { ok: true, user: u };
}
// Lost phone: removes every second factor so the person must enrol again at the next login.
async function resetTwoFactor(id) {
  const u = await byId(id);
  if (!u) return { error: 'Account not found.' };
  await q(`UPDATE admin_users SET totp_enabled=false, totp_secret='', totp_last_step=0, email_otp_enabled=false, recovery_codes='[]' WHERE id=$1`, [id]);
  await q('DELETE FROM admin_passkeys WHERE user_id=$1', [id]);
  await q('DELETE FROM admin_sessions WHERE user_id=$1', [id]);
  return { ok: true, user: u };
}

// Demo instances (DEMO_MODE=1) have public demo accounts without a second factor. Never used otherwise.
async function ensureDemoUsers() {
  const admin = process.env.ADMIN_PASSWORD || 'demo-admin-password', setup = process.env.SETUP_PASSWORD || admin;
  for (const [email, role, pw] of [['setup@demo.invalid', 'setup', setup], ['admin@demo.invalid', 'admin', admin]]) {
    if (await byEmail(email)) continue;
    await q(`INSERT INTO admin_users (email, name, role, password_hash) VALUES ($1,$2,$3,$4)`, [email, role === 'setup' ? 'Demo setup' : 'Demo admin', role, await C.hashPassword(pw)]);
  }
}

const baseUrl = () => String(process.env.PUBLIC_URL || CONFIG.FRIENDLY_URL || '').replace(/\/+$/, '');

module.exports = { SESSION_MS, normEmail, validEmail, cleanName, count, byId, byEmail, methods, hasSecondFactor, publicView, list, createOwner, invite, newInviteToken,
  requestReset, tokenUser, acceptToken, checkLogin, noteSuccess, changePassword, createSession, getSession, promote, setMeta, endSession, endAllSessions, failedFactor,
  checkTotp, useRecovery, startTotpEnrol, finishTotpEnrol, ensureRecovery, disableTotp, disableEmailCode, setEmailCodeEnabled, issueEmailCode, checkEmailCode,
  passkeys, addPasskey, touchPasskey, removePasskey, update, remove, resetTwoFactor, activeSetupCount, ensureDemoUsers, baseUrl };
