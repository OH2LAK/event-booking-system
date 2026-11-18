'use strict';
// Public REST API (/api/v1). Authentication: "Authorization: Bearer <api key>"; keys and permissions are managed on the setup page.
// Scopes: stats = counts and availability without personal data, bookings:read = booking lists and exports, bookings:write = create, change and cancel.
// Everything is described in docs/API.md and served as OpenAPI at /api/v1/openapi.json.
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const service = require('./service');
const keys = require('./apiKeys');
const model = require('./apiModel');
const openapi = require('./openapi');
const { CONFIG } = require('./config');

const router = express.Router();
const RATE_PER_MINUTE = Math.max(10, parseInt(process.env.API_RATE_PER_MINUTE || '300', 10) || 300);

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const need = scope => (req, res, next) => (keys.hasScope(req.apiKey, scope) ? next() : fail(res, 403, 'insufficient_scope', `This API key needs the "${scope}" permission.`));

// The description is public and contains no data
router.get('/openapi.json', (req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json(openapi.build()); });

// ---- gate: API switched on, valid key, rate limit ----
router.use(wrap(async (req, res, next) => {
  if (!keys.enabled()) return fail(res, 403, 'api_disabled', 'The API is switched off for this event. The organizer can switch it on in Event setup.');
  if (keys.tooManyFailures(req.ip)) return fail(res, 429, 'too_many_failures', 'Too many failed attempts, try again later.');
  const key = await keys.authenticate(req.get('authorization'));
  if (!key) {
    keys.recordFailure(req.ip);
    res.set('WWW-Authenticate', 'Bearer realm="booking-api"');
    return fail(res, 401, 'invalid_key', 'Missing, invalid, expired or revoked API key. Send "Authorization: Bearer <key>".');
  }
  if (keys.rateLimited(key.id, RATE_PER_MINUTE)) { res.set('Retry-After', '60'); return fail(res, 429, 'rate_limited', `Too many requests (limit ${RATE_PER_MINUTE} per minute).`); }
  req.apiKey = key;
  // Changes (and refusals) are written to the event log, reads only update the key's usage counters
  if (req.method !== 'GET') res.on('finish', () => db.logEvent(res.statusCode < 400 ? 'OK' : 'WARN', 'api_request', '', `key=${key.name} ${req.method} ${req.path} -> ${res.statusCode}`));
  next();
}));

// ---- read: no personal data ----
router.get('/ping', (req, res) => res.json({ ok: true, event: CONFIG.EVENT_SHORT, key: req.apiKey.name, scopes: req.apiKey.scopes, time: new Date().toISOString() }));
router.get('/event', need('stats'), (req, res) => res.json(model.eventInfo()));
router.get('/availability', need('stats'), wrap(async (req, res) => res.json(await model.availability(db))));
router.get('/stats', need('stats'), wrap(async (req, res) => res.json(await model.stats(db))));
router.get('/extras', need('stats'), wrap(async (req, res) => res.json({ data: await model.extrasCatalog(db) })));

// ---- read: bookings (personal data) ----
router.get('/bookings', need('bookings:read'), wrap(async (req, res) => {
  const r = await model.listBookings(db, req.query);
  if (r.error) return fail(res, 400, 'invalid_parameter', r.error);
  res.json({ data: r.data, count: r.data.length, nextAfter: r.next });
}));
router.get('/bookings/:ref', need('bookings:read'), wrap(async (req, res) => {
  const b = await model.getBooking(db, req.params.ref);
  return b ? res.json(b) : fail(res, 404, 'not_found', 'No booking with that reference.');
}));

// ---- exports ----
const sendExport = (req, res, name, columns, rows, jsonBody) => {
  const fmt = req.params.fmt;
  if (fmt === 'json') return res.json(jsonBody);
  const file = `${name}-${CONFIG.SLUG}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${file}"`);
  return res.send(model.toCsv(columns, rows));
};
const fmtOk = (req, res, next) => (['csv', 'json'].includes(req.params.fmt) ? next() : fail(res, 404, 'not_found', 'Use .csv or .json'));

