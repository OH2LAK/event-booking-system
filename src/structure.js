'use strict';
// Event structure: the days of the event, optional extra nights before/after, and the meal package.
// Stored in table event_structure and mirrored into CONFIG.STRUCTURE.
//   days        core event days (1-7), e.g. [{key:'d1', label:'Friday 14 May', short:'Fri 14.5.'}, ...]
//   accommodation 'period' (room price covers all core nights) or 'per_night' (guests pick core nights; price and availability per night)
//   coreNights  nights covered by the room price (default = number of days; in per_night mode always = number of days)
//   extraNights optional additional nights, each priced as room price / coreNights
//   package     optional meal package (price itself is the FULL_BOARD_PRICE setting)
const { CONFIG } = require('./config');
const db = require('./db');

const genericStructure = () => ({
  days: [{ key: 'd1', label: 'Day 1', short: 'Day 1' }, { key: 'd2', label: 'Day 2', short: 'Day 2' }],
  accommodation: 'period',
  coreNights: 2,
  extraNights: [],
  package: { enabled: true, sub: 'Meals during the event', includes: ['Day 1: dinner', 'Day 2: lunch + dinner'] },
});

// Existing installs (bookings already exist, no structure saved yet) keep the original Fri/Sat + Thursday shape,
// so stored bookings (keys fri, sat, thu) stay valid. Labels come from the old Event setup values when present.
function legacyStructure(stored) {
  const c = k => (stored && stored[k]) || CONFIG[k] || '';
  const includes = String(c('MEAL_INCLUDES') || (CONFIG.FULL_BOARD_INCLUDES_EN || []).join('\n'))
    .split('\n').map(x => x.trim()).filter(Boolean);
  return {
    days: [
      { key: 'fri', label: c('DATE_FRI') || 'Friday', short: c('DAY_FRI_SHORT') || 'Friday' },
      { key: 'sat', label: c('DATE_SAT') || 'Saturday', short: c('DAY_SAT_SHORT') || 'Saturday' },
    ],
    accommodation: 'period',
    coreNights: 2,
    extraNights: [{ key: 'thu', label: c('THU_NIGHT_LABEL') ? 'Thursday night (' + c('THU_NIGHT_LABEL') + ')' : 'Thursday night', includes: c('THU_EXTRA_INCLUDES') || 'Includes Friday breakfast' }],
    package: { enabled: true, sub: c('MEAL_PACKAGE_SUB') || 'Meal package', includes },
  };
}

function apply(st) {
  if (!st.accommodation) st.accommodation = 'period';
  CONFIG.STRUCTURE = st;
  CONFIG.CAMPING_NIGHTS = st.coreNights;
  CONFIG.FULL_BOARD_INCLUDES_EN = st.package.includes.slice();
  CONFIG.MEAL_PACKAGE_SUB = st.package.sub;
}

