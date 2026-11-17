'use strict';
// Public demo mode (DEMO_MODE=1): a sandbox that visitors may try and break.
//  - a banner on every page says it is a demo (and shows the demo passwords, which are public by design)
//  - the database is wiped and re-seeded with the fictional demo event nightly, after a period without activity,
//    and at the latest DEMO_MAX_DIRTY_HOURS after the first change
//  - guards against abuse: booking cap, per-IP request limit, no search-engine indexing, CSP that blocks third-party content
// Email is never sent (leave SMTP_HOST empty). Settings, all optional:
//   DEMO_RESET_HOUR=3 DEMO_IDLE_MINUTES=30 DEMO_MAX_DIRTY_HOURS=6 DEMO_MAX_BOOKINGS=200 DEMO_RATE_PER_MINUTE=120
const db = require('./db');
const eventConfig = require('./eventConfig');
const rooms = require('./rooms');
const structure = require('./structure');
const currency = require('./currency');
const i18n = require('./i18n');

const enabled = process.env.DEMO_MODE === '1';
const num = (k, d) => { const v = parseFloat(process.env[k] || ''); return Number.isFinite(v) && v > 0 ? v : d; };
const opt = {
  hour: Math.min(23, Math.floor(num('DEMO_RESET_HOUR', 3))),
  idleMs: num('DEMO_IDLE_MINUTES', 30) * 60000,
  maxDirtyMs: num('DEMO_MAX_DIRTY_HOURS', 6) * 3600000,
  maxBookings: Math.floor(num('DEMO_MAX_BOOKINGS', 200)),
  perMinute: Math.floor(num('DEMO_RATE_PER_MINUTE', 120)),
  tickMs: num('DEMO_TICK_SECONDS', 30) * 1000,
};

let lastActivity = Date.now();
let dirtySince = 0;
let resetting = false;
let lastNightly = '';
let timer = null;

const WRITE = /^(save|submit|update|change|erase|shutdown|recalc|fetch)/i;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function bannerHtml() {
  const admin = process.env.ADMIN_PASSWORD || '', setup = process.env.SETUP_PASSWORD || admin;
  return '<div id="demo-banner" style="position:sticky;top:0;z-index:99999;background:#fde68a;color:#1f2937;border-bottom:2px solid #d97706;'
    + 'padding:0.45rem 0.8rem;font:13px/1.4 system-ui,sans-serif;text-align:center">'
    + '<strong>Public demo.</strong> Break things freely: everything is wiped automatically (nightly and when nobody is using it). '
    + 'Fictional data only, please. No real names or addresses. No email is sent. '
    + 'Booking admin: <a href="/?admin=1" style="color:#92400e">/?admin=1</a> (password <code>' + esc(admin) + '</code>) &middot; '
    + 'Event setup: <a href="/?setup=1" style="color:#92400e">/?setup=1</a> (password <code>' + esc(setup) + '</code>) &middot; '
    + '<a href="https://github.com/OH2LAK/event-booking-system" style="color:#92400e">Source code</a></div>';
}

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
  + "font-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'";

const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();

function middleware(req, res, next) {
  if (!enabled) return next();
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Content-Security-Policy', CSP);
  if (req.path === '/healthz') return next();
  if (resetting) {
    res.set('Retry-After', '5');
    return res.status(503).type('html').send('<p style="font:16px system-ui;padding:2rem">The demo is resetting. Please reload in a few seconds.</p>');
  }
  lastActivity = Date.now();
  if (req.method === 'POST') {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > opt.perMinute) return res.status(429).json({ error: 'Too many requests, slow down a little' });
    const m = /^\/api\/rpc\/([A-Za-z]+)$/.exec(req.path);
    if ((m && WRITE.test(m[1])) || req.path.startsWith('/report')) markDirty();
  }
  const send = res.send.bind(res);
  res.send = body => {
    if (typeof body === 'string' && /text\/html/i.test(String(res.get('Content-Type') || '')) && /<body[^>]*>/i.test(body)) {
      body = body.replace(/<body[^>]*>/i, m => m + bannerHtml());
    }
    return send(body);
  };
  next();
}

function markDirty() { if (!dirtySince) dirtySince = Date.now(); }

// Called before a booking is accepted. Returns an error text when the demo is full.
async function bookingCapError() {
  if (!enabled) return '';
  const n = (await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n;
  return n >= opt.maxBookings ? 'The demo is full for now. It resets automatically, please try again later.' : '';
}

// Empty every table, reload the in-memory caches and create the fictional demo event again.
async function reset() {
  if (resetting) return;
  resetting = true;
  try {
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows.map(r => '"' + r.tablename + '"');
    await db.withBookingLock(client => client.query('TRUNCATE TABLE ' + tables.join(', ') + ' RESTART IDENTITY CASCADE'));
    await i18n.load(); await eventConfig.load(); await currency.load(); await rooms.load(); await structure.load();
    await require('./demoData').seed();
    dirtySince = 0;
    console.log('[demo] reset done ' + new Date().toISOString());
  } catch (e) {
    console.error('[demo] reset failed', e);
  } finally {
    resetting = false;
    lastActivity = Date.now();
  }
}

async function tick() {
  if (resetting) return;
  const now = new Date();
  const today = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
  if (now.getHours() === opt.hour && lastNightly !== today) { lastNightly = today; return reset(); }
  if (!dirtySince) return;
  if (Date.now() - lastActivity > opt.idleMs || Date.now() - dirtySince > opt.maxDirtyMs) return reset();
}

// Start the scheduler; seeds the demo on the first start when the database is empty.
async function start() {
  if (!enabled) return;
  if (!eventConfig.isConfigured()) await reset();
  timer = setInterval(() => { tick().catch(e => console.error('[demo] tick failed', e)); }, opt.tickMs);
  timer.unref();
  console.log('[demo] demo mode on: nightly reset at ' + opt.hour + ':00, idle reset after ' + opt.idleMs / 60000 + ' min');
}

module.exports = { enabled, middleware, bannerHtml, bookingCapError, markDirty, reset, start };