router.get('/export/bookings.:fmt', fmtOk, need('bookings:read'), wrap(async (req, res) => {
  const r = await model.listBookings(db, req.query, { all: true });
  if (r.error) return fail(res, 400, 'invalid_parameter', r.error);
  return sendExport(req, res, 'bookings', model.BOOKING_COLUMNS, r.data.map(model.flatBooking), { count: r.data.length, data: r.data });
}));
router.get('/export/extras.:fmt', fmtOk, need('stats'), wrap(async (req, res) => {
  const data = await model.extrasSummary(db);
  return sendExport(req, res, 'extras', ['id', 'name', 'qty', 'bookings', 'revenue'], data, { currency: CONFIG.CURRENCY, data });
}));
router.get('/export/accommodation.:fmt', fmtOk, need('stats'), wrap(async (req, res) => {
  const acc = await model.accommodation(db);
  const nights = Object.keys((acc.rooms[0] && acc.rooms[0].perNight) || {});
  const rows = acc.rooms.map(r => {
    const row = { kind: 'room', id: r.roomId, name: r.name, persons: r.persons, unitsTotal: r.rooms, unitsBooked: r.roomsBooked, bedsTotal: r.bedsTotal, bedsUsed: r.bedsUsed, price: r.price };
    nights.forEach(k => { row['booked_' + k] = r.perNight[k].booked; });
    return row;
  });
  rows.push({ kind: 'camper', id: 'camper', name: 'Camper van spots', unitsTotal: acc.camper.spots, unitsBooked: acc.camper.booked, price: acc.camper.pricePerNight });
  rows.push({ kind: 'tent', id: 'tent', name: 'Tent spots', unitsTotal: acc.tent.spots, unitsBooked: acc.tent.booked });
  rows.push({ kind: 'singlebed', id: 'singlebed', name: 'Single beds', unitsTotal: acc.singleBed.slots, unitsBooked: acc.singleBed.booked });
  const cols = ['kind', 'id', 'name', 'persons', 'unitsTotal', 'unitsBooked', 'bedsTotal', 'bedsUsed', 'price'].concat(nights.map(k => 'booked_' + k));
  return sendExport(req, res, 'accommodation', cols, rows, acc);
}));

// ---- write ----
const CONFLICT = new Set(['err.exists', 'err.noRooms', 'err.noRoomsNight', 'err.roomFullRef', 'err.noCamper', 'err.noTent', 'err.noSingle', 'err.addonFull', 'err.soloBooked']);
const CLOSED = new Set(['err.closed', 'err.closedOn']);
const code = key => String(key || 'invalid').replace(/^err\./, '');
const isObj = b => b && typeof b === 'object' && !Array.isArray(b);

// Runs a creating request once per Idempotency-Key: a retry with the same key and body gets the first answer again
async function idempotent(req, res, run) {
  const idem = req.get('Idempotency-Key');
  if (!idem) return send(res, await run());
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(idem)) return fail(res, 400, 'invalid_idempotency_key', 'Idempotency-Key may contain letters, digits and _ . : - (max 100 characters).');
  const hash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
  const claim = () => db.query('INSERT INTO api_idempotency (key_id, idem_key, request_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1', [req.apiKey.id, idem, hash]);
  let ins = await claim();
  if (!ins.rowCount) {
    const e = (await db.query('SELECT request_hash, status_code, response, created_at < now() - interval \'2 minutes\' AS stale FROM api_idempotency WHERE key_id = $1 AND idem_key = $2', [req.apiKey.id, idem])).rows[0];
    if (e && e.status_code === null && e.stale) { await db.query('DELETE FROM api_idempotency WHERE key_id = $1 AND idem_key = $2', [req.apiKey.id, idem]); ins = await claim(); }
    if (!ins.rowCount) {
      if (!e) return fail(res, 409, 'idempotency_conflict', 'Try again.');
      if (e.request_hash !== hash) return fail(res, 422, 'idempotency_mismatch', 'This Idempotency-Key was already used with a different request body.');
      if (e.status_code === null) return fail(res, 409, 'request_in_progress', 'A request with this Idempotency-Key is still being processed.');
      res.set('Idempotent-Replayed', 'true');
      return res.status(e.status_code).json(e.response);
    }
  }
  try {
    const out = await run();
    if (out.status < 300) await db.query('UPDATE api_idempotency SET status_code = $3, response = $4 WHERE key_id = $1 AND idem_key = $2', [req.apiKey.id, idem, out.status, JSON.stringify(out.body)]);
    else await db.query('DELETE FROM api_idempotency WHERE key_id = $1 AND idem_key = $2', [req.apiKey.id, idem]); // failures may be retried
    return send(res, out);
  } catch (e) {
    await db.query('DELETE FROM api_idempotency WHERE key_id = $1 AND idem_key = $2', [req.apiKey.id, idem]).catch(() => {});
    throw e;
  }
}
const send = (res, out) => res.status(out.status).json(out.body);
const err = (status, c, message) => ({ status, body: { error: { code: c, message } } });

