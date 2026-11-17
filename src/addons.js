'use strict';
// Optional extras (meals, excursions, workshops ...) the organizer offers. Catalog in table addons,
// mirrored into CONFIG.ADDONS; what a booking chose is stored in booking_addons (name and price are a snapshot).
const { CONFIG } = require('./config');
const db = require('./db');
const i18n = require('./i18n');

const toCfg = r => ({
  id: r.id, name: r.name, description: r.description || '', price: Number(r.price),
  max_qty: Number(r.max_qty), capacity: Number(r.capacity),
  closes: r.closes ? (r.closes instanceof Date ? r.closes.toISOString().slice(0, 10) : String(r.closes).slice(0, 10)) : '',
  enabled: !!r.enabled,
});
function apply(rows) { CONFIG.ADDONS = rows.map(toCfg); }
async function load() { apply((await db.query('SELECT * FROM addons ORDER BY sort, id')).rows); }

const clean = s => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();

function validate(list) {
  if (!Array.isArray(list)) return { error: 'Invalid list' };
  if (list.length > 30) return { error: 'Too many extras (max 30)' };
  const seen = new Set(); const out = [];
  for (const a of list) {
    const id = String(a.id || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,11}$/.test(id)) return { error: `Invalid id "${id}" (letters, digits and "-", max 12 characters)` };
    if (seen.has(id)) return { error: `Duplicate id "${id}"` };
    seen.add(id);
    const name = clean(a.name); const description = clean(a.description);
    if (!name || name.length > 60) return { error: `${id}: name is required (max 60 characters)` };
    if (description.length > 200) return { error: `${id}: description is too long (max 200 characters)` };
    const price = parseFloat(a.price === '' || a.price === undefined ? 0 : a.price);
    const maxQty = parseInt(a.max_qty === '' || a.max_qty === undefined ? 1 : a.max_qty, 10);
    const capacity = parseInt(a.capacity === '' || a.capacity === undefined ? 0 : a.capacity, 10);
    if (!(price >= 0 && price <= 100000)) return { error: `${id}: price must be 0-100000` };
    if (!(maxQty >= 1 && maxQty <= 20)) return { error: `${id}: max per booking must be 1-20` };
    if (!(capacity >= 0 && capacity <= 99999)) return { error: `${id}: capacity must be 0-99999 (0 = unlimited)` };
    const closes = String(a.closes || '').trim();
    if (closes && (!/^\d{4}-\d{2}-\d{2}$/.test(closes) || isNaN(Date.parse(closes + 'T00:00:00Z')))) return { error: `${id}: deadline must be a date like 2027-05-10` };
    out.push({ id, name, description, price, max_qty: maxQty, capacity, closes: closes || null, enabled: a.enabled === true || a.enabled === 'true' || a.enabled === 'YES' });
  }
  return { addons: out };
}

async function save(list) {
  const { addons, error } = validate(list);
  if (error) return { success: false, error };
  return db.withBookingLock(async client => {
    const ids = addons.map(a => a.id);
    await client.query('DELETE FROM addons WHERE NOT (id = ANY($1::text[]))', [ids]);
    let i = 0;
    for (const a of addons) {
      await client.query(
        `INSERT INTO addons (id, sort, name, description, price, max_qty, capacity, closes, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET sort=EXCLUDED.sort, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price,
           max_qty=EXCLUDED.max_qty, capacity=EXCLUDED.capacity, closes=EXCLUDED.closes, enabled=EXCLUDED.enabled`,
        [a.id, i++, a.name, a.description, a.price, a.max_qty, a.capacity, a.closes, a.enabled]);
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

// What the booking page needs: enabled extras with remaining capacity.
async function publicList(client) {
  const used = await usedMap(client);
  return CONFIG.ADDONS.filter(a => a.enabled).map(a => ({
    id: a.id, name: a.name, description: a.description, price: a.price, maxQty: a.max_qty,
    closed: isClosed(a), left: a.capacity > 0 ? Math.max(0, a.capacity - (used[a.id] || 0)) : null,
  }));
}

// Validates a guest's selection ([{id, qty}]). Returns { items } (with name/unit price snapshot) or { error, vars }.
async function resolve(selection, client) {
  const used = await usedMap(client);
  const items = []; const seen = new Set();
  for (const s of Array.isArray(selection) ? selection : []) {
    const qty = parseInt(s && s.qty, 10);
    if (!s || !(qty >= 1)) continue;
    const a = CONFIG.ADDONS.find(x => x.id === s.id);
    if (!a || !a.enabled || seen.has(a.id)) return { error: 'err.addon', vars: { name: s && s.id } };
    seen.add(a.id);
    if (isClosed(a)) return { error: 'err.addonClosed', vars: l => ({ name: i18n.content(l, `addon.${a.id}.name`, a.name) }) };
    if (qty > a.max_qty) return { error: 'err.addonQty', vars: l => ({ name: i18n.content(l, `addon.${a.id}.name`, a.name), max: a.max_qty }) };
    if (a.capacity > 0 && (used[a.id] || 0) + qty > a.capacity) return { error: 'err.addonFull', vars: l => ({ name: i18n.content(l, `addon.${a.id}.name`, a.name) }) };
    items.push({ id: a.id, name: a.name, qty, unit_price: a.price });
  }
  return { items };
}

async function forBooking(client, bookingId) {
  const r = await client.query('SELECT addon_id AS id, name, qty, unit_price FROM booking_addons WHERE booking_id = $1 ORDER BY addon_id', [bookingId]);
  return r.rows.map(x => ({ id: x.id, name: x.name, qty: Number(x.qty), unit_price: Number(x.unit_price) }));
}
async function replaceForBooking(client, bookingId, items) {
  await client.query('DELETE FROM booking_addons WHERE booking_id = $1', [bookingId]);
  for (const it of items) {
    await client.query('INSERT INTO booking_addons (booking_id, addon_id, qty, unit_price, name) VALUES ($1,$2,$3,$4,$5)', [bookingId, it.id, it.qty, it.unit_price, it.name]);
  }
}
// Same selection at today's catalog prices (used when prices are recalculated).
const refreshPrices = items => items.map(it => { const a = CONFIG.ADDONS.find(x => x.id === it.id); return a ? Object.assign({}, it, { name: a.name, unit_price: a.price }) : it; });

module.exports = { load, save, validate, publicList, resolve, forBooking, replaceForBooking, refreshPrices, usedMap, isClosed };
