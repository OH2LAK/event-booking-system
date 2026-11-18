'use strict';
// Admin accounts and two-factor authentication, end to end against a running instance on a FRESH database.
//   BASE_URL=http://localhost:3996 SETUP_PASSWORD=... SMTP_HOST=127.0.0.1 SMTP_PORT=2525 (server side) node tests/auth.js
// The test starts a tiny SMTP sink on port 2525 so email codes, invitations and password resets can be read.
// Covers: first-time setup, mandatory 2FA, TOTP (incl. replay), recovery codes, email codes, passkeys (virtual authenticator),
// invitations, roles, safeguards, password reset and change, lockouts and throttling.
const net = require('net');
const crypto = require('crypto');
const C = require('../src/adminCrypto');
const BASE = process.env.BASE_URL || 'http://localhost:3996';
const SETUP_CODE = process.env.SETUP_PASSWORD || '';
let failures = 0;
const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(p, body, cookie) {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookie || '' }, body: JSON.stringify(body || {}) });
  const sc = r.headers.get('set-cookie');
  return { status: r.status, json: await r.json().catch(() => ({})), cookie: sc ? sc.split(';')[0] : '', setCookie: sc || '' };
}
const get = async (p, cookie) => (await fetch(BASE + p, { headers: { cookie: cookie || '' } })).json();
const rpc = (m, cookie, ...args) => post('/api/rpc/' + m, { args }, cookie);

// ---- SMTP sink ----
const mails = [];
function startSink() {
  return new Promise(resolve => {
    const srv = net.createServer(sock => {
      let buf = '', inData = false, cur = { to: [], body: '' };
      sock.write('220 sink ESMTP\r\n');
      sock.on('data', d => {
        buf += d.toString('utf8');
        for (;;) {
          if (inData) {
            const i = buf.indexOf('\r\n.\r\n');
            if (i < 0) return;
            cur.body = buf.slice(0, i); buf = buf.slice(i + 5); inData = false;
            mails.push(cur); cur = { to: [], body: '' }; sock.write('250 ok\r\n'); continue;
          }
          const i = buf.indexOf('\r\n');
          if (i < 0) return;
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          const u = line.toUpperCase();
          if (u.startsWith('EHLO') || u.startsWith('HELO')) sock.write('250-sink\r\n250 8BITMIME\r\n');
          else if (u.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
          else if (u.startsWith('RCPT TO')) { cur.to.push(line.slice(8).replace(/[<>\s]/g, '').toLowerCase()); sock.write('250 ok\r\n'); }
          else if (u === 'DATA') { inData = true; sock.write('354 go\r\n'); }
          else if (u === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('250 ok\r\n');
        }
      });
      sock.on('error', () => {});
    });
    srv.listen(parseInt(process.env.SMTP_PORT || '2525', 10), '127.0.0.1', () => resolve(srv));
  });
}
const qpDecode = s => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
async function mailTo(addr, since) {
  for (let i = 0; i < 40; i++) {
    const m = mails.slice(since || 0).reverse().find(x => x.to.includes(addr));
    if (m) return qpDecode(m.body);
    await sleep(150);
  }
  return '';
}

// ---- virtual passkey authenticator (ES256, "none" attestation) ----
function cbor(v) {
  const head = (major, n) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (v instanceof Map) return Buffer.concat([head(5, v.size)].concat([...v].flatMap(([k, x]) => [cbor(k), cbor(x)])));
  throw new Error('cbor');
}
const b64u = b => Buffer.from(b).toString('base64url');
function makeAuthenticator(rpId, origin) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = crypto.randomBytes(32);
  let counter = 0;
  const rpHash = crypto.createHash('sha256').update(rpId).digest();
  const clientData = (type, challenge, o) => Buffer.from(JSON.stringify({ type, challenge, origin: o || origin, crossOrigin: false }));
  return {
    create(options, o) {
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
      const idLen = Buffer.alloc(2); idLen.writeUInt16BE(credId.length);
      const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), idLen, credId, cbor(cose)]);
      const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64u(clientData('webauthn.create', options.challenge, o)), attestationObject: b64u(att), transports: ['internal'] } };
    },
    get(options, o) {
      counter++;
      const c = Buffer.alloc(4); c.writeUInt32BE(counter);
      const authData = Buffer.concat([rpHash, Buffer.from([0x05]), c]);
      const cd = clientData('webauthn.get', options.challenge, o);
      const sig = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(cd).digest()]), privateKey);
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(sig) } };
    },
    setCounter(n) { counter = n; },
  };
}

