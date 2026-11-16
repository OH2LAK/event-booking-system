'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const service = require('./service');
const pages = require('./pages');
const reportRoutes = require('./reportRoutes');
const { getSettings } = require('./settings');
const eventConfig = require('./eventConfig');
const rooms = require('./rooms');
const structure = require('./structure');
const { CONFIG } = require('./config');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const secureCookies = (process.env.PUBLIC_URL || '').startsWith('https://');

function notConfiguredPage() {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>Booking not available yet</title><style>body{font-family:system-ui,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}'
    + '.box{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:2rem;max-width:420px;text-align:center}</style></head>'
    + '<body><div class="box"><h1 style="font-size:1.2rem">Booking is not open yet</h1>'
    + '<p style="color:#57606a">This booking site has not been set up. Please check back later.</p></div></body></html>';
}

// ---- pages (same URL scheme as the Apps Script version) ----
app.get('/', async (req, res, next) => {
  try {
    const settings = await getSettings();
    let html;
    if (req.query.admin !== '1' && !eventConfig.isConfigured()) return res.type('html').send(notConfiguredPage());
    if (req.query.admin === '1') html = pages.buildAdminPage(settings);
    else if (req.query.public === '1') html = pages.buildPublicPage();
    else html = pages.buildBookingPage(String(req.query.join || ''), String(req.query.bypass || ''), settings);
    res.type('html').send(html.replace(/--accent:\s*#b45309/g, '--accent:' + CONFIG.ACCENT_COLOR));
  } catch (e) { next(e); }
});
app.get('/healthz', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ ok: true }); } catch (e) { res.status(503).json({ ok: false }); }
});

app.use(reportRoutes);

// ---- RPC: replaces google.script.run ----
const PUBLIC = {
  getAvailability: () => service.getAvailability(),
  getPublicGuestList: () => service.getPublicGuestList(),
  submitBooking: data => service.submitBooking(data),
};
// Admin methods: the first argument (the old password parameter) is ignored; the session cookie is the credential.
const ADMIN = {
  getEventConfig: () => ({ success: true, configured: eventConfig.isConfigured(), fields: eventConfig.FIELDS, values: eventConfig.current() }),
  saveEventConfig: values => eventConfig.save(values),
  getRoomCatalog: () => ({ success: true, rooms: CONFIG.ROOMS }),
  saveRoomCatalog: list => rooms.save(list),
  getStructure: () => ({ success: true, structure: CONFIG.STRUCTURE }),
  saveStructure: input => structure.save(input),
  getAdminPanelHtml: () => {
    const html = '<div id="event-setup"></div><div id="event-structure"></div><div id="room-catalog"></div>' + pages.getAdminPanelHtml();
    const warn = auth.usingDefaults();
    if (!warn.length) return html;
    const banner = '<div style="background:#b91c1c;color:#fff;padding:0.75rem 1rem;font-weight:600;font-family:sans-serif">'
      + 'Security warning: default values are still in use for ' + warn.join(', ')
      + '. Change them in .env and restart the app before exposing it to the internet.</div>';
    return banner + html;
  },
  getAdminData: () => service.getAdminData(),
  updateBooking: (_pw, ref, fields, sendEmail) => service.updateBooking(ref, fields, sendEmail),
  changeAccommodation: (_pw, ref, params) => service.changeAccommodation(ref, params),
  changeRole: (_pw, ref, params) => service.changeRole(ref, params),
  recalcAllPrices: () => service.recalcAllPrices(),
  getAdminSettings: () => service.getAdminSettings(),
  saveAdminSettings: (_pw, settings) => service.saveAdminSettings(settings),
};

app.post('/api/rpc/:method', async (req, res) => {
  const method = req.params.method;
  const args = Array.isArray(req.body && req.body.args) ? req.body.args : [];
  try {
    if (method === 'checkAdminPassword') {
      if (auth.throttled(req.ip)) return res.status(429).json({ error: 'Too many attempts, try again later' });
      const ok = auth.checkPassword(args[0]);
      if (ok) { auth.clearFailures(req.ip); res.set('Set-Cookie', auth.makeCookie(secureCookies)); }
      else auth.recordFailure(req.ip);
      return res.json({ result: ok });
    }
    if (Object.prototype.hasOwnProperty.call(PUBLIC, method)) return res.json({ result: await PUBLIC[method](...args) });
    if (Object.prototype.hasOwnProperty.call(ADMIN, method)) {
      if (!auth.isAdmin(req)) return res.status(401).json({ error: 'Not logged in' });
      return res.json({ result: await ADMIN[method](...args) });
    }
    return res.status(404).json({ error: 'Unknown method' });
  } catch (e) {
    console.error('RPC error', method, e);
    return res.status(500).json({ error: 'Server error' });
  }
});
app.post('/api/admin/logout', (req, res) => { res.set('Set-Cookie', auth.clearCookie()); res.json({ ok: true }); });

app.use((err, req, res, _next) => { console.error(err); res.status(500).send('Server error'); });

async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  for (let i = 0; i < 30; i++) {
    try { await db.query(sql); return; }
    catch (e) { if (i === 29) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  await initDb();
  await eventConfig.load();
  await rooms.load();
  await structure.load();
  const warn = auth.usingDefaults();
  if (warn.length) {
    console.warn('\n!!! SECURITY WARNING !!!\nDefault values are still in use for: ' + warn.join(', ')
      + '\nChange them in .env and restart before exposing this app to the internet.\n');
  }
  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, () => console.log('Event booking system listening on :' + port));
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { app, initDb };
