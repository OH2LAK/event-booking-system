'use strict';
// Room catalog stored in the database (table room_types) and mirrored into CONFIG.ROOMS.
// First start: seeded from the defaults in config.js (plus any old ROOM_COUNT_/ROOM_PRICE_ settings overrides).
const { CONFIG } = require('./config');
const db = require('./db');

const DEFAULTS = CONFIG.ROOMS.map(r => ({ ...r }));

const toCfg = r => ({
  id: r.id, persons: Number(r.persons), count: Number(r.count), price_eur: Number(r.price_eur),
  note_en: r.note_en, note_fi: r.note_fi || '',
});

function apply(rows) {
  CONFIG.ROOMS.splice(0, CONFIG.ROOMS.length, ...rows.map(toCfg));
}

async function load() {
  const init = await db.query("SELECT 1 FROM settings WHERE key = 'ROOMS_INITIALIZED'");
  if (!init.rows.length) {
    const ov = {};
    (await db.query("SELECT key, value FROM settings WHERE key LIKE 'ROOM\\_COUNT\\_%' OR key LIKE 'ROOM\\_PRICE\\_%'")).rows
      .forEach(r => { ov[r.key] = r.value; });
    let i = 0;
    for (const d of DEFAULTS) {
      const count = ov['ROOM_COUNT_' + d.id] !== undefined ? parseInt(ov['ROOM_COUNT_' + d.id], 10) : d.count;
      const price = ov['ROOM_PRICE_' + d.id] !== undefined ? parseFloat(ov['ROOM_PRICE_' + d.id]) : d.price_eur;
      await db.query(
        'INSERT INTO room_types (id, sort, persons, count, price_eur, note_en, note_fi) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
        [d.id, i++, d.persons, count, price, d.note_en, d.note_fi || '']);
    }
    await db.query("INSERT INTO settings (key, value) VALUES ('ROOMS_INITIALIZED','1') ON CONFLICT (key) DO NOTHING");
  }
  const res = await db.query('SELECT * FROM room_types ORDER BY sort, id');
  apply(res.rows);
}

function validate(list) {
  if (!Array.isArray(list)) return { error: 'Invalid room list' };
  if (list.length > 40) return { error: 'Too many room types (max 40)' };
  const seen = new Set(); const out = [];
  for (const r of list) {
    const id = String(r.id || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,11}$/.test(id)) return { error: `Invalid id "${id}" (letters, digits and "-", max 12 characters)` };
    if (seen.has(id.toLowerCase())) return { error: `Duplicate id "${id}"` };
    seen.add(id.toLowerCase());
    const clean = s => String(s || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
    const note_en = clean(r.note_en); const note_fi = clean(r.note_fi);
    if (!note_en || note_en.length > 80) return { error: `${id}: description is required (max 80 characters)` };
    if (note_fi.length > 80) return { error: `${id}: Finnish description is too long (max 80 characters)` };
    const persons = parseInt(r.persons, 10); const count = parseInt(r.count, 10); const price = parseFloat(r.price_eur);
    if (!(persons >= 1 && persons <= 20)) return { error: `${id}: persons must be 1-20` };
    if (!(count >= 0 && count <= 999)) return { error: `${id}: count must be 0-999` };
    if (!(price >= 0 && price <= 100000)) return { error: `${id}: price must be 0-100000` };
    out.push({ id, persons, count, price_eur: price, note_en, note_fi });
  }
  return { rooms: out };
}

async function save(list) {
  const { rooms, error } = validate(list);
  if (error) return { success: false, error };
  return db.withBookingLock(async client => {
    const used = (await client.query("SELECT room_id, count(*)::int AS n FROM bookings WHERE room_id <> '' GROUP BY room_id")).rows;
    const usedMap = {}; used.forEach(u => { usedMap[u.room_id] = u.n; });
    const old = (await client.query('SELECT id, persons FROM room_types')).rows;
    const oldMap = {}; old.forEach(o => { oldMap[o.id] = o.persons; });
    const newIds = new Set(rooms.map(r => r.id));
    for (const o of old) {
      if (!newIds.has(o.id) && usedMap[o.id]) return { success: false, error: `Cannot delete ${o.id}: it has ${usedMap[o.id]} booking(s). Set its count to 0 instead.` };
    }
    for (const r of rooms) {
      if (oldMap[r.id] !== undefined && oldMap[r.id] !== r.persons && usedMap[r.id]) {
        return { success: false, error: `Cannot change persons of ${r.id}: it already has bookings.` };
      }
      if (oldMap[r.id] === undefined && usedMap[r.id]) return { success: false, error: `Id ${r.id} is used by existing bookings.` };
    }
    await client.query('DELETE FROM room_types');
    let i = 0;
    for (const r of rooms) {
      await client.query('INSERT INTO room_types (id, sort, persons, count, price_eur, note_en, note_fi) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [r.id, i++, r.persons, r.count, r.price_eur, r.note_en, r.note_fi]);
    }
    apply(rooms);
    return { success: true };
  });
}

// Quick edit of counts/prices only (the existing "Room inventory" and "Pricing" grids).
async function updateCountsPrices(counts, prices) {
  for (const r of CONFIG.ROOMS) {
    const c = counts && counts[r.id]; const p = prices && prices[r.id];
    if (c !== undefined && c !== '' && !isNaN(parseInt(c, 10))) {
      r.count = Math.max(0, parseInt(c, 10));
      await db.query('UPDATE room_types SET count = $2 WHERE id = $1', [r.id, r.count]);
    }
    if (p !== undefined && p !== '' && !isNaN(parseFloat(p))) {
      r.price_eur = Math.max(0, parseFloat(p));
      await db.query('UPDATE room_types SET price_eur = $2 WHERE id = $1', [r.id, r.price_eur]);
    }
  }
}

module.exports = { load, save, updateCountsPrices, validate };
