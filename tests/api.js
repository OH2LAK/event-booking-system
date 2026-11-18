'use strict';
// End-to-end test of the public API (/api/v1), API keys and webhooks against a running instance.
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... [SETUP_PASSWORD=...] API_WEBHOOK_ALLOW_PRIVATE=1 (on the server) node tests/api.js
// The webhook tests start a receiver on 127.0.0.1:39555, so the SERVER must run with API_WEBHOOK_ALLOW_PRIVATE=1 (otherwise they are skipped).
// With SMOKE_ALLOW_SHUTDOWN=1 it also checks that an event shutdown revokes keys and disables webhooks (erases ALL data: throwaway database only).
// WARNING: creates test bookings (callsigns starting with TESTAPI) in the target database.
const crypto = require('crypto');
const http = require('http');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PW = process.env.SETUP_PASSWORD || process.env.ADMIN_PASSWORD || '';
let cookie = '';
let failures = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra)));
  if (!cond) failures++;
};
async function rpc(method, ...args) {
  const r = await fetch(`${BASE}/api/rpc/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ args }) });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json() };
}
async function api(method, path, key, body, headers) {
  const h = Object.assign({}, key ? { Authorization: 'Bearer ' + key } : {}, body !== undefined ? { 'Content-Type': 'application/json' } : {}, headers || {});
  const r = await fetch(BASE + '/api/v1' + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = Buffer.from(await r.arrayBuffer()).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
  return { status: r.status, json, text, headers: r.headers };
}
const person = o => Object.assign({ name: 'Api Person', email: 'api-person@example.com', country: 'FI', privacyAck: true }, o);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  check('setup login', (await rpc('checkAdminPassword', PW, 'setup')).body.result === true, null);
  const ec = (await rpc('getEventConfig')).body.result;
  const base = Object.assign({}, ec.values, { EVENT_NAME: 'API Test Event 2027', EVENT_SHORT: 'ApiEvt', ORGANIZER: 'API Club', EVENT_END_DATE: '2099-01-02', RETENTION_HOLD: '' });
  check('the API is off by default', ec.values.API_ENABLED === 'no', ec.values.API_ENABLED);
  await rpc('saveEventConfig', Object.assign({}, base, { API_ENABLED: 'no' }));
  await rpc('saveAdminSettings', '', { REGISTRATION_OPEN: true, TENT_ENABLED: true, TENT_SPOTS: 40 });

  // ---- switched off ----
  let r = await api('GET', '/ping', 'ebk_' + 'a'.repeat(43));
  check('API off: requests are refused with api_disabled', r.status === 403 && r.json.error.code === 'api_disabled', r.text);
  r = await api('GET', '/openapi.json');
  check('openapi.json is public and describes the paths', r.status === 200 && r.json.openapi && r.json.paths['/bookings'] && r.json.paths['/bookings'].post && r.json.paths['/export/bookings.{fmt}'], r.status);
  check('openapi.json has the bearer scheme and no personal data', r.json.components.securitySchemes.bearer && !/example\.com\/|@/.test(JSON.stringify(r.json.paths)), null);

  // ---- keys ----
  r = (await rpc('saveEventConfig', Object.assign({}, base, { API_ENABLED: 'yes' }))).body.result;
  check('API switched on in event setup', r && r.success, r);
  let x = (await rpc('createApiKey', '', ['stats'])).body.result;
  check('key needs a name', !x.success, x);
  x = (await rpc('createApiKey', 'bad', ['everything'])).body.result;
  check('unknown permission rejected', !x.success, x);
  x = (await rpc('createApiKey', 'bad', [])).body.result;
  check('at least one permission needed', !x.success, x);
  x = (await rpc('createApiKey', 'bad', ['stats'], 99999)).body.result;
  check('validity is limited', !x.success, x);
  const mk = async (name, scopes) => { const k = (await rpc('createApiKey', name, scopes)).body.result; return k; };
  const kS = await mk('dashboard', ['stats']);
  const kR = await mk('accounting', ['bookings:read']);
  const kW = await mk('web shop', ['bookings:write']);
  const kRW = await mk('club register', ['bookings:read', 'bookings:write']);
  check('keys are created and shown once', kS.success && /^ebk_[A-Za-z0-9_-]{40,}$/.test(kS.key) && kS.record.scopes[0] === 'stats', kS);
  const ov = (await rpc('getApiOverview')).body.result;
  check('overview lists keys without the key itself', ov.keys.length === 4 && !JSON.stringify(ov).includes(kS.key) && ov.keys.every(k => k.prefix.startsWith('ebk_')) && ov.enabled === true, ov);
  global.__keys = { kS, kR, kW, kRW };

  // ---- authentication and permissions ----
  r = await api('GET', '/ping');
  check('no key: 401', r.status === 401 && r.json.error.code === 'invalid_key' && /Bearer/.test(r.headers.get('www-authenticate') || ''), r.text);
  r = await api('GET', '/ping', 'ebk_' + 'b'.repeat(43));
  check('wrong key: 401', r.status === 401, r.text);
  r = await api('GET', '/ping', kS.key);
  check('valid key: ping', r.status === 200 && r.json.ok && r.json.key === 'dashboard' && r.json.event === 'ApiEvt', r.text);
  r = await api('GET', '/stats', kS.key);
  check('stats key reads statistics', r.status === 200 && r.json.bookings && r.json.payments && r.json.accommodation, r.text);
  r = await api('GET', '/bookings', kS.key);
  check('stats key cannot list bookings', r.status === 403 && r.json.error.code === 'insufficient_scope', r.text);
  r = await api('GET', '/stats', kW.key);
  check('write-only key cannot read statistics', r.status === 403, r.text);
  r = await api('GET', '/stats', kR.key);
  check('bookings:read implies statistics', r.status === 200, r.text);
  r = await api('POST', '/bookings', kR.key, person({ callsign: 'TESTAPI0', type: 'tent' }));
  check('read key cannot create bookings', r.status === 403, r.text);
  r = await api('GET', '/event', kS.key);
  check('event info', r.status === 200 && r.json.shortName === 'ApiEvt' && r.json.currency === 'EUR' && Array.isArray(r.json.days), r.text);

  // ---- create ----
  await rpc('saveAddons', [{ id: 'dinner', name: 'Saturday dinner', price: 25, max_qty: 3, capacity: 4, enabled: true }]);
  r = await api('GET', '/extras', kS.key);
  check('extras catalog with capacity left', r.status === 200 && r.json.data.length === 1 && r.json.data[0].left === 4, r.text);
  const idem = 'order-1001';
  r = await api('POST', '/bookings', kW.key, person({ callsign: 'testapi1', type: 'tent', extras: [{ id: 'dinner', qty: 2 }] }), { 'Idempotency-Key': idem });
  check('create booking: 201 with the booking', r.status === 201 && r.json.ref && r.json.callsign === 'TESTAPI1' && r.json.status === 'CONFIRMED' && r.json.paymentStatus === 'UNPAID' && r.json.extras.length === 1 && r.json.extras[0].qty === 2, r.text);
  const b1 = r.json;
  check('create booking: price includes the extras', b1.totalPrice > 50 && /Saturday dinner/.test(b1.priceBreakdown), b1);
  check('create booking: publishConsent defaults to false', b1.publishConsent === false, b1.publishConsent);
  const again = await api('POST', '/bookings', kW.key, person({ callsign: 'testapi1', type: 'tent', extras: [{ id: 'dinner', qty: 2 }] }), { 'Idempotency-Key': idem });
  check('retry with the same Idempotency-Key replays the first answer', again.status === 201 && again.json.ref === b1.ref && again.headers.get('idempotent-replayed') === 'true', again.text);
  r = await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI9', type: 'tent' }), { 'Idempotency-Key': idem });
  check('same Idempotency-Key with a different body is refused', r.status === 422 && r.json.error.code === 'idempotency_mismatch', r.text);
  r = await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI1', type: 'tent' }));
  check('duplicate callsign: 409 exists', r.status === 409 && r.json.error.code === 'exists', r.text);
  r = await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI3', type: 'tent', extras: [{ id: 'dinner', qty: 3 }] }));
  check('extras capacity enforced: 409', r.status === 409 && r.json.error.code === 'addonFull', r.text);
  r = await api('POST', '/bookings', kW.key, Object.assign(person({ callsign: 'TESTAPI3', type: 'tent' }), { privacyAck: false }));
  check('privacy acknowledgement required: 422', r.status === 422 && r.json.error.code === 'privacy', r.text);
  r = await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI3', type: 'spaceship' }));
  check('unknown type: 422', r.status === 422, r.text);
  r = await api('POST', '/bookings', kW.key, '{ not json');
  check('broken JSON: 400 invalid_json', r.status === 400 && r.json.error.code === 'invalid_json', r.text);
  r = await api('POST', '/bookings', kW.key, '[1,2]');
  check('JSON array instead of object: 400', r.status === 400, r.text);
  r = await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI2', type: 'tent', paymentStatus: 'PAID', sendNotifications: false }));
  check('create as already paid', r.status === 201 && r.json.paymentStatus === 'PAID' && r.json.paidAt, r.text);
  const b2 = r.json;
  r = await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI3', type: 'tent', paymentStatus: 'MAYBE' }));
  check('bad paymentStatus: 422', r.status === 422, r.text);
  // same prices as the booking form
  r = await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI5', type: 'tent', extras: [{ id: 'dinner', qty: 1 }] }));
  const viaForm = (await rpc('submitBooking', person({ callsign: 'TESTAPIF1', type: 'tent', addons: [{ id: 'dinner', qty: 1 }] }))).body.result;
  check('API and form give the same price', r.status === 201 && viaForm.success && viaForm.price.total === r.json.totalPrice, [r.text, viaForm]);

  // ---- read ----
  r = await api('GET', '/bookings?callsign=testapi1', kR.key);
  check('list: filter by callsign', r.status === 200 && r.json.count === 1 && r.json.data[0].ref === b1.ref && r.json.data[0].email === 'api-person@example.com', r.text);
  r = await api('GET', '/bookings?paymentStatus=PAID', kR.key);
  check('list: filter by payment status', r.status === 200 && r.json.data.some(b => b.ref === b2.ref) && r.json.data.every(b => b.paymentStatus === 'PAID'), r.text);
  r = await api('GET', '/bookings?limit=2', kR.key);
  check('list: paging', r.status === 200 && r.json.count === 2 && r.json.nextAfter > 0, r.text);
  const page2 = await api('GET', '/bookings?limit=2&after=' + r.json.nextAfter, kR.key);
  check('list: next page continues', page2.status === 200 && page2.json.count >= 1 && !page2.json.data.some(b => r.json.data.some(a => a.ref === b.ref)), page2.text);
  r = await api('GET', '/bookings?q=testapi', kR.key);
  check('list: search', r.status === 200 && r.json.count >= 3, r.text);
  r = await api('GET', '/bookings?createdSince=garbage', kR.key);
  check('list: bad date: 400', r.status === 400, r.text);
  r = await api('GET', '/bookings/' + encodeURIComponent(b1.ref), kRW.key);
  check('get one booking', r.status === 200 && r.json.ref === b1.ref, r.text);
  r = await api('GET', '/bookings/NOPE-1', kR.key);
  check('get unknown booking: 404', r.status === 404, r.text);
  r = await api('GET', '/nonsense', kR.key);
  check('unknown path: 404 JSON', r.status === 404 && r.json.error.code === 'not_found', r.text);

  // ---- change and cancel ----
  r = await api('PATCH', '/bookings/' + b1.ref, kW.key, { paymentStatus: 'PAID', orgComment: 'Paid by card' });
  check('patch: payment status and comment', r.status === 200 && r.json.paymentStatus === 'PAID' && r.json.paidAt && r.json.orgComment === 'Paid by card', r.text);
  const before = b1.totalPrice;
  r = await api('PATCH', '/bookings/' + b1.ref, kW.key, { extras: [{ id: 'dinner', qty: 1 }] });
  check('patch: extras change recalculates the price', r.status === 200 && r.json.totalPrice === before - 25 && r.json.extras[0].qty === 1, [before, r.text]);
  r = await api('PATCH', '/bookings/' + b1.ref, kW.key, { name: '=1+1' });
  check('patch: name', r.status === 200 && r.json.name === '=1+1', r.text);
  r = await api('PATCH', '/bookings/' + b1.ref, kW.key, { totalPrice: 1 });
  check('patch: fields that cannot be changed are refused', r.status === 400 && r.json.error.code === 'unknown_field', r.text);
  r = await api('PATCH', '/bookings/' + b1.ref, kW.key, { status: 'NONSENSE' });
  check('patch: invalid status: 422', r.status === 422, r.text);
  r = await api('PATCH', '/bookings/' + b1.ref, kW.key, {});
  check('patch: nothing to change: 400', r.status === 400, r.text);
  r = await api('PATCH', '/bookings/NOPE-1', kW.key, { dietary: 'x' });
  check('patch: unknown booking: 404', r.status === 404, r.text);
  r = await api('PATCH', '/bookings/' + b1.ref, kR.key, { dietary: 'x' });
  check('patch: read key refused', r.status === 403, r.text);
  r = await api('DELETE', '/bookings/' + b2.ref, kW.key);
  check('delete cancels the booking', r.status === 200 && r.json.status === 'CANCELLED', r.text);
  r = await api('DELETE', '/bookings/' + b2.ref, kW.key);
  check('cancelling twice is harmless', r.status === 200 && r.json.status === 'CANCELLED', r.text);
  r = await api('DELETE', '/bookings/NOPE-1', kW.key);
  check('cancel unknown: 404', r.status === 404, r.text);
  r = await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI2', type: 'tent' }));
  check('a cancelled callsign can book again', r.status === 201, r.text);

  // ---- statistics (no personal data) ----
  r = await api('GET', '/stats', kS.key);
  check('stats: counts', r.json.bookings.total >= 5 && r.json.bookings.cancelled >= 1 && r.json.bookings.byType.tent >= 3 && r.json.payments.paidTotal > 0 && r.json.extras[0].qty >= 1, r.text);
  check('stats: no personal data', !/api-person@|Api Person|TESTAPI/.test(r.text), null);
  r = await api('GET', '/availability', kS.key);
  check('availability', r.status === 200 && r.json.registrationOpen === true && Array.isArray(r.json.rooms) && r.json.extras[0].id === 'dinner' && !/@/.test(r.text), r.text);

  // ---- exports ----
  r = await api('GET', '/export/bookings.csv', kR.key);
  check('export bookings CSV', r.status === 200 && /text\/csv/.test(r.headers.get('content-type')) && /attachment/.test(r.headers.get('content-disposition')) && r.text.startsWith('﻿ref,createdAt,callsign') && r.text.includes('TESTAPI1'), r.text.slice(0, 120));
  check('export CSV: formula cells are neutralised', r.text.includes("'=1+1") && !/,=1\+1,/.test(r.text), null);
  r = await api('GET', '/export/bookings.json?status=CANCELLED', kR.key);
  check('export bookings JSON with a filter', r.status === 200 && r.json.count >= 1 && r.json.data.every(b => b.status === 'CANCELLED'), r.text.slice(0, 120));
  r = await api('GET', '/export/bookings.csv', kS.key);
  check('export bookings needs bookings:read', r.status === 403, r.status);
  r = await api('GET', '/export/extras.csv', kS.key);
  check('export extras CSV (stats key)', r.status === 200 && /^﻿id,name,qty,bookings,revenue/.test(r.text) && /dinner,Saturday dinner,/.test(r.text), r.text);
  r = await api('GET', '/export/extras.json', kS.key);
  check('export extras JSON', r.status === 200 && r.json.data[0].id === 'dinner' && r.json.data[0].qty >= 2, r.text);
  r = await api('GET', '/export/accommodation.csv', kS.key);
  check('export accommodation CSV', r.status === 200 && /^﻿kind,id,name/.test(r.text) && /\ntent,tent,/.test(r.text), r.text.slice(0, 200));
  r = await api('GET', '/export/accommodation.json', kS.key);
  check('export accommodation JSON', r.status === 200 && Array.isArray(r.json.rooms) && r.json.tent.booked >= 3, r.text.slice(0, 200));
  r = await api('GET', '/export/bookings.xml', kR.key);
  check('unknown export format: 404', r.status === 404, r.status);

  // ---- usage is logged, keys can be revoked ----
  const ov2 = (await rpc('getApiOverview')).body.result;
  check('usage counters and last use are recorded', ov2.keys.find(k => k.name === 'web shop').requests > 5 && ov2.keys.find(k => k.name === 'web shop').lastUsedAt, ov2.keys);
  x = (await rpc('revokeApiKey', ov2.keys.find(k => k.name === 'dashboard').id)).body.result;
  check('revoke a key', x.success, x);
  r = await api('GET', '/ping', kS.key);
  check('a revoked key stops working immediately', r.status === 401, r.text);
  x = (await rpc('revokeApiKey', ov2.keys.find(k => k.name === 'dashboard').id)).body.result;
  check('revoking twice reports it', !x.success, x);
  r = await api('GET', '/ping', kR.key);
  check('other keys are unaffected', r.status === 200, r.text);

  // ---- webhooks ----
  const hooks = [];
  let mode = 200;
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { hooks.push({ url: req.url, headers: req.headers, body: b }); res.statusCode = mode; res.end('ok'); }); });
  await new Promise(res => srv.listen(39555, '127.0.0.1', res));
  const waitFor = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 8000)) { const f = hooks.find(pred); if (f) return f; await sleep(150); } return null; };
  const sigOk = (g, secret) => { const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(g.headers['x-webhook-signature'] || ''); return !!m && crypto.createHmac('sha256', secret).update(m[1] + '.' + g.body).digest('hex') === m[2] && Math.abs(Date.now() / 1000 - Number(m[1])) < 60; };
  for (const bad of ['', 'not a url', 'ftp://example.com/x', 'https://user:pw@example.com/x']) {
    x = (await rpc('createWebhook', { name: 'bad', url: bad })).body.result;
    check('webhook address rejected: ' + (bad || '(empty)'), !x.success, x);
  }
  x = (await rpc('createWebhook', { name: 'bad', url: 'https://example.com/x', events: ['nothing.happened'] })).body.result;
  check('webhook: unknown event rejected', !x.success, x);
  const wh = (await rpc('createWebhook', { name: 'receiver', url: 'http://127.0.0.1:39555/hook', payload: 'full' })).body.result;
  if (!wh.success && /https/.test(wh.error || '')) {
    console.log('SKIP webhook delivery tests (start the server with API_WEBHOOK_ALLOW_PRIVATE=1 to test against a local receiver)');
  } else {
    check('webhook created, secret shown once', wh.success && /^whsec_/.test(wh.secret) && !JSON.stringify((await rpc('getApiOverview')).body.result).includes(wh.secret), wh);
    const mini = (await rpc('createWebhook', { name: 'minimal', url: 'http://127.0.0.1:39555/mini', payload: 'minimal', events: ['booking.created'] })).body.result;
    check('second webhook (minimal, created only)', mini.success, mini);
    let t = (await rpc('testWebhook', wh.hook.id)).body.result;
    const gt = await waitFor(g => g.url === '/hook' && JSON.parse(g.body).type === 'webhook.test', 3000);
    check('test event is delivered and signed', t.ok === true && gt && sigOk(gt, wh.secret) && gt.headers['x-webhook-event'] === 'webhook.test', [t, gt && gt.headers]);
    mode = 500;
    t = (await rpc('testWebhook', wh.hook.id)).body.result;
    check('test event reports a failing receiver', t.success && t.ok === false && t.code === 500, t);
    mode = 200;

    hooks.length = 0;
    r = await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI4', type: 'tent' }));
    const ref4 = r.json.ref;
    const gc = await waitFor(g => g.url === '/hook' && JSON.parse(g.body).type === 'booking.created');
    const pc = gc && JSON.parse(gc.body);
    check('booking.created is delivered with a valid signature', gc && sigOk(gc, wh.secret) && pc.data.booking.ref === ref4 && pc.data.booking.email === 'api-person@example.com' && gc.headers['x-webhook-id'] === pc.id, gc && gc.body);
    check('a tampered body fails the signature check', gc && !sigOk({ headers: gc.headers, body: gc.body.replace('TESTAPI4', 'TESTAPIX') }, wh.secret), null);
    const gm = await waitFor(g => g.url === '/mini');
    const pm = gm && JSON.parse(gm.body);
    check('minimal webhook carries no personal data', gm && pm.data.booking.ref === ref4 && !/api-person@|Api Person|TESTAPI4"/.test(gm.body.replace(ref4, '')) && pm.data.booking.email === undefined, gm && gm.body);

    hooks.length = 0;
    await api('PATCH', '/bookings/' + ref4, kW.key, { paymentStatus: 'PAID' });
    const gp = await waitFor(g => g.url === '/hook' && JSON.parse(g.body).type === 'booking.paid');
    check('booking.paid is delivered', gp && sigOk(gp, wh.secret) && JSON.parse(gp.body).data.booking.paymentStatus === 'PAID', gp && gp.body);
    await sleep(600);
    check('paying alone sends no booking.updated, and the created-only webhook stays quiet', !hooks.some(g => g.url === '/hook' && JSON.parse(g.body).type === 'booking.updated') && !hooks.some(g => g.url === '/mini'), hooks.map(g => g.url));
    hooks.length = 0;
    await rpc('updateBooking', '', ref4, { OrgComment: 'from the admin panel' }, false);
    const gu = await waitFor(g => g.url === '/hook' && JSON.parse(g.body).type === 'booking.updated');
    check('booking.updated is delivered for admin panel changes too', gu && JSON.parse(gu.body).data.changed.includes('orgComment') && JSON.parse(gu.body).data.booking.orgComment === 'from the admin panel', gu && gu.body);
    hooks.length = 0;
    await api('DELETE', '/bookings/' + ref4, kW.key);
    const gx = await waitFor(g => g.url === '/hook' && JSON.parse(g.body).type === 'booking.cancelled');
    check('booking.cancelled is delivered', gx && JSON.parse(gx.body).data.booking.status === 'CANCELLED', gx && gx.body);

    // retry queue
    mode = 503; hooks.length = 0;
    await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI6', type: 'tent' }));
    await waitFor(g => g.url === '/hook');
    await sleep(500);
    let dl = (await rpc('getWebhookDeliveries', wh.hook.id)).body.result.deliveries;
    const pend = dl.find(d => d.event === 'booking.created' && d.status === 'pending');
    check('a failed delivery stays queued for a retry', pend && pend.attempts === 1 && pend.last_code === 503, dl.slice(0, 3));
    const ovw = (await rpc('getApiOverview')).body.result.webhooks.hooks.find(h => h.id === wh.hook.id);
    check('the webhook list shows the failure', ovw.failures >= 1 && ovw.pending >= 1 && /503|answered/.test(ovw.lastStatus), ovw);
    mode = 200;

    // switching off, rotating the secret, erasing
    x = (await rpc('updateWebhook', wh.hook.id, { name: 'receiver', url: 'http://127.0.0.1:39555/hook', events: wh.hook.events, payload: 'full', enabled: false })).body.result;
    hooks.length = 0;
    await api('POST', '/bookings', kW.key, person({ callsign: 'TESTAPI7', type: 'tent' }));
    await sleep(1200);
    check('a switched-off webhook receives nothing', x.success && !hooks.some(g => g.url === '/hook'), hooks.map(g => g.url));
    x = (await rpc('updateWebhook', wh.hook.id, { name: 'receiver', url: 'http://127.0.0.1:39555/hook', events: wh.hook.events, payload: 'full', enabled: true, rotateSecret: true })).body.result;
    check('rotating gives a new secret', x.success && /^whsec_/.test(x.secret) && x.secret !== wh.secret, x);
    const secret2 = x.secret;
    hooks.length = 0;
    const ref7 = (await api('GET', '/bookings?callsign=TESTAPI7', kR.key)).json.data[0].ref;
    await rpc('updateBooking', '', ref7, { OrgComment: 'x' }, false);
    const g2 = await waitFor(g => g.url === '/hook' && JSON.parse(g.body).type === 'booking.updated');
    check('deliveries use the new secret', g2 && sigOk(g2, secret2) && !sigOk(g2, wh.secret), g2 && g2.headers);
    hooks.length = 0;
    const er = (await rpc('eraseBooking', ref7, { sendNotice: false })).body.result;
    const ge = await waitFor(g => g.url === '/hook' && JSON.parse(g.body).type === 'booking.erased');
    check('booking.erased announces the reference only', er.success && ge && JSON.parse(ge.body).data.ref === ref7 && !/api-person@|Api Person/.test(ge.body), ge && ge.body);
    dl = (await rpc('getWebhookDeliveries', wh.hook.id)).body.result.deliveries;
    check('delivery log shows successful deliveries', dl.some(d => d.status === 'ok'), dl.slice(0, 3));
    x = (await rpc('deleteWebhook', mini.hook.id)).body.result;
    check('webhook deleted', x.success, x);
  }

  // ---- roles ----
  cookie = '';
  if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD !== PW) {
    await rpc('checkAdminPassword', process.env.ADMIN_PASSWORD, 'admin');
    for (const [m, args] of [['getApiOverview', []], ['createApiKey', ['x', ['stats']]], ['revokeApiKey', [1]], ['createWebhook', [{}]], ['testWebhook', [1]]]) {
      r = await rpc(m, ...args);
      check('admin role cannot use ' + m, r.status === 403, r.status);
    }
    cookie = '';
  }
  check('API settings need a login', (await rpc('getApiOverview')).status === 401, null);

  // ---- event shutdown ends the integrations ----
  if (process.env.SMOKE_ALLOW_SHUTDOWN === '1') {
    await rpc('checkAdminPassword', PW, 'setup');
    x = (await rpc('shutdownEvent', { confirm: 'ERASE ALL DATA', acknowledgeEarly: true })).body.result;
    check('shutdown succeeds', x.success && x.verified, x);
    const after = (await rpc('getApiOverview')).body.result;
    check('shutdown revokes every API key', after.keys.length > 0 && after.keys.every(k => k.revokedAt), after.keys);
    check('shutdown switches webhooks off and empties the queue', after.webhooks.hooks.every(h => !h.enabled && h.pending === 0), after.webhooks.hooks);
    r = await api('GET', '/ping', kRW.key);
    check('keys no longer work after shutdown', r.status === 401 || r.status === 403, r.status);
  } else console.log('SKIP shutdown checks (set SMOKE_ALLOW_SHUTDOWN=1 on a throwaway database)');

  srv.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll API checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
