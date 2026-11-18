'use strict';
// Webhooks: signed HTTP calls to other systems when a booking is created, changed, cancelled, paid or erased.
// Deliveries are queued in the database and retried with growing delays, so a short outage at the receiver loses nothing.
// Security: addresses must be https and must not point at private networks (SSRF), redirects are not followed,
// and every request is signed with the webhook's secret (HMAC-SHA256, see docs/API.md).
const crypto = require('crypto');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const db = require('./db');
const { CONFIG } = require('./config');
const model = require('./apiModel');

const EVENTS = ['booking.created', 'booking.updated', 'booking.cancelled', 'booking.paid', 'booking.erased'];
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600]; // after the 6th failed attempt a delivery is given up
const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
// Tests and private installations may call receivers on a local network
const allowPrivate = () => process.env.API_WEBHOOK_ALLOW_PRIVATE === '1';

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return privateIp(mapped[1]);
  return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
}

// dns.lookup that refuses private addresses; the request connects to exactly the address that was checked
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, list) => {
    if (err) return cb(err);
    const ok = allowPrivate() ? list : list.filter(a => !privateIp(a.address));
    if (!ok.length) return cb(new Error('The address points to a private network, which is not allowed'));
    return options && options.all ? cb(null, ok) : cb(null, ok[0].address, ok[0].family);
  });
}

function checkUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (_) { return { error: 'The address must be a full URL such as https://example.com/hook' }; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowPrivate())) return { error: 'The address must start with https://' };
  if (u.username || u.password) return { error: 'Do not put a username or password in the address' };
  if (url.length > 300) return { error: 'The address is too long (max 300 characters)' };
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && privateIp(u.hostname.replace(/^\[|\]$/g, '')) && !allowPrivate()) return { error: 'The address points to a private network, which is not allowed' };
  return { url: u.toString() };
}

function post(url, headers, body, timeoutMs) {
  return new Promise(resolve => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'POST', headers: Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers), lookup: safeLookup, timeout: timeoutMs || 8000 }, res => {
      res.on('data', () => {}); // the answer is not needed, only its status
      res.on('end', () => resolve({ code: res.statusCode }));
      res.on('error', e => resolve({ error: e.message }));
    });
    req.on('timeout', () => { req.destroy(new Error('Timed out')); });
    req.on('error', e => resolve({ error: e.message }));
    req.end(body);
  });
}

const sign = (secret, ts, body) => crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex');

async function send(hook, deliveryId, event, body) {
  const ts = String(Math.floor(Date.now() / 1000));
  const r = await post(hook.url, {
    'Content-Type': 'application/json', 'User-Agent': 'event-booking-system-webhook/1',
    'X-Webhook-Id': deliveryId, 'X-Webhook-Event': event, 'X-Webhook-Timestamp': ts,
    'X-Webhook-Signature': 't=' + ts + ',v1=' + sign(hook.secret, ts, body),
  }, body);
  const ok = !r.error && r.code >= 200 && r.code < 300;
  return { ok, code: r.code || null, error: r.error || (ok ? '' : 'The receiver answered HTTP ' + r.code) };
}

function envelope(id, type, data) {
  return JSON.stringify({ id, type, createdAt: new Date().toISOString(), event: { name: CONFIG.EVENT_SHORT, url: CONFIG.FRIENDLY_URL }, data });
}

// ---- queueing ----
// Call after a booking changed. extra is merged into data (e.g. { changed: [...] }). Never throws.
async function emit(type, ref, extra) {
  try {
    if (!EVENTS.includes(type)) return;
    const hooks = (await db.query('SELECT * FROM webhooks WHERE enabled')).rows.filter(h => h.events.split(',').includes(type));
    if (!hooks.length) return;
    let booking = null;
    if (type !== 'booking.erased') { booking = await model.getBooking(db, ref); if (!booking) return; }
    for (const h of hooks) {
      const data = Object.assign(type === 'booking.erased' ? { ref } : { booking: h.payload === 'minimal' ? model.minimalBooking(booking) : booking }, extra || {});
      const id = crypto.randomUUID();
      await db.query('INSERT INTO webhook_deliveries (id, webhook_id, event, booking_ref, payload) VALUES ($1,$2,$3,$4,$5)', [id, h.id, type, ref, envelope(id, type, data)]);
    }
    setImmediate(() => processDue().catch(() => {}));
  } catch (e) { await db.logEvent('WARN', 'webhook_emit_failed', '', e.message); }
}

