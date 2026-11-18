'use strict';
// Data shapes of the public API: how bookings, availability, statistics and exports are presented.
// Statistics and availability contain no personal data; bookings do (they need the bookings:read scope).
const { CONFIG } = require('./config');
const db = require('./db');
const repo = require('./repo');
const S = require('./structure');
const addons = require('./addons');
const { getSettings } = require('./settings');

const yes = v => v === 'YES';

// A booking as the API shows it. `extras` is the list of chosen extras.
function serializeBooking(row, extras, tickets) {
  const o = repo.toObj(row);
  return {
    ref: o.bookingRef,
    createdAt: new Date(row.created_at).toISOString(),
    callsign: o.callsign, name: o.name, email: o.email, phone: o.phone, country: o.country,
    type: o.type, roomId: o.roomId, roomRef: o.roomRef, isPrimary: yes(o.isPrimaryBooker), soloRoom: yes(o.soloRoom),
    extraNights: S.keys(o.extraNights), nights: S.pickNights(o.nights), visitorDays: S.keys(o.visitorDays),
    fullBoard: yes(o.fullBoard), dietary: o.dietary, shirtSize: o.shirtSize,
    totalPrice: o.totalPrice, currency: o.currency, priceBreakdown: o.priceBreakdown,
    status: o.status, paymentStatus: o.paymentStatus, paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    roomNumber: o.roomNumber, orgComment: o.orgComment, publishConsent: yes(o.publishConsent), isOrganizer: yes(o.isOrganizer),
    freeText: o.freeText, language: o.language,
    extras: (extras || []).map(a => ({ id: a.id, name: a.name, qty: a.qty, unitPrice: a.unit_price, note: a.note || '' })),
    tickets: tickets || [],
  };
}
// Just enough to know what happened, no personal data.
function minimalBooking(b) {
  return { ref: b.ref, type: b.type, status: b.status, paymentStatus: b.paymentStatus, totalPrice: b.totalPrice, currency: b.currency };
}

async function extrasByBookingId(client, ids) {
  const map = {};
  if (!ids.length) return map;
  const r = await client.query('SELECT booking_id, addon_id AS id, name, qty, unit_price, note FROM booking_addons WHERE booking_id = ANY($1::int[]) ORDER BY addon_id', [ids]);
  r.rows.forEach(x => { (map[x.booking_id] = map[x.booking_id] || []).push({ id: x.id, name: x.name, qty: Number(x.qty), unit_price: Number(x.unit_price), note: x.note || '' }); });
  return map;
}
async function ticketsByBookingId(client, ids) {
  const map = {};
  if (!ids.length) return map;
  const r = await client.query('SELECT booking_id, name FROM booking_tickets WHERE booking_id = ANY($1::int[]) ORDER BY booking_id, sort', [ids]);
  r.rows.forEach(x => { (map[x.booking_id] = map[x.booking_id] || []).push(x.name); });
  return map;
}

async function getBooking(client, ref) {
  const r = await client.query('SELECT * FROM bookings WHERE booking_ref = $1', [String(ref || '')]);
  if (!r.rows.length) return null;
  return serializeBooking(r.rows[0], (await extrasByBookingId(client, [r.rows[0].id]))[r.rows[0].id], (await ticketsByBookingId(client, [r.rows[0].id]))[r.rows[0].id]);
}

const LIST_FILTERS = { status: 'status', type: 'type', paymentStatus: 'payment_status', roomId: 'room_id' };
// Bookings, oldest first, filtered. `after` is the sequence number to continue from. Returns { rows, next }.
async function listBookings(client, q, opts) {
  opts = opts || {};
  const where = []; const vals = [];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', '$' + vals.length)); };
  Object.keys(LIST_FILTERS).forEach(k => { if (q[k]) add(LIST_FILTERS[k] + ' = ?', String(q[k])); });
  if (q.callsign) add('upper(callsign) = upper(?)', String(q.callsign));
  if (q.email) add('lower(email) = lower(?)', String(q.email));
  if (q.country) add('upper(country) = upper(?)', String(q.country));
  if (q.createdSince) { const d = new Date(q.createdSince); if (isNaN(d)) return { error: 'createdSince must be an ISO date or time' }; add('created_at >= ?', d.toISOString()); }
  if (q.q) {
    vals.push('%' + String(q.q).replace(/[%_\\]/g, '\\$&') + '%');
    const n = '$' + vals.length;
    where.push(`(callsign ILIKE ${n} OR name ILIKE ${n} OR booking_ref ILIKE ${n})`);
  }
  if (q.activeOnly === 'true' || q.activeOnly === '1') where.push("status <> 'CANCELLED'");
  const after = parseInt(q.after, 10);
  if (after > 0) add('seq > ?', after);
  const limit = opts.all ? 100000 : Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  vals.push(limit + 1);
  const r = await client.query(`SELECT * FROM bookings${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY seq LIMIT $${vals.length}`, vals);
  const more = r.rows.length > limit;
  const rows = r.rows.slice(0, limit);
  const ex = await extrasByBookingId(client, rows.map(x => x.id));
  const tk = await ticketsByBookingId(client, rows.map(x => x.id));
  return { data: rows.map(x => serializeBooking(x, ex[x.id], tk[x.id])), next: more ? rows[rows.length - 1].seq : null };
}

