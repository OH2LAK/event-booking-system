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
const addons = require('./addons');
const gdpr = require('./gdpr');
const privacy = require('./privacy');
const i18n = require('./i18n');
const currency = require('./currency');
const demo = require('./demo');
const api = require('./api');
const apiKeys = require('./apiKeys');
const webhooks = require('./webhooks');
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
app.use(demo.middleware);
app.use(express.static(path.join(__dirname, '..', 'public')));
// Everything below serves personal data or admin functions: never cache it in browsers or shared proxies
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const secureCookies = (process.env.PUBLIC_URL || '').startsWith('https://');

function notConfiguredPage() {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>Booking not available yet</title><style>body{font-family:system-ui,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}'
    + '.box{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:2rem;max-width:420px;text-align:center}</style></head>'
    + '<body><div class="box"><h1 style="font-size:1.2rem">Booking is not open yet</h1>'
    + '<p style="color:#57606a">This booking site has not been set up. Please check back later.</p></div></body></html>';
}

// ---- pages ----
app.get('/', async (req, res, next) => {
  try {
    const settings = await getSettings();
    const lang = i18n.pickLang(req);
    let html;
    const staff = req.query.admin === '1' || req.query.setup === '1';
    if (!staff && !eventConfig.isConfigured()) return res.type('html').send(notConfiguredPage());
    if (staff) { res.set('X-Frame-Options', 'DENY'); html = pages.buildAdminPage(settings, req.query.setup === '1' ? 'setup' : 'admin'); }
    else if (req.query.public === '1') html = pages.buildPublicPage(lang, i18n.switcher(lang, req));
    else html = pages.buildBookingPage(String(req.query.join || ''), String(req.query.bypass || ''), settings, lang, i18n.switcher(lang, req));
    html = html.replace(/--accent:\s*#b45309/g, '--accent:' + CONFIG.ACCENT_COLOR);
    // Hidden easter egg: optional pIqaD script toggle for Klingon (needs public/fonts/piqad.woff2)
    if (lang === 'tlh' && !staff) html = html.replace('</body>', '<script src="/piqad.js"></script></body>');
    res.type('html').send(html);
  } catch (e) { next(e); }
});
app.get('/privacy', (req, res) => {
  if (!eventConfig.isConfigured()) return res.type('html').send(notConfiguredPage());
  const lang = i18n.pickLang(req);
  res.type('html').send(privacy.noticePage(lang, i18n.switcher(lang, req)).replace(/--accent:\s*#b45309/g, '--accent:' + CONFIG.ACCENT_COLOR));
});
app.get('/healthz', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ ok: true }); } catch (e) { res.status(503).json({ ok: false }); }
});

app.use(reportRoutes);
// Public REST API for other systems (needs an API key; see docs/API.md)
app.use('/api/v1', api.router);

// ---- RPC: the pages call these methods through /api/rpc/<method> ----
const PUBLIC = {
  getAvailability: () => service.getAvailability(),
  getPublicGuestList: () => service.getPublicGuestList(),
  submitBooking: async data => {
    const full = await demo.bookingCapError();
    return full ? { success: false, error: full } : service.submitBooking(data);
  },
};
// Admin methods: a leading unused first argument is ignored; the session cookie is the credential.
// Methods that need the setup role (they change how the event is configured or can destroy data).
// Everything else in ADMIN is available to both roles.
const SETUP_ONLY = new Set(['getEventConfig', 'saveEventConfig', 'getCurrencies', 'saveCurrencyRates', 'fetchCurrencyRates',
  'saveRoomCatalog', 'saveStructure', 'getAddons', 'saveAddons', 'getTranslations', 'saveTranslations', 'getShutdownPreview', 'shutdownEvent', 'recalcAllPrices',
  'getApiOverview', 'createApiKey', 'revokeApiKey', 'createWebhook', 'updateWebhook', 'deleteWebhook', 'testWebhook', 'getWebhookDeliveries']);
// Registration settings that the admin role may change; every other setting (prices, inventory) needs the setup role.
const ADMIN_SETTING_KEYS = new Set(['REGISTRATION_OPEN', 'REGISTRATION_CLOSES', 'ALLOW_SOLO_DOUBLE', 'ALLOW_SINGLE_BED_BOOKING', 'TENT_ENABLED',
  'ANNOUNCEMENT', 'CLOSED_MESSAGE', 'BYPASS_TOKEN', 'CAMPER_INFO', 'TENT_INFO', 'PRICE_DISCLAIMER']);