let running = false;
async function processDue() {
  if (running) return;
  running = true;
  try {
    // Claim a batch; a claim that is never finished (crash) is simply tried again after two minutes
    const due = (await db.query(
      `UPDATE webhook_deliveries SET next_attempt_at = now() + interval '2 minutes'
        WHERE id IN (SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED)
        RETURNING *`)).rows;
    for (const d of due) {
      const hook = (await db.query('SELECT * FROM webhooks WHERE id = $1', [d.webhook_id])).rows[0];
      if (!hook || !hook.enabled || !d.payload) { await db.query("UPDATE webhook_deliveries SET status='failed', last_error=$2, finished_at=now(), payload=NULL WHERE id=$1", [d.id, 'Webhook disabled or removed']); continue; }
      const res = await send(hook, d.id, d.event, d.payload);
      const attempts = d.attempts + 1;
      if (res.ok) {
        await db.query("UPDATE webhook_deliveries SET status='ok', attempts=$2, last_code=$3, last_error='', finished_at=now(), payload=NULL WHERE id=$1", [d.id, attempts, res.code]);
        await db.query("UPDATE webhooks SET failures=0, last_status=$2, last_at=now() WHERE id=$1", [hook.id, 'OK (HTTP ' + res.code + ')']);
      } else {
        const giveUp = attempts >= MAX_ATTEMPTS;
        await db.query(
          `UPDATE webhook_deliveries SET attempts=$2, last_code=$3, last_error=$4, status=$5, finished_at=$6,
             next_attempt_at = now() + ($7::int * interval '1 second') WHERE id=$1`,
          [d.id, attempts, res.code, String(res.error).slice(0, 300), giveUp ? 'failed' : 'pending', giveUp ? new Date() : null, BACKOFF_SECONDS[attempts - 1] || 21600]);
        await db.query("UPDATE webhooks SET failures=failures+1, last_status=$2, last_at=now() WHERE id=$1", [hook.id, String(res.error).slice(0, 120)]);
      }
    }
  } finally { running = false; }
}

async function cleanup() {
  await db.query("UPDATE webhook_deliveries SET payload = NULL WHERE status = 'failed' AND payload IS NOT NULL AND finished_at < now() - interval '7 days'");
  await db.query("DELETE FROM webhook_deliveries WHERE finished_at < now() - interval '30 days'");
  await db.query("DELETE FROM api_idempotency WHERE created_at < now() - interval '24 hours'");
}

let timers = [];
function start() {
  stop();
  timers = [setInterval(() => processDue().catch(() => {}), 15000), setInterval(() => cleanup().catch(() => {}), 3600000)];
  timers.forEach(t => t.unref && t.unref());
  setImmediate(() => { cleanup().catch(() => {}); processDue().catch(() => {}); });
}
function stop() { timers.forEach(clearInterval); timers = []; }

// ---- management (setup page) ----
const newSecret = () => 'whsec_' + crypto.randomBytes(24).toString('base64url');
const publicHook = r => ({
  id: r.id, name: r.name, url: r.url, events: r.events.split(',').filter(Boolean), payload: r.payload, enabled: r.enabled,
  createdAt: r.created_at, lastStatus: r.last_status, lastAt: r.last_at, failures: r.failures,
});