// ---- no personal data below ----
function eventInfo() {
  return {
    name: CONFIG.EVENT_NAME, shortName: CONFIG.EVENT_SHORT, organizer: CONFIG.ORGANIZER, location: CONFIG.LOCATION, datesText: CONFIG.DATES_TEXT,
    mode: CONFIG.EVENT_MODE === 'day' ? 'day' : 'overnight', profile: CONFIG.EVENT_PROFILE, modules: require('./modules').flags(), currency: CONFIG.CURRENCY, languages: String(CONFIG.LANGUAGES || 'en').split(','),
    defaultLanguage: CONFIG.DEFAULT_LANGUAGE, url: CONFIG.FRIENDLY_URL, endDate: CONFIG.EVENT_END_DATE || null,
    days: CONFIG.STRUCTURE.days, accommodation: CONFIG.STRUCTURE.accommodation, extraNights: CONFIG.STRUCTURE.extraNights,
    mealPackage: CONFIG.STRUCTURE.package.enabled ? { sub: CONFIG.STRUCTURE.package.sub, includes: CONFIG.STRUCTURE.package.includes } : null,
  };
}

async function extrasCatalog(client) {
  const used = await addons.usedMap(client);
  return CONFIG.ADDONS.map(a => ({
    id: a.id, name: a.name, description: a.description, price: a.price, maxPerBooking: a.max_qty, capacity: a.capacity || null,
    taken: used[a.id] || 0, left: a.capacity > 0 ? Math.max(0, a.capacity - (used[a.id] || 0)) : null,
    signUpCloses: a.closes || null, enabled: a.enabled, closed: addons.isClosed(a), kind: a.kind,
    vendorSpace: a.kind === 'vendor' ? {
      spaceType: a.space_type, day: a.day_key || null, starts: a.starts || null, ends: a.ends || null, size: a.size, power: a.power, location: a.location,
      pricing: a.pricing, unit: a.unit, unitPrice: addons.unitPrice(a), question: a.prompt || null, questionRequired: a.prompt_required,
    } : null,
  }));
}

// Room inventory and occupancy per room type (and per night in per-night mode).
async function accommodation(client) {
  const settings = await getSettings(client);
  const bookings = repo.active(await repo.all(client)).map(repo.toObj);
  const nights = S.allNightKeys();
  const rooms = CONFIG.ROOMS.map(r => {
    const total = settings.ROOM_COUNTS[r.id];
    const occ = S.occupancy(bookings, r.id);
    const perNight = {}; nights.forEach(k => { perNight[k] = { booked: occ[k], free: total - occ[k] }; });
    return {
      roomId: r.id, name: r.note_en, persons: r.persons, rooms: total, price: settings.ROOM_PRICES[r.id],
      roomsBooked: bookings.filter(b => b.roomId === r.id && b.isPrimaryBooker === 'YES').length,
      bedsUsed: bookings.filter(b => b.roomId === r.id).length, bedsTotal: r.persons * total, perNight,
    };
  });
  const camperBooked = bookings.filter(b => b.type === 'camper' && b.isPrimaryBooker === 'YES').length;
  return {
    mode: CONFIG.EVENT_MODE === 'day' ? 'day' : 'overnight',
    rooms,
    camper: { spots: settings.CAMPER_VAN_SPOTS, booked: camperBooked, free: settings.CAMPER_VAN_SPOTS - camperBooked, pricePerNight: settings.CAMPER_VAN_PRICE_PER_NIGHT },
    tent: { enabled: !!settings.TENT_ENABLED, spots: settings.TENT_SPOTS, booked: bookings.filter(b => b.type === 'tent').length },
    singleBed: { enabled: !!settings.ALLOW_SINGLE_BED_BOOKING, slots: settings.SINGLE_BED_SLOTS || 0, booked: bookings.filter(b => b.type === 'singlebed').length },
  };
}