const PW1 = 'Correct-Horse-Battery-1', PW2 = 'Another-Strong-Secret-22', PW3 = 'Third-Strong-Secret-333';
let lastStep = 0;
// TOTP code that was not used yet in this test (waits for the next 30 s step when needed)
async function freshCode(secret) {
  for (;;) {
    const step = Math.floor(Date.now() / 30000);
    const use = Math.max(step, lastStep + 1);
    if (use <= step + 1) { lastStep = use; return C.totpAt(secret, use * 30000); }
    await sleep(1000);
  }
}
// Each TOTP secret has its own replay window, so track the last step per secret
const lastBySecret = {};
async function codeFor(secret) {
  for (;;) {
    const step = Math.floor(Date.now() / 30000);
    const use = Math.max(step, (lastBySecret[secret] || 0) + 1);
    if (use <= step + 1) { lastBySecret[secret] = use; return C.totpAt(secret, use * 30000); }
    await sleep(1000);
  }
}

(async () => {
  const sink = await startSink();
  let r, st;

  // ---- 1. nothing works before the first account exists ----
  st = await get('/api/auth/state');
  check('fresh system asks for first-time setup', st.bootstrapNeeded === true && st.stage === 'none' && st.bootstrapReady === true, st);
  check('admin API refuses without sign-in', (await rpc('getAdminData', '')).status === 401, null);
  check('the old password endpoint is gone', (await rpc('checkAdminPassword', '', SETUP_CODE, 'setup')).status === 404, null);
  r = await post('/api/auth/bootstrap', { code: 'wrong-code', email: 'owner@example.com', name: 'Owner', password: PW1 });
  check('wrong setup code rejected', !r.json.ok && r.json.error === 'Wrong setup code.', r.json);
  r = await post('/api/auth/bootstrap', { code: SETUP_CODE, email: 'owner@example.com', name: 'Owner', password: 'short' });
  check('weak password rejected', !r.json.ok && /12 characters/.test(r.json.error), r.json);
  r = await post('/api/auth/bootstrap', { code: SETUP_CODE, email: 'not-an-email', name: 'Owner', password: PW1 });
  check('bad email rejected', !r.json.ok, r.json);

  // ---- 2. first account, forced second factor ----
  r = await post('/api/auth/bootstrap', { code: SETUP_CODE, email: 'Owner@Example.com', name: 'Owner', password: PW1 });
  check('first account created', r.json.ok && r.json.stage === 'enrol', r.json);
  const ownerEnrol = r.cookie;
  check('session cookie is HttpOnly and SameSite=Strict', /HttpOnly/.test(r.setCookie) && /SameSite=Strict/.test(r.setCookie), r.setCookie);
  check('a second first-time setup is refused', !(await post('/api/auth/bootstrap', { code: SETUP_CODE, email: 'x@example.com', name: 'X', password: PW2 })).json.ok, null);
  check('password alone does not open the admin API', (await rpc('getAdminData', ownerEnrol)).status === 401, null);
  check('password alone does not open the setup API', (await rpc('getEventConfig', ownerEnrol)).status === 401, null);
  check('half-open session cannot create invitations', (await rpc('inviteAdminUser', ownerEnrol, { email: 'a@example.com', role: 'admin' })).status === 401, null);
  const b = await post('/api/auth/totp/begin', {}, ownerEnrol);
  check('authenticator enrolment gives a secret, a QR code and an otpauth link', b.json.ok && /^[A-Z2-7]{32}$/.test(b.json.secret) && /<svg/.test(b.json.qr) && b.json.uri.startsWith('otpauth://totp/'), b.json);
  r = await post('/api/auth/totp/confirm', { code: '000000' }, ownerEnrol);
  check('wrong enrolment code rejected', !r.json.ok, r.json);
  r = await post('/api/auth/totp/confirm', { code: await codeFor(b.json.secret) }, ownerEnrol);
  check('enrolment with a correct code gives 10 recovery codes', r.json.ok && r.json.recoveryCodes.length === 10, r.json);
  const ownerSecret = b.json.secret; let recovery = r.json.recoveryCodes;
  check('after enrolment the session is signed in', (await rpc('getEventConfig', ownerEnrol)).status === 200, null);
  let owner = ownerEnrol;
  check('email is stored in lower case', (await rpc('listAdminUsers', owner)).json.result.users[0].email === 'owner@example.com', null);

  // ---- 3. signing in again: password then second factor ----
  await post('/api/auth/logout', {}, owner);
  check('logout ends the session', (await rpc('getEventConfig', owner)).status === 401, null);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: 'wrong-password-here' });
  check('wrong password: generic error', r.status === 401 && r.json.error === 'Wrong email or password.', r.json);
  r = await post('/api/auth/login', { email: 'nobody@example.com', password: PW1 });
  check('unknown email: the same generic error', r.status === 401 && r.json.error === 'Wrong email or password.', r.json);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1, mode: 'setup' });
  check('password ok -> second factor required', r.json.ok && r.json.stage === 'mfa' && r.json.methods.totp === true && r.json.methods.recovery === true, r.json);
  let mfa = r.cookie;
  check('password alone is not enough', (await rpc('getEventConfig', mfa)).status === 401, null);
  r = await post('/api/auth/verify', { method: 'totp', code: C.totpAt(ownerSecret, lastBySecret[ownerSecret] * 30000) }, mfa);
  check('a TOTP code that was already used is refused (replay)', !r.json.ok, r.json);
  r = await post('/api/auth/verify', { method: 'totp', code: await codeFor(ownerSecret) }, mfa);
  check('next TOTP code signs in', r.json.ok, r.json);
  const owner1 = mfa;
  owner = owner1;
  check('signed in: setup API works', (await rpc('getEventConfig', owner1)).status === 200, null);

  // ---- 4. second-factor attempts are limited ----
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 });
  mfa = r.cookie; let killed = false;
  for (let i = 0; i < 5; i++) { const x = await post('/api/auth/verify', { method: 'totp', code: '111111' }, mfa); if (/password again/.test(x.json.error || '')) killed = true; }
  check('5 wrong codes destroy the half-open session', killed, null);
  check('the destroyed session cannot verify any more', (await post('/api/auth/verify', { method: 'totp', code: await codeFor(ownerSecret) }, mfa)).status === 401, null);

  // ---- 5. recovery codes ----
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 });
  mfa = r.cookie;
  r = await post('/api/auth/verify', { method: 'recovery', code: recovery[0] }, mfa);
  check('a recovery code signs in', r.json.ok && r.json.recoveryLeft === 9, r.json);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 });
  r = await post('/api/auth/verify', { method: 'recovery', code: recovery[0] }, r.cookie);
  check('a recovery code works only once', !r.json.ok, r.json);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 });
  r = await post('/api/auth/verify', { method: 'recovery', code: recovery[1].toUpperCase().replace('-', ' - ') }, r.cookie);
  check('recovery codes ignore case and separators', r.json.ok, r.json);

  // ---- 6. account card: sensitive changes need the password ----
  r = await post('/api/auth/account', {}, owner);
  check('account view', r.json.ok && r.json.account.totp === true && r.json.account.recoveryLeft === 8 && r.json.account.role === 'setup', r.json);
  r = await post('/api/auth/recovery/regenerate', { password: 'wrong' }, owner);
  check('new recovery codes need the password', r.status === 403, r.json);
  r = await post('/api/auth/recovery/regenerate', { password: PW1 }, owner);
  check('new recovery codes: 10 fresh ones', r.json.ok && r.json.recoveryCodes.length === 10, r.json);
  const oldRecovery = recovery; recovery = r.json.recoveryCodes;
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 });
  r = await post('/api/auth/verify', { method: 'recovery', code: oldRecovery[5] }, r.cookie);
  check('old recovery codes are refused after regenerating', !r.json.ok, r.json);
  r = await post('/api/auth/totp/disable', { password: PW1 }, owner);
  check('the last second factor cannot be removed', !r.json.ok && /at least one/.test(r.json.error), r.json);

  // ---- 7. passkeys with a virtual authenticator ----
  const origin = new URL(BASE).origin, rpId = new URL(BASE).hostname;
  const auth1 = makeAuthenticator(rpId, origin);
  let o = await post('/api/auth/passkey/register/options', {}, owner);
  check('passkey registration options', o.json.ok && o.json.options.rp.id === rpId && !!o.json.options.challenge, o.json);
  r = await post('/api/auth/passkey/register/verify', { response: auth1.create(o.json.options, 'https://evil.example'), name: 'Virtual key' }, owner);
  check('passkey from the wrong origin is refused', !r.json.ok, r.json);
  o = await post('/api/auth/passkey/register/options', {}, owner);
  r = await post('/api/auth/passkey/register/verify', { response: auth1.create(o.json.options), name: 'Virtual key' }, owner);
  check('passkey registered', r.json.ok, r.json);
  check('account lists the passkey', (await post('/api/auth/account', {}, owner)).json.account.passkeyList.length === 1, null);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 });
  check('login offers the passkey', r.json.methods.passkey === true, r.json);
  mfa = r.cookie;
  o = await post('/api/auth/passkey/options', {}, mfa);
  check('passkey login options', o.json.ok && o.json.options.allowCredentials.length === 1, o.json);
  r = await post('/api/auth/passkey/verify', { response: auth1.get(o.json.options, 'https://evil.example') }, mfa);
  check('passkey assertion for another origin is refused', !r.json.ok, r.json);
  o = await post('/api/auth/passkey/options', {}, mfa);
  r = await post('/api/auth/passkey/verify', { response: auth1.get(o.json.options) }, mfa);
  check('passkey signs in', r.json.ok, r.json);
  check('and opens the setup API', (await rpc('getEventConfig', mfa)).status === 200, null);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 }); mfa = r.cookie;
  o = await post('/api/auth/passkey/options', {}, mfa);
  auth1.setCounter(0);
  r = await post('/api/auth/passkey/verify', { response: auth1.get(o.json.options) }, mfa);
  check('a passkey signature with a rolled-back counter is refused', !r.json.ok, r.json);
  const rogue = makeAuthenticator(rpId, origin);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 }); mfa = r.cookie;
  o = await post('/api/auth/passkey/options', {}, mfa);
  r = await post('/api/auth/passkey/verify', { response: rogue.get(o.json.options) }, mfa);
  check('an unregistered authenticator is refused', !r.json.ok, r.json);
  r = await post('/api/auth/totp/disable', { password: PW1 }, owner);
  check('with a passkey in place the authenticator app can be removed', r.json.ok, r.json);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 });
  check('login now offers passkey and recovery only', r.json.methods.totp === false && r.json.methods.passkey === true, r.json);
  const t2 = await post('/api/auth/totp/begin', {}, owner);
  r = await post('/api/auth/totp/confirm', { code: await codeFor(t2.json.secret) }, owner);
  check('authenticator app enabled again', r.json.ok, r.json);
  const ownerSecret2 = t2.json.secret;
  const pkId = (await post('/api/auth/account', {}, owner)).json.account.passkeyList[0].id;
  r = await post('/api/auth/passkey/remove', { id: pkId, password: PW1 }, owner);
  check('passkey removed (the app remains)', r.json.ok, r.json);

  // ---- 8. email code (SMTP sink) ----
  st = await get('/api/auth/state');
  check('server reports that email works', st.mailEnabled === true, st);
  let since = mails.length;
  r = await post('/api/auth/email/enrol/send', {}, owner);
  const em1 = await mailTo('owner@example.com', since);
  const code1 = (em1.match(/code is (\d{6})/) || [])[1];
  check('email enrolment sends a 6-digit code', r.json.ok && !!code1, em1.slice(0, 300));
  r = await post('/api/auth/email/enrol/send', {}, owner);
  check('codes cannot be requested more than once a minute', !r.json.ok, r.json);
  r = await post('/api/auth/email/enrol/confirm', { code: '000000' }, owner);
  check('wrong email code refused', !r.json.ok, r.json);
  r = await post('/api/auth/email/enrol/confirm', { code: code1 }, owner);
  check('email code enabled', r.json.ok, r.json);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 }); mfa = r.cookie;
  check('login offers the email code', r.json.methods.email === true, r.json);
  since = mails.length;
  r = await post('/api/auth/email/send', {}, mfa);
  const em2 = await mailTo('owner@example.com', since);
  const code2 = (em2.match(/code is (\d{6})/) || [])[1];
  check('login email code sent', r.json.ok && !!code2, em2.slice(0, 200));
  r = await post('/api/auth/verify', { method: 'email', code: code2 }, mfa);
  check('email code signs in', r.json.ok, r.json);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1 }); mfa = r.cookie;
  r = await post('/api/auth/verify', { method: 'email', code: code2 }, mfa);
  check('an old email code is useless in a new session', !r.json.ok, r.json);

  // ---- 9. invitations and roles ----
  since = mails.length;
  r = await rpc('inviteAdminUser', owner, { email: 'staff@example.com', name: 'Staffer', role: 'admin' });
  const inv = r.json.result;
  check('invitation created with a link, and emailed', inv.success && /\/auth\/accept\?token=/.test(inv.link) && inv.mailed === true, inv);
  const invMail = await mailTo('staff@example.com', since);
  check('the invitation email contains the link', invMail.includes(inv.link), invMail.slice(0, 300));
  check('duplicate invitation refused', (await rpc('inviteAdminUser', owner, { email: 'STAFF@example.com', role: 'admin' })).json.result.success === false, null);
  const token = new URL(inv.link).searchParams.get('token');
  check('the invitation page loads', /EbsAuth\.mount/.test(await (await fetch(inv.link)).text()), null);
  check('token info', (await get('/api/auth/token-info?token=' + token)).email === 'staff@example.com', null);
  check('pending account cannot sign in', (await post('/api/auth/login', { email: 'staff@example.com', password: PW2 })).status === 401, null);
  r = await post('/api/auth/accept', { token, name: 'Staffer', password: 'short' });
  check('invitation with a weak password refused', !r.json.ok, r.json);
  r = await post('/api/auth/accept', { token, name: 'Staffer', password: PW2 });
  check('invitation accepted -> must set up 2FA', r.json.ok && r.json.stage === 'enrol', r.json);
  const staffEnrol = r.cookie;
  check('the invitation link works only once', !(await post('/api/auth/accept', { token, name: 'X', password: PW3 })).json.ok, null);
  const sb = await post('/api/auth/totp/begin', {}, staffEnrol);
  r = await post('/api/auth/totp/confirm', { code: await codeFor(sb.json.secret) }, staffEnrol);
  check('staff member enrols the authenticator app', r.json.ok, r.json);
  const staff = staffEnrol; let staffSecret = sb.json.secret;
  check('booking admin can read bookings', (await rpc('getAdminData', staff)).status === 200, null);
  check('booking admin cannot open event setup', (await rpc('getEventConfig', staff)).status === 403, null);
  check('booking admin cannot manage users', (await rpc('listAdminUsers', staff)).status === 403, null);
  check('booking admin cannot invite', (await rpc('inviteAdminUser', staff, { email: 'x@example.com', role: 'setup' })).status === 403, null);
  r = await post('/api/auth/login', { email: 'staff@example.com', password: PW2, mode: 'setup' });
  check('the setup page refuses a booking admin account', r.status === 403, r.json);
  check('users list shows both accounts', (await rpc('listAdminUsers', owner)).json.result.users.length === 2, null);

  // ---- 10. safeguards ----
  const users = (await rpc('listAdminUsers', owner)).json.result.users;
  const ownerId = users.find(u => u.email === 'owner@example.com').id, staffId = users.find(u => u.email === 'staff@example.com').id;
  check('you cannot demote yourself', (await rpc('updateAdminUser', owner, ownerId, { role: 'admin' })).json.result.success === false, null);
  check('you cannot disable yourself', (await rpc('updateAdminUser', owner, ownerId, { disabled: true })).json.result.success === false, null);
  check('you cannot delete yourself', (await rpc('deleteAdminUser', owner, ownerId)).json.result.success === false, null);
  r = await rpc('updateAdminUser', owner, staffId, { role: 'setup' });
  check('promote the staff member to setup', r.json.result.success, r.json);
  check('role change signs the person out', (await rpc('getAdminData', staff)).status === 401, null);
  mfa = (await post('/api/auth/login', { email: 'staff@example.com', password: PW2, mode: 'setup' })).cookie;
  r = await post('/api/auth/verify', { method: 'totp', code: await codeFor(staffSecret) }, mfa);
  check('now the setup page accepts the staff member', r.json.ok && (await rpc('getEventConfig', mfa)).status === 200, r.json);
  const staff2 = mfa;
  r = await rpc('updateAdminUser', staff2, ownerId, { disabled: true });
  check('a second setup user can disable the owner', r.json.result.success, r.json);
  check('(the disabled owner is signed out)', (await rpc('getEventConfig', owner)).status === 401, null);
  r = await rpc('updateAdminUser', staff2, ownerId, { disabled: false });
  check('re-enable the owner', r.json.result.success, r.json);
  r = await post('/api/auth/login', { email: 'owner@example.com', password: PW1, mode: 'setup' });
  r = await post('/api/auth/verify', { method: 'totp', code: await codeFor(ownerSecret2) }, r.cookie);
  check('owner can sign in again', r.json.ok, r.json);
  const o2 = (await post('/api/auth/login', { email: 'owner@example.com', password: PW1, mode: 'setup' })).cookie;
  await post('/api/auth/verify', { method: 'totp', code: await codeFor(ownerSecret2) }, o2);
  check('signed in as setup again', (await rpc('getEventConfig', o2)).status === 200, null);
  r = await rpc('updateAdminUser', o2, staffId, { disabled: true });
  check('disable an account', r.json.result.success, r.json);
  check('disabling signs the person out', (await rpc('getAdminData', staff2)).status === 401, null);
  check('a disabled account cannot sign in', (await post('/api/auth/login', { email: 'staff@example.com', password: PW2 })).status === 401, null);
  await rpc('updateAdminUser', o2, staffId, { disabled: false });

  // ---- 11. lost phone: reset 2FA ----
  r = await rpc('resetAdminTwoFactor', o2, staffId);
  check('2FA reset by a setup user', r.json.result.success, r.json);
  r = await post('/api/auth/login', { email: 'staff@example.com', password: PW2 });
  check('after the reset the person must enrol again', r.json.stage === 'enrol', r.json);
  const sb2 = await post('/api/auth/totp/begin', {}, r.cookie);
  staffSecret = sb2.json.secret;
  r = await post('/api/auth/totp/confirm', { code: await codeFor(staffSecret) }, r.cookie);
  check('new authenticator accepted', r.json.ok && r.json.recoveryCodes.length === 10, r.json);

  // ---- 12. password reset by email, password change ----
  since = mails.length;
  r = await post('/api/auth/forgot', { email: 'staff@example.com' });
  const rm = await mailTo('staff@example.com', since);
  const rtoken = (rm.match(/token=([A-Za-z0-9_-]+)/) || [])[1];
  check('reset link emailed', r.json.ok && !!rtoken, rm.slice(0, 200));
  const before = mails.length;
  r = await post('/api/auth/forgot', { email: 'ghost@example.com' });
  await sleep(500);
  check('unknown email: same answer, no mail', r.json.ok && mails.length === before, null);
  r = await post('/api/auth/accept', { token: rtoken, password: PW3 });
  check('reset link sets a new password and still demands 2FA', r.json.ok && r.json.stage === 'mfa', r.json);
  check('the old password no longer works', (await post('/api/auth/login', { email: 'staff@example.com', password: PW2 })).status === 401, null);
  check('a reset link works only once', !(await post('/api/auth/accept', { token: rtoken, password: PW1 })).json.ok, null);
  r = await post('/api/auth/password/change', { current: 'wrong', next: PW2 }, o2);
  check('password change needs the current password', !r.json.ok, r.json);
  const other = (await post('/api/auth/login', { email: 'owner@example.com', password: PW1 })).cookie;
  await post('/api/auth/verify', { method: 'recovery', code: recovery[2] }, other);
  check('second owner session is signed in', (await rpc('getEventConfig', other)).status === 200, null);
  r = await post('/api/auth/password/change', { current: PW1, next: PW3 }, o2);
  check('password changed', r.json.ok, r.json);
  check('password change signs out the other sessions', (await rpc('getEventConfig', other)).status === 401, null);
  check('but keeps this one', (await rpc('getEventConfig', o2)).status === 200, null);

  // ---- 13. lockouts ----
  for (let i = 0; i < 5; i++) await post('/api/auth/login', { email: 'staff@example.com', password: 'wrong-wrong-wrong-1' });
  r = await post('/api/auth/login', { email: 'staff@example.com', password: PW3 });
  check('5 wrong passwords lock the account for a while (even with the right one)', r.status === 401 && /locked|Too many/.test(r.json.error), r.json);
  let tooMany = 0;
  for (let i = 0; i < 60; i++) { const x = await post('/api/auth/login', { email: 'nobody' + i + '@example.com', password: 'wrong-wrong-wrong-1' }); if (x.status === 429) tooMany++; }
  check('too many failures from one address are throttled', tooMany > 0, tooMany);

  sink.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
