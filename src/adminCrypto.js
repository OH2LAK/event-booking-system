'use strict';
// Crypto helpers for admin accounts: password hashing (scrypt), TOTP (RFC 6238), recovery codes, secret encryption.
// No third-party code: Node's crypto only.
const crypto = require('crypto');

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// ---- Passwords ----
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };
function scrypt(pw, salt, o) {
  return new Promise((resolve, reject) => crypto.scrypt(pw, salt, o.keylen, { N: o.N, r: o.r, p: o.p, maxmem: o.maxmem }, (e, k) => e ? reject(e) : resolve(k)));
}
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw), salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, key] = parts;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(String(pw), Buffer.from(salt, 'base64'), { N: +N, r: +r, p: +p, keylen: want.length, maxmem: SCRYPT.maxmem });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const COMMON = new Set(['password', 'passw0rd', 'password1', 'qwerty', '123456', '12345678', 'letmein', 'admin', 'changeme', 'iloveyou', 'welcome']);
// Returns an error message or '' when the password is acceptable.
function passwordProblem(pw, email) {
  const p = String(pw || '');
  if (p.length < 12) return 'The password must be at least 12 characters long.';
  if (p.length > 200) return 'The password is too long (max 200 characters).';
  const low = p.toLowerCase();
  if ([...COMMON].some(c => low.includes(c))) return 'The password is too easy to guess.';
  if (/^(.)\1+$/.test(p)) return 'The password is too easy to guess.';
  if (email && low.includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length >= 4) return 'The password must not contain your email name.';
  if (new Set(p).size < 5) return 'The password is too easy to guess.';
  return '';
}

// ---- Encrypting the TOTP secret at rest (key derived from SESSION_SECRET) ----
function key() { return crypto.createHash('sha256').update('ebs-totp|' + (process.env.SESSION_SECRET || 'change-me-session-secret')).digest(); }
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}
function decrypt(blob) {
  const [v, iv, tag, enc] = String(blob || '').split('.');
  if (v !== 'v1' || !iv || !tag || !enc) return '';
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
  } catch (_) { return ''; }
}

// ---- TOTP (SHA-1, 6 digits, 30 s: compatible with Google/Microsoft Authenticator, Aegis, 1Password ...) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function unbase32(s) {
  let bits = '';
  for (const ch of String(s).replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) return Buffer.alloc(0); bits += i.toString(2).padStart(5, '0'); }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
const newTotpSecret = () => base32(crypto.randomBytes(20));
function hotp(secretB32, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unbase32(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}
const totpAt = (secretB32, t) => hotp(secretB32, Math.floor(t / 30000));
// Returns the matching 30-second step number (so the caller can refuse replays) or 0.
function totpVerify(secretB32, code, now = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c) || !secretB32) return 0;
  const step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) {
    const exp = hotp(secretB32, step + d);
    if (crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(c))) return step + d;
  }
  return 0;
}
const otpauthUri = (secretB32, email, issuer) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---- Recovery codes: 10 single-use codes like "k3f9a-72bqx" ----
const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function newRecoveryCodes(n = 10) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = '';
    for (const b of crypto.randomBytes(10)) s += RC_ALPHABET[b % RC_ALPHABET.length];
    out.push(s.slice(0, 5) + '-' + s.slice(5));
  }
  return out;
}
const normaliseRecovery = c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecovery = c => sha256('rc|' + normaliseRecovery(c));

// ---- Email one-time code (6 digits) ----
const newEmailCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = { sha256, randomToken, hashPassword, verifyPassword, passwordProblem, encrypt, decrypt, newTotpSecret, totpVerify, totpAt, otpauthUri,
  newRecoveryCodes, hashRecovery, normaliseRecovery, newEmailCode, safeEq };