router.post('/bookings', need('bookings:write'), wrap(async (req, res) => idempotent(req, res, async () => {
  if (!isObj(req.body)) return err(400, 'invalid_body', 'Send a JSON object.');
  const b = req.body;
  if (b.paymentStatus !== undefined && !['UNPAID', 'PAID', 'WAIVED'].includes(b.paymentStatus)) return err(422, 'invalid_booking', 'paymentStatus must be UNPAID, PAID or WAIVED.');
  const input = Object.assign({}, b, { addons: b.extras !== undefined ? b.extras : b.addons });
  const r = await service.submitBooking(input, { skipNotifications: b.sendNotifications === false, paymentStatus: b.paymentStatus, source: 'api:' + req.apiKey.name });
  if (!r.success) {
    if (CLOSED.has(r.code)) return err(403, 'registration_closed', r.error);
    return err(CONFLICT.has(r.code) ? 409 : 422, code(r.code), r.error);
  }
  return { status: 201, body: await model.getBooking(db, r.bookingRef) };
})));

// API field name -> booking field of the admin functions
const PATCHABLE = {
  callsign: 'Callsign', name: 'Name', email: 'Email', phone: 'Phone', country: 'Country', type: 'Type', roomId: 'RoomId', roomRef: 'RoomRef',
  isPrimary: 'IsPrimaryBooker', extraNights: 'ExtraNights', nights: 'Nights', fullBoard: 'FullBoard', dietary: 'Dietary', status: 'Status',
  roomNumber: 'RoomNumber', orgComment: 'OrgComment', publishConsent: 'PublishConsent', soloRoom: 'SoloRoom', freeText: 'FreeText',
  isOrganizer: 'IsOrganizer', visitorDays: 'VisitorDays', paymentStatus: 'PaymentStatus', extras: 'Addons', tickets: 'Tickets',
};
const notFound = e => /not found/i.test(e || '');
const failFromService = (res, r) => (notFound(r.error) ? fail(res, 404, 'not_found', r.error) : fail(res, /already has an active booking/.test(r.error) ? 409 : 422, 'invalid_booking', r.error));

router.patch('/bookings/:ref', need('bookings:write'), wrap(async (req, res) => {
  const b = req.body;
  if (!isObj(b)) return fail(res, 400, 'invalid_body', 'Send a JSON object with the fields to change.');
  const fields = {};
  for (const k of Object.keys(b)) {
    if (k === 'sendEmail') continue;
    if (!PATCHABLE[k]) return fail(res, 400, 'unknown_field', `"${k}" cannot be changed. Changeable: ${Object.keys(PATCHABLE).join(', ')}.`);
    const v = b[k];
    if (typeof v === 'string' && v.length > 1000) return fail(res, 400, 'invalid_field', `${k} is too long (max 1000 characters).`);
    if (k === 'tickets' && !Array.isArray(v)) return fail(res, 400, 'invalid_field', 'tickets must be a list of names.');
    if (k === 'extras' && !Array.isArray(v)) return fail(res, 400, 'invalid_field', 'extras must be a list like [{"id":"dinner","qty":2}].');
    fields[PATCHABLE[k]] = Array.isArray(v) && k !== 'extras' && k !== 'tickets' ? v.join(',') : v;
  }
  if (!Object.keys(fields).length) return fail(res, 400, 'no_changes', 'Nothing to change.');
  const r = await service.updateBooking(req.params.ref, fields, b.sendEmail === true);
  if (!r.success) return failFromService(res, r);
  return res.json(await model.getBooking(db, req.params.ref));
}));

// DELETE cancels the booking (it stays in the list with status CANCELLED and frees the capacity). Erasing personal data is done by the organizer.
router.delete('/bookings/:ref', need('bookings:write'), wrap(async (req, res) => {
  const cur = await model.getBooking(db, req.params.ref);
  if (!cur) return fail(res, 404, 'not_found', 'No booking with that reference.');
  if (cur.status === 'CANCELLED') return res.json(cur);
  const r = await service.updateBooking(req.params.ref, { Status: 'CANCELLED' }, req.query.sendEmail === 'true');
  if (!r.success) return failFromService(res, r);
  return res.json(await model.getBooking(db, req.params.ref));
}));

router.use((req, res) => fail(res, 404, 'not_found', 'Unknown API path. See /api/v1/openapi.json.'));

module.exports = { router };
