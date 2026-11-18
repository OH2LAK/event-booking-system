'use strict';
// API keys. A key looks like ebk_<random>; only its SHA-256 hash is stored, so a lost key cannot be recovered, only replaced.
const crypto = require('crypto');
const db = require('./db');
const demo = require('./demo');
const { CONFIG } = require('./config');

const SCOPES = ['stats', 'bookings:read', 'bookings:write'];
const hash = k => crypto.createHash('sha256').update(String(k)).digest('hex');
const enabled = () => String(CONFIG.API_ENABLED) === 'yes' && !demo.enabled;
const hasScope = (key, scope) => key.scopes.includes(scope) || (scope === 'stats' && key.scopes.includes('bookings:read'));

const publicKey = r => ({
  id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes.split(',').filter(Boolean),
  createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at, requests: Number(r.request_count), revokedAt: r.revoked_at,
});

async function list() {
  return { success: true, enabled: enabled(), keys: (await db.query('SELECT * FROM api_keys ORDER BY id DESC')).rows.map(publicKey) };
}

async function create(name, scopes, expiresDays) {
  name = String(name || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 60) return { success: false, error: 'Give the key a name (max 60 characters), e.g. the system that will use it.' };
  scopes = Array.from(new Set((Array.isArray(scopes) ? scopes : []).map(String)));
  if (!scopes.length || scopes.some(s => !SCOPES.includes(s))) return { success: false, error: 'Choose at least one permission.' };
  const days = parseInt(expiresDays, 10);
  if (expiresDays !== undefined && expiresDays !== '' && expiresDays !== null && !(days >= 1 && days <= 3650)) return { success: false, error: 'Validity must be 1-3650 days (or empty for no expiry).' };
  if ((await db.query('SELECT count(*)::int AS n FROM api_keys WHERE revoked_at IS NULL')).rows[0].n >= 50) return { success: false, error: 'Too many active keys (max 50). Revoke unused ones first.' };
  const key = 'ebk_' + crypto.randomBytes(32).toString('base64url');
  const r = await db.query(
    `INSERT INTO api_keys (name, prefix, key_hash, scopes, expires_at) VALUES ($1,$2,$3,$4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + ($5::int * interval '1 day') END) RETURNING *`,
    [name, key.slice(0, 10), hash(key), scopes.join(','), days >= 1 ? days : null]);
  await db.logEvent('OK', 'api_key_created', '', `key=${name} scopes=${scopes.join(',')}`);
  return { success: true, key, record: publicKey(r.rows[0]) };
}

async function revoke(id) {
  const r = await db.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING name', [parseInt(id, 10) || 0]);
  if (!r.rows.length) return { success: false, error: 'Key not found or already revoked.' };
  await db.logEvent('OK', 'api_key_revoked', '', `key=${r.rows[0].name}`);
  return { success: true };
}

// Looks up the key in an "Authorization: Bearer ..." header. Returns the key record or null.
async function authenticate(header) {
  const m = /^Bearer\s+(ebk_[A-Za-z0-9_-]{20,80})$/.exec(String(header || '').trim());
  if (!m) return null;
  const r = await db.query(
    `UPDATE api_keys SET last_used_at = now(), request_count = request_count + 1
      WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) RETURNING *`, [hash(m[1])]);
  if (!r.rows.length) return null;
  const k = r.rows[0];
  return { id: k.id, name: k.name, scopes: k.scopes.split(',').filter(Boolean) };
}

// Simple in-memory limiters: requests per key per minute, failed logins per address
const perKey = new Map(); const failures = new Map();
function rateLimited(keyId, limit) {
  const now = Date.now(); const minute = Math.floor(now / 60000);
  const e = perKey.get(keyId);
  if (!e || e.minute !== minute) { perKey.set(keyId, { minute, n: 1 }); return false; }
  e.n++;
  return e.n > limit;
}
function tooManyFailures(ip) {
  const now = Date.now();
  const l = (failures.get(ip) || []).filter(t => now - t < 15 * 60000);
  failures.set(ip, l);
  return l.length >= 30;
}
function recordFailure(ip) { const l = failures.get(ip) || []; l.push(Date.now()); failures.set(ip, l); }

module.exports = { SCOPES, enabled, hasScope, list, create, revoke, authenticate, rateLimited, tooManyFailures, recordFailure, hash };