async function load() {
  let r = await db.query('SELECT structure FROM event_structure WHERE id = 1');
  if (!r.rows.length) {
    const n = (await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n;
    let st;
    if (n > 0) {
      const ec = await db.query('SELECT config FROM event_config WHERE id = 1');
      st = legacyStructure(ec.rows.length ? ec.rows[0].config : null);
    } else st = genericStructure();
    await db.query('INSERT INTO event_structure (id, structure) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(st)]);
    r = await db.query('SELECT structure FROM event_structure WHERE id = 1');
  }
  apply(r.rows[0].structure);
}

const clean = (s, max) => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

function validate(input) {
  input = input || {};
  const nextKey = (prefix, used) => { let i = 1; while (used.has(prefix + i)) i++; return prefix + i; };
  const build = (list, prefix, max, mapper) => {
    if (!Array.isArray(list) || list.length > max) return { error: `Invalid list (max ${max} entries)` };
    const used = new Set(list.map(x => String(x.key || '')).filter(Boolean));
    const seen = new Set(); const out = [];
    for (const x of list) {
      let key = String(x.key || '').trim();
      if (!key) key = nextKey(prefix, used), used.add(key);
      if (!/^[a-z0-9]{1,10}$/.test(key)) return { error: `Invalid key "${key}"` };
      if (seen.has(key)) return { error: `Duplicate key "${key}"` };
      seen.add(key);
      const m = mapper(x, key); if (m.error) return m;
      out.push(m.value);
    }
    return { value: out };
  };
  const days = build(input.days, 'd', 7, (x, key) => {
    const label = clean(x.label, 60); const short = clean(x.short, 40) || label;
    return label ? { value: { key, label, short } } : { error: 'Every day needs a label' };
  });
  if (days.error) return days;
  if (!days.value.length) return { error: 'At least one event day is required' };
  const extras = build(input.extraNights || [], 'x', 6, (x, key) => {
    const label = clean(x.label, 60);
    return label ? { value: { key, label, includes: clean(x.includes, 100) } } : { error: 'Every extra night needs a label' };
  });
  if (extras.error) return extras;
  const accommodation = input.accommodation === 'per_night' ? 'per_night' : 'period';
  // In per-night mode each event day has one night (the night after it), so the nights equal the days.
  const coreNights = accommodation === 'per_night' ? days.value.length : parseInt(input.coreNights, 10);
  if (!(coreNights >= 1 && coreNights <= 14)) return { error: 'Nights included in the room price must be 1-14' };
  const p = input.package || {};
  const includes = (Array.isArray(p.includes) ? p.includes : String(p.includes || '').split('\n')).map(l => clean(l, 80)).filter(Boolean).slice(0, 12);
  return { structure: { days: days.value, accommodation, coreNights, extraNights: extras.value, package: { enabled: !!p.enabled, sub: clean(p.sub, 120), includes } } };
}

async function save(input) {
  const { structure, error } = validate(input);
  if (error) return { success: false, error };
  return db.withBookingLock(async client => {
    const rows = (await client.query("SELECT extra_nights, visitor_days, nights FROM bookings WHERE extra_nights <> '' OR visitor_days <> '' OR nights <> ''")).rows;
    const usedX = new Set(); const usedD = new Set();
    rows.forEach(r => {
      r.extra_nights.split(',').filter(Boolean).forEach(k => usedX.add(k));
      r.visitor_days.split(',').filter(Boolean).forEach(k => usedD.add(k));
      r.nights.split(',').filter(Boolean).forEach(k => usedD.add(k));
    });
    if (structure.accommodation === 'period' && rows.some(r => r.nights)) {
      return { success: false, error: 'Cannot switch back to whole-period booking: some bookings have individually selected nights.' };
    }
    const newX = new Set(structure.extraNights.map(x => x.key)); const newD = new Set(structure.days.map(x => x.key));
    for (const k of usedX) if (!newX.has(k)) return { success: false, error: `Cannot remove extra night "${k}": existing bookings use it.` };
    for (const k of usedD) if (!newD.has(k)) return { success: false, error: `Cannot remove day "${k}": existing day-visitor bookings use it.` };
    await client.query(
      `INSERT INTO event_structure (id, structure, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET structure = EXCLUDED.structure, updated_at = now()`, [JSON.stringify(structure)]);
    apply(structure);
    return { success: true };
  });
}

// Helpers used by pricing, availability, emails and reports.
const mode = () => (CONFIG.STRUCTURE.accommodation === 'per_night' ? 'per_night' : 'period');
const dayByKey = k => (CONFIG.STRUCTURE.days.find(d => d.key === k) || { key: k, label: k, short: k });
const extraByKey = k => (CONFIG.STRUCTURE.extraNights.find(x => x.key === k) || { key: k, label: k, includes: '' });
const keys = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
// Keep only keys that exist in the structure, in structure order.
const pickDays = list => CONFIG.STRUCTURE.days.map(d => d.key).filter(k => keys(Array.isArray(list) ? list.join(',') : list).includes(k));
const pickExtras = list => CONFIG.STRUCTURE.extraNights.map(x => x.key).filter(k => keys(Array.isArray(list) ? list.join(',') : list).includes(k));

const coreNightKeys = () => CONFIG.STRUCTURE.days.slice(0, CONFIG.STRUCTURE.coreNights).map(d => d.key);
const allNightKeys = () => coreNightKeys().concat(CONFIG.STRUCTURE.extraNights.map(x => x.key));
const pickNights = list => coreNightKeys().filter(k => keys(Array.isArray(list) ? list.join(',') : list).includes(k));
// Nights a room-type booking occupies: its core nights (empty / whole-period = all) plus its extra nights.
const nightsOf = b => {
  const own = mode() === 'per_night' ? pickNights(b.nights) : [];
  return (own.length ? own : coreNightKeys()).concat(pickExtras(b.extraNights));
};
const nightLabel = k => {
  const x = CONFIG.STRUCTURE.extraNights.find(y => y.key === k);
  return x ? x.label : 'Night of ' + dayByKey(k).short;
};
// Occupied rooms per night for one room type (only primary bookers hold a room).
function occupancy(bookings, roomId) {
  const occ = {}; allNightKeys().forEach(k => { occ[k] = 0; });
  bookings.filter(b => b.roomId === roomId && b.isPrimaryBooker === 'YES' && b.type === 'room')
    .forEach(b => nightsOf(b).forEach(k => { occ[k] = (occ[k] || 0) + 1; }));
  return occ;
}

module.exports = { load, save, validate, genericStructure, legacyStructure, dayByKey, extraByKey, keys, pickDays, pickExtras, mode, coreNightKeys, allNightKeys, pickNights, nightsOf, nightLabel, occupancy };
