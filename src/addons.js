'use strict';
// Optional extras (meals, excursions, workshops ...) the organizer offers. Catalog in table addons,
// mirrored into CONFIG.ADDONS; what a booking chose is stored in booking_addons (name and price are a snapshot).
const { CONFIG } = require('./config');
const db = require('./db');
const i18n = require('./i18n');

const modules = require('./modules');
const S = require('./structure');

const SPACE_TYPES = ['table', 'trunk', 'booth', 'other'];
const PRICINGS = ['item', 'metre', 'day'];
const MAX_NOTE = 300;

const toCfg = r => ({
  id: r.id, name: r.name, description: r.description || '', price: Number(r.price),
  max_qty: Number(r.max_qty), capacity: Number(r.capacity),
  closes: r.closes ? (r.closes instanceof Date ? r.closes.toISOString().slice(0, 10) : String(r.closes).slice(0, 10)) : '',
  enabled: !!r.enabled,
  kind: r.kind === 'vendor' ? 'vendor' : 'extra',
  space_type: r.space_type || '', day_key: r.day_key || '', starts: r.starts || '', ends: r.ends || '',
  size: r.size || '', power: r.power || '', location: r.location || '',
  pricing: PRICINGS.includes(r.pricing) ? r.pricing : 'item', unit: r.unit || '',
  prompt: r.prompt || '', prompt_required: !!r.prompt_required,
});
// A vendor space tied to no single day and priced per day costs the price for every event day.
const unitPrice = a => (a.kind === 'vendor' && a.pricing === 'day' && !a.day_key ? Math.round(a.price * Math.max(1, CONFIG.STRUCTURE.days.length) * 100) / 100 : a.price);
function apply(rows) { CONFIG.ADDONS = rows.map(toCfg); }
async function load() { apply((await db.query('SELECT * FROM addons ORDER BY sort, id')).rows); }

const clean = s => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// kind: 'extra' or 'vendor' limits the list to that kind (each admin card saves its own kind); undefined = both
function validate(list, kind) {
  if (!Array.isArray(list)) return { error: 'Invalid list' };
  if (list.length > 40) return { error: 'Too many entries (max 40)' };
  const seen = new Set(); const out = [];
  for (const a of list) {
    const id = String(a.id || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,11}$/.test(id)) return { error: `Invalid id "${id}" (letters, digits and "-", max 12 characters)` };
    if (seen.has(id)) return { error: `Duplicate id "${id}"` };
    seen.add(id);
    const k = a.kind === 'vendor' ? 'vendor' : 'extra';
    if (kind && k !== kind) return { error: `${id}: wrong kind of entry for this list` };
    const name = clean(a.name); const description = clean(a.description);
    if (!name || name.length > 60) return { error: `${id}: name is required (max 60 characters)` };
    if (description.length > 200) return { error: `${id}: description is too long (max 200 characters)` };
    const price = parseFloat(a.price === '' || a.price === undefined ? 0 : a.price);
    const maxQty = parseInt(a.max_qty === '' || a.max_qty === undefined ? 1 : a.max_qty, 10);
    const capacity = parseInt(a.capacity === '' || a.capacity === undefined ? 0 : a.capacity, 10);
    if (!(price >= 0 && price <= 100000)) return { error: `${id}: price must be 0-100000` };
    if (!(maxQty >= 1 && maxQty <= (k === 'vendor' ? 100 : 20))) return { error: `${id}: max per booking must be 1-${k === 'vendor' ? 100 : 20}` };
    if (!(capacity >= 0 && capacity <= 99999)) return { error: `${id}: capacity must be 0-99999 (0 = unlimited)` };
    const closes = String(a.closes || '').trim();
    if (closes && (!/^\d{4}-\d{2}-\d{2}$/.test(closes) || isNaN(Date.parse(closes + 'T00:00:00Z')))) return { error: `${id}: deadline must be a date like 2027-05-10` };
    const row = { id, name, description, price, max_qty: maxQty, capacity, closes: closes || null, enabled: a.enabled === true || a.enabled === 'true' || a.enabled === 'YES', kind: k,
      space_type: '', day_key: '', starts: '', ends: '', size: '', power: '', location: '', pricing: 'item', unit: '', prompt: '', prompt_required: false };
    if (k === 'vendor') {
      row.space_type = SPACE_TYPES.includes(a.space_type) ? a.space_type : 'table';
      row.day_key = String(a.day_key || '').trim();
      if (row.day_key && !CONFIG.STRUCTURE.days.some(d => d.key === row.day_key)) return { error: `${id}: choose one of the event days (or "all days")` };
      row.starts = String(a.starts || '').trim(); row.ends = String(a.ends || '').trim();
      if ((row.starts && !TIME.test(row.starts)) || (row.ends && !TIME.test(row.ends))) return { error: `${id}: times must look like 09:00` };
      if (row.starts && row.ends && row.ends <= row.starts) return { error: `${id}: end time must be after the start time` };
      row.size = clean(a.size).slice(0, 60); row.power = clean(a.power).slice(0, 60); row.location = clean(a.location).slice(0, 80); row.unit = clean(a.unit).slice(0, 20);
      row.pricing = PRICINGS.includes(a.pricing) ? a.pricing : 'item';
      row.prompt = clean(a.prompt).slice(0, 120); row.prompt_required = a.prompt_required === true || a.prompt_required === 'true';
      if (row.prompt_required && !row.prompt) return { error: `${id}: a required question needs the question text` };
    }
    out.push(row);
  }
  return { addons: out };
}