const ADMIN = {
  getEventConfig: () => ({ success: true, configured: eventConfig.isConfigured(), fields: eventConfig.FIELDS, values: eventConfig.current() }),
  saveEventConfig: values => eventConfig.save(values),
  getCurrencies: () => currency.adminView(),
  saveCurrencyRates: list => currency.saveRates(list),
  fetchCurrencyRates: () => currency.fetchEcb(),
  getRoomCatalog: () => ({ success: true, rooms: CONFIG.ROOMS }),
  saveRoomCatalog: list => rooms.save(list),
  getAddons: () => ({ success: true, addons: CONFIG.ADDONS }),
  saveAddons: list => addons.save(list),
  getStructure: () => ({ success: true, structure: CONFIG.STRUCTURE }),
  saveStructure: input => structure.save(input),
  getApiOverview: async () => Object.assign(await apiKeys.list(), { scopes: apiKeys.SCOPES, baseUrl: CONFIG.FRIENDLY_URL.replace(/\/+$/, '') + '/api/v1' }, { webhooks: await webhooks.list() }),
  createApiKey: (name, scopes, days) => apiKeys.create(name, scopes, days),
  revokeApiKey: id => apiKeys.revoke(id),
  createWebhook: input => webhooks.create(input),
  updateWebhook: (id, input) => webhooks.update(id, input),
  deleteWebhook: id => webhooks.remove(id),
  testWebhook: id => webhooks.test(id),
  getWebhookDeliveries: id => webhooks.deliveries(id),
  exportBooking: ref => gdpr.exportBooking(ref),
  eraseBooking: (ref, opts) => gdpr.eraseBooking(ref, opts),
  getTranslations: async lang => i18n.getTranslations(String(lang || '') || (i18n.enabledCodes().find(c => c !== i18n.defaultLang()) || i18n.defaultLang()), await getSettings()),
  saveTranslations: (lang, map) => i18n.saveTranslations(String(lang || ''), map),
  getShutdownPreview: () => gdpr.shutdownPreview(),
  shutdownEvent: opts => gdpr.shutdownErase(opts),
  getAdminPanelHtml: (_pw, mode) => {
    const setup = mode === 'setup';
    let html = setup
      ? '<div id="event-setup"></div><div id="currencies"></div><div id="event-structure"></div><div id="room-catalog"></div><div id="addons-card"></div><div id="api-card"></div><div id="event-privacy"></div><div id="translations"></div>' + pages.getSetupPanelHtml()
      : pages.getAdminPanelHtml();
    const rs = privacy.status();
    if (rs.state === 'overdue' || rs.state === 'due_soon') {
      const late = rs.state === 'overdue';
      html = '<div style="background:' + (late ? '#b91c1c' : '#b45309') + ';color:#fff;padding:0.75rem 1rem;font-weight:600;font-family:sans-serif">'
        + (late ? 'Data retention deadline passed on ' + rs.deleteBy + '.' : 'Data retention deadline in ' + rs.daysLeft + ' day(s): ' + rs.deleteBy + '.')
        + (setup
          ? ' Personal data must be erased by then: use "Data protection and event shutdown" below (or set a retention hold in Event setup if a matter is still open).'
          : ' Personal data must be erased by then: ask the event setup administrator to use "Data protection and event shutdown" in Setup.')
        + '</div>' + html;
    }
    if (demo.enabled) html = demo.bannerHtml() + html;
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
      // Second argument 'setup' means the setup page: only the setup password is accepted there.
      let role = auth.checkPassword(args[0]);
      if (args[1] === 'setup' && role !== 'setup') role = null;
      if (role) { auth.clearFailures(req.ip); res.set('Set-Cookie', auth.makeCookie(role, secureCookies)); }
      else auth.recordFailure(req.ip);
      return res.json({ result: !!role });
    }
    if (Object.prototype.hasOwnProperty.call(PUBLIC, method)) return res.json({ result: await PUBLIC[method](...args) });
    if (Object.prototype.hasOwnProperty.call(ADMIN, method)) {
      if (!auth.isAdmin(req)) return res.status(401).json({ error: 'Not logged in' });
      const setupOnly = SETUP_ONLY.has(method) || (method === 'getAdminPanelHtml' && args[1] === 'setup');
      if (setupOnly && !auth.isSetup(req)) return res.status(403).json({ error: 'The setup password is required for this' });
      if (method === 'saveAdminSettings' && !auth.isSetup(req)) {
        const denied = Object.keys(args[1] || {}).filter(k => !ADMIN_SETTING_KEYS.has(k));
        if (denied.length) return res.json({ result: { success: false, error: 'The setup password is required to change: ' + denied.join(', ') } });
      }
      return res.json({ result: await ADMIN[method](...args) });
    }
    return res.status(404).json({ error: 'Unknown method' });
  } catch (e) {
    console.error('RPC error', method, e);
    return res.status(500).json({ error: 'Server error' });
  }
});
app.post('/api/admin/logout', (req, res) => { res.set('Set-Cookie', auth.clearCookie()); res.json({ ok: true }); });

app.use((err, req, res, _next) => {
  if (req.path.startsWith('/api/v1')) {
    // Unreadable or oversized JSON bodies on the API get a JSON answer
    const status = err.status === 413 ? 413 : (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(err);
    const code = status === 413 ? 'too_large' : (status === 400 ? 'invalid_json' : 'server_error');
    return res.status(status).json({ error: { code, message: status === 413 ? 'The request is too large.' : (status === 400 ? 'The request body is not valid JSON.' : 'Server error') } });
  }
  console.error(err); res.status(500).send('Server error');
});

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
  await i18n.load();
  await eventConfig.load();
  await currency.load();
  await rooms.load();
  await structure.load();
  await addons.load();
  await demo.start();
  webhooks.start();
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