async function availability(client) {
  const acc = await accommodation(client);
  const settings = await getSettings(client);
  const open = !!settings.REGISTRATION_OPEN && !(settings.REGISTRATION_CLOSES && new Date() > new Date(settings.REGISTRATION_CLOSES + 'T23:59:59'));
  return {
    registrationOpen: open, registrationCloses: settings.REGISTRATION_CLOSES || null,
    rooms: acc.rooms.map(r => ({ roomId: r.roomId, name: r.name, persons: r.persons, free: Math.max(0, r.rooms - r.roomsBooked), price: r.price, freePerNight: Object.fromEntries(Object.entries(r.perNight).map(([k, v]) => [k, v.free])) })),
    camperSpotsLeft: acc.camper.free,
    tentSpotsLeft: acc.tent.enabled ? acc.tent.spots - acc.tent.booked : 0,
    singleBedsLeft: acc.singleBed.enabled ? Math.max(0, acc.singleBed.slots - acc.singleBed.booked) : 0,
    extras: await extrasCatalog(client),
  };
}

// Counts and sums for dashboards and other systems.
async function stats(client) {
  const rows = (await client.query('SELECT * FROM bookings')).rows;
  const active = rows.filter(r => r.status !== 'CANCELLED');
  const count = (list, f) => list.reduce((m, r) => { const k = f(r) || ''; m[k] = (m[k] || 0) + 1; return m; }, {});
  const sum = list => Math.round(list.reduce((s, r) => s + Number(r.total_price || 0), 0) * 100) / 100;
  const extras = await extrasCatalog(client);
  return {
    generatedAt: new Date().toISOString(), currency: CONFIG.CURRENCY,
    bookings: {
      total: rows.length, active: active.length, cancelled: rows.length - active.length,
      byStatus: count(rows, r => r.status), byType: count(active, r => r.type), byCountry: count(active, r => String(r.country || '').toUpperCase()),
      checkedIn: active.filter(r => r.status === 'CHECKED_IN').length,
      createdLast24h: rows.filter(r => Date.now() - new Date(r.created_at).getTime() < 86400000).length,
    },
    payments: {
      byStatus: count(active, r => r.payment_status),
      expectedTotal: sum(active), paidTotal: sum(active.filter(r => r.payment_status === 'PAID')),
      outstandingTotal: sum(active.filter(r => r.payment_status === 'UNPAID')),
    },
    extras: extras.map(e => ({ id: e.id, name: e.name, qty: e.taken, left: e.left })),
    accommodation: await accommodation(client),
  };
}

// Extras totals: how many of each extra are booked (active bookings only).
async function extrasSummary(client) {
  const r = await client.query(`SELECT ba.addon_id AS id, ba.name, SUM(ba.qty)::int AS qty, count(*)::int AS bookings, SUM(ba.qty * ba.unit_price)::numeric(12,2) AS revenue
    FROM booking_addons ba JOIN bookings b ON b.id = ba.booking_id WHERE b.status <> 'CANCELLED' GROUP BY ba.addon_id, ba.name ORDER BY ba.addon_id`);
  return r.rows.map(x => ({ id: x.id, name: x.name, qty: x.qty, bookings: x.bookings, revenue: Number(x.revenue) }));
}

// ---- CSV ----
// Cells that start with = + - @ would be run as formulas by spreadsheet programs: prefix them with an apostrophe.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(columns, rows) {
  const lines = [columns.map(csvCell).join(',')];
  rows.forEach(r => lines.push(columns.map(c => csvCell(r[c])).join(',')));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
// A booking flattened for CSV (lists become text)
function flatBooking(b) {
  const f = Object.assign({}, b);
  f.extraNights = b.extraNights.join(' '); f.nights = b.nights.join(' '); f.visitorDays = b.visitorDays.join(' ');
  f.extras = b.extras.map(a => a.id + (a.qty > 1 ? 'x' + a.qty : '')).join(' ');
  return f;
}
const BOOKING_COLUMNS = ['ref', 'createdAt', 'callsign', 'name', 'email', 'phone', 'country', 'type', 'roomId', 'roomRef', 'isPrimary', 'soloRoom', 'extraNights', 'nights', 'visitorDays',
  'fullBoard', 'dietary', 'shirtSize', 'totalPrice', 'currency', 'priceBreakdown', 'status', 'paymentStatus', 'paidAt', 'roomNumber', 'orgComment', 'publishConsent', 'isOrganizer', 'freeText', 'language', 'extras'];

module.exports = {
  serializeBooking, minimalBooking, getBooking, listBookings, eventInfo, extrasCatalog, accommodation, availability, stats, extrasSummary,
  toCsv, flatBooking, BOOKING_COLUMNS,
};