async function save(list, kind) {
  if (kind !== undefined && kind !== 'extra' && kind !== 'vendor') return { success: false, error: 'Invalid kind' };
  const { addons, error } = validate(list, kind);
  if (error) return { success: false, error };
  return db.withBookingLock(async client => {
    const ids = addons.map(a => a.id);
    // The other kind keeps its rows; ids stay unique across both kinds
    const other = kind ? (await client.query('SELECT id FROM addons WHERE kind <> $1', [kind])).rows.map(r => r.id) : [];
    const clash = ids.find(i => other.includes(i));
    if (clash) return { success: false, error: `Id "${clash}" is already used by the other list` };
    if (kind) await client.query('DELETE FROM addons WHERE kind = $1 AND NOT (id = ANY($2::text[]))', [kind, ids]);
    else await client.query('DELETE FROM addons WHERE NOT (id = ANY($1::text[]))', [ids]);
    let i = kind === 'vendor' ? 1000 : 0;
    for (const a of addons) {
      await client.query(
        `INSERT INTO addons (id, sort, name, description, price, max_qty, capacity, closes, enabled, kind, space_type, day_key, starts, ends, size, power, location, pricing, unit, prompt, prompt_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (id) DO UPDATE SET sort=EXCLUDED.sort, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price,
           max_qty=EXCLUDED.max_qty, capacity=EXCLUDED.capacity, closes=EXCLUDED.closes, enabled=EXCLUDED.enabled, kind=EXCLUDED.kind,
           space_type=EXCLUDED.space_type, day_key=EXCLUDED.day_key, starts=EXCLUDED.starts, ends=EXCLUDED.ends, size=EXCLUDED.size, power=EXCLUDED.power,
           location=EXCLUDED.location, pricing=EXCLUDED.pricing, unit=EXCLUDED.unit, prompt=EXCLUDED.prompt, prompt_required=EXCLUDED.prompt_required`,
        [a.id, i++, a.name, a.description, a.price, a.max_qty, a.capacity, a.closes, a.enabled, a.kind, a.space_type, a.day_key, a.starts, a.ends, a.size, a.power, a.location, a.pricing, a.unit, a.prompt, a.prompt_required]);
    }
    apply((await client.query('SELECT * FROM addons ORDER BY sort, id')).rows);
    return { success: true };
  });
}

// Quantity already taken per add-on by active (not cancelled) bookings.
async function usedMap(client) {
  const r = await client.query(`SELECT ba.addon_id, COALESCE(SUM(ba.qty),0)::int AS n FROM booking_addons ba
    JOIN bookings b ON b.id = ba.booking_id WHERE b.status <> 'CANCELLED' GROUP BY ba.addon_id`);
  const m = {}; r.rows.forEach(x => { m[x.addon_id] = x.n; });
  return m;
}
const isClosed = a => !!a.closes && new Date() > new Date(a.closes + 'T23:59:59');
// Vendor spaces exist only while the vendor module is switched on
const offered = a => a.enabled && (a.kind !== 'vendor' || modules.on('VENDORS'));