function validateHook(input, forUpdate) {
  const name = String(input.name == null ? '' : input.name).replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 60) return { error: 'Give the webhook a name (max 60 characters).' };
  const u = checkUrl(input.url);
  if (u.error) return u;
  const events = Array.from(new Set(Array.isArray(input.events) ? input.events.map(String) : EVENTS));
  if (!events.length || events.some(e => !EVENTS.includes(e))) return { error: 'Choose at least one event.' };
  const payload = input.payload === 'minimal' ? 'minimal' : 'full';
  return { name, url: u.url, events, payload, enabled: forUpdate && input.enabled === false ? false : true };
}

async function list() {
  const hooks = (await db.query('SELECT * FROM webhooks ORDER BY id')).rows.map(publicHook);
  const pend = (await db.query("SELECT webhook_id, count(*)::int AS n FROM webhook_deliveries WHERE status='pending' GROUP BY webhook_id")).rows;
  hooks.forEach(h => { h.pending = (pend.find(p => p.webhook_id === h.id) || { n: 0 }).n; });
  return { success: true, hooks, events: EVENTS };
}

async function create(input) {
  const v = validateHook(input || {}, false);
  if (v.error) return { success: false, error: v.error };
  if ((await db.query('SELECT count(*)::int AS n FROM webhooks')).rows[0].n >= 20) return { success: false, error: 'Too many webhooks (max 20).' };
  const secret = newSecret();
  const r = await db.query('INSERT INTO webhooks (name, url, secret, events, payload) VALUES ($1,$2,$3,$4,$5) RETURNING *', [v.name, v.url, secret, v.events.join(','), v.payload]);
  await db.logEvent('OK', 'webhook_created', '', `webhook=${v.name}`);
  return { success: true, secret, hook: publicHook(r.rows[0]) };
}

async function update(id, input) {
  input = input || {};
  const v = validateHook(input, true);
  if (v.error) return { success: false, error: v.error };
  const secret = input.rotateSecret ? newSecret() : null;
  const r = await db.query(
    `UPDATE webhooks SET name=$2, url=$3, events=$4, payload=$5, enabled=$6, secret=COALESCE($7, secret), failures = CASE WHEN $6 THEN failures ELSE 0 END WHERE id=$1 RETURNING *`,
    [parseInt(id, 10) || 0, v.name, v.url, v.events.join(','), v.payload, v.enabled, secret]);
  if (!r.rows.length) return { success: false, error: 'Webhook not found.' };
  return { success: true, secret, hook: publicHook(r.rows[0]) };
}

async function remove(id) {
  const r = await db.query('DELETE FROM webhooks WHERE id = $1 RETURNING name', [parseInt(id, 10) || 0]);
  if (!r.rows.length) return { success: false, error: 'Webhook not found.' };
  await db.logEvent('OK', 'webhook_deleted', '', `webhook=${r.rows[0].name}`);
  return { success: true };
}

// Sends a test event right away and reports what the receiver answered
async function test(id) {
  const hook = (await db.query('SELECT * FROM webhooks WHERE id = $1', [parseInt(id, 10) || 0])).rows[0];
  if (!hook) return { success: false, error: 'Webhook not found.' };
  const deliveryId = crypto.randomUUID();
  const res = await send(hook, deliveryId, 'webhook.test', envelope(deliveryId, 'webhook.test', { message: 'This is a test event from the booking system.' }));
  return { success: true, ok: res.ok, code: res.code, error: res.error };
}

async function deliveries(webhookId) {
  const r = await db.query(
    `SELECT id, event, booking_ref, status, attempts, last_code, last_error, created_at, finished_at, next_attempt_at FROM webhook_deliveries
      WHERE ($1::int IS NULL OR webhook_id = $1) ORDER BY created_at DESC LIMIT 25`, [parseInt(webhookId, 10) || null]);
  return { success: true, deliveries: r.rows };
}

// Removes queued personal data (used when a booking is erased or the event is shut down)
async function purge(ref) {
  if (ref) await db.query('DELETE FROM webhook_deliveries WHERE booking_ref = $1', [ref]);
  else await db.query('DELETE FROM webhook_deliveries');
}

module.exports = { EVENTS, privateIp, post, emit, processDue, start, stop, sign, checkUrl, list, create, update, remove, test, deliveries, purge, cleanup };