// What the booking page needs: offered entries with remaining capacity (extras and vendor spaces, told apart by kind).
async function publicList(client, lang) {
  const used = await usedMap(client);
  const c = (a, f, v) => (lang ? i18n.content(lang, `addon.${a.id}.${f}`, v) : v);
  return CONFIG.ADDONS.filter(offered).map(a => {
    const base = {
      id: a.id, name: a.name, description: a.description, price: a.price, maxQty: a.max_qty,
      closed: isClosed(a), left: a.capacity > 0 ? Math.max(0, a.capacity - (used[a.id] || 0)) : null, kind: a.kind,
    };
    if (a.kind !== 'vendor') return base;
    return Object.assign(base, {
      spaceType: a.space_type, dayKey: a.day_key, starts: a.starts, ends: a.ends, size: a.size, power: a.power, location: a.location,
      pricing: a.pricing, unit: a.unit, unitPrice: unitPrice(a), prompt: c(a, 'prompt', a.prompt), promptRequired: a.prompt_required,
    });
  });
}

// Validates a guest's selection ([{id, qty, note}]). Returns { items } (with name/unit price snapshot) or { error, vars }.
async function resolve(selection, client) {
  const used = await usedMap(client);
  const items = []; const seen = new Set();
  for (const s of Array.isArray(selection) ? selection : []) {
    const qty = parseInt(s && s.qty, 10);
    if (!s || !(qty >= 1)) continue;
    const a = CONFIG.ADDONS.find(x => x.id === s.id);
    if (!a || !offered(a) || seen.has(a.id)) return { error: 'err.addon', vars: { name: s && s.id } };
    seen.add(a.id);
    const nm = l => ({ name: i18n.content(l, `addon.${a.id}.name`, a.name) });
    if (isClosed(a)) return { error: 'err.addonClosed', vars: nm };
    if (qty > a.max_qty) return { error: 'err.addonQty', vars: l => Object.assign(nm(l), { max: a.max_qty }) };
    if (a.capacity > 0 && (used[a.id] || 0) + qty > a.capacity) return { error: 'err.addonFull', vars: nm };
    const note = a.kind === 'vendor' ? clean(s.note).slice(0, MAX_NOTE) : '';
    if (a.kind === 'vendor' && a.prompt_required && note.length < 2) return { error: 'err.addonNote', vars: nm };
    items.push({ id: a.id, name: a.name, qty, unit_price: unitPrice(a), note, kind: a.kind });
  }
  return { items };
}

async function forBooking(client, bookingId) {
  const r = await client.query('SELECT addon_id AS id, name, qty, unit_price, note FROM booking_addons WHERE booking_id = $1 ORDER BY addon_id', [bookingId]);
  return r.rows.map(x => ({ id: x.id, name: x.name, qty: Number(x.qty), unit_price: Number(x.unit_price), note: x.note || '' }));
}
async function replaceForBooking(client, bookingId, items) {
  await client.query('DELETE FROM booking_addons WHERE booking_id = $1', [bookingId]);
  for (const it of items) {
    await client.query('INSERT INTO booking_addons (booking_id, addon_id, qty, unit_price, name, note) VALUES ($1,$2,$3,$4,$5,$6)', [bookingId, it.id, it.qty, it.unit_price, it.name, it.note || '']);
  }
}
// Same selection at today's catalog prices (used when prices are recalculated).
const refreshPrices = items => items.map(it => { const a = CONFIG.ADDONS.find(x => x.id === it.id); return a ? Object.assign({}, it, { name: a.name, unit_price: unitPrice(a) }) : it; });

// ---- entry-ticket names (vendor helpers and companions; the booker is the contact person) ----
const MAX_TICKETS = 20;
const cleanNote = v => clean(v).slice(0, MAX_NOTE);
function cleanTickets(list) {
  const src = Array.isArray(list) ? list : String(list || '').split(/\r?\n/);
  const out = []; const seen = new Set();
  for (const n of src) {
    const name = clean(n).slice(0, 100);
    if (name.length < 2 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase()); out.push(name);
  }
  return out;
}
async function ticketsFor(client, bookingId) {
  return (await client.query('SELECT name FROM booking_tickets WHERE booking_id = $1 ORDER BY sort', [bookingId])).rows.map(r => r.name);
}
async function replaceTickets(client, bookingId, names) {
  await client.query('DELETE FROM booking_tickets WHERE booking_id = $1', [bookingId]);
  let i = 0;
  for (const n of names) await client.query('INSERT INTO booking_tickets (booking_id, sort, name) VALUES ($1,$2,$3)', [bookingId, i++, n]);
}

module.exports = { load, save, validate, publicList, resolve, forBooking, replaceForBooking, refreshPrices, usedMap, isClosed, unitPrice, offered, cleanTickets, cleanNote, ticketsFor, replaceTickets, MAX_TICKETS, SPACE_TYPES };
