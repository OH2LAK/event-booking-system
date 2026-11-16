'use strict';
// Runtime settings: defaults from config.js, overridden by rows in the "settings" table
// (this replaces Apps Script "Script Properties").
const { CONFIG } = require('./config');
const db = require('./db');
const rooms = require('./rooms');

const NUM_KEYS = [
  'SINGLE_BED_PRICE', 'MEETING_FEE_WEEKEND', 'MEETING_FEE_DAY', 'FULL_BOARD_PRICE', 'CAMPER_VAN_PRICE_PER_NIGHT', 'TENT_PRICE_WEEKEND',
];
const INT_KEYS = ['SINGLE_BED_SLOTS', 'CAMPER_VAN_SPOTS', 'TENT_SPOTS'];
const TEXT_KEYS = ['ANNOUNCEMENT', 'CLOSED_MESSAGE', 'BYPASS_TOKEN', 'CAMPER_INFO', 'TENT_INFO', 'PRICE_DISCLAIMER', 'REGISTRATION_CLOSES'];
const BOOL_KEYS = ['REGISTRATION_OPEN', 'ALLOW_SOLO_DOUBLE', 'ALLOW_SINGLE_BED_BOOKING', 'TENT_ENABLED'];

async function loadRaw(client) {
  const res = await (client || db).query('SELECT key, value FROM settings');
  const map = {};
  res.rows.forEach(r => { map[r.key] = r.value; });
  return map;
}

async function getSettings(client) {
  const p = await loadRaw(client);
  const has = k => Object.prototype.hasOwnProperty.call(p, k);
  const num = (k, def) => (has(k) && p[k] !== '' ? parseFloat(p[k]) : def);
  const int = (k, def) => (has(k) && p[k] !== '' ? parseInt(p[k], 10) : def);
  const txt = (k, def) => (has(k) ? p[k] : def);

  const closes = p.REGISTRATION_CLOSES || '';
  let open = p.REGISTRATION_OPEN !== 'false';
  if (open && closes && new Date() > new Date(closes + 'T23:59:59')) open = false;

  const s = {
    REGISTRATION_OPEN: open,
    REGISTRATION_CLOSES: closes,
    ALLOW_SOLO_DOUBLE: p.ALLOW_SOLO_DOUBLE === 'true' || CONFIG.ALLOW_SOLO_DOUBLE,
    ALLOW_SINGLE_BED_BOOKING: p.ALLOW_SINGLE_BED_BOOKING === 'true' || CONFIG.ALLOW_SINGLE_BED_BOOKING,
    TENT_ENABLED: p.TENT_ENABLED !== 'false',
    ANNOUNCEMENT: p.ANNOUNCEMENT || '',
    CLOSED_MESSAGE: p.CLOSED_MESSAGE || '',
    BYPASS_TOKEN: p.BYPASS_TOKEN || '',
    CAMPER_INFO: txt('CAMPER_INFO', CONFIG.CAMPER_INFO),
    TENT_INFO: txt('TENT_INFO', CONFIG.TENT_INFO),
    PRICE_DISCLAIMER: txt('PRICE_DISCLAIMER', 'Prices may be updated. You will be notified of any changes affecting your booking.'),
    SINGLE_BED_PRICE: num('SINGLE_BED_PRICE', CONFIG.SINGLE_BED_PRICE),
    SINGLE_BED_SLOTS: int('SINGLE_BED_SLOTS', CONFIG.SINGLE_BED_SLOTS),
    MEETING_FEE_WEEKEND: num('MEETING_FEE_WEEKEND', CONFIG.MEETING_FEE_WEEKEND),
    MEETING_FEE_DAY: num('MEETING_FEE_DAY', CONFIG.MEETING_FEE_DAY),
    FULL_BOARD_PRICE: num('FULL_BOARD_PRICE', CONFIG.FULL_BOARD_PRICE),
    CAMPER_VAN_PRICE_PER_NIGHT: num('CAMPER_VAN_PRICE_PER_NIGHT', CONFIG.CAMPER_VAN_PRICE_PER_NIGHT),
    TENT_PRICE_WEEKEND: num('TENT_PRICE_WEEKEND', CONFIG.TENT_PRICE_WEEKEND),
    CAMPER_VAN_SPOTS: int('CAMPER_VAN_SPOTS', CONFIG.CAMPER_VAN_SPOTS),
    TENT_SPOTS: int('TENT_SPOTS', CONFIG.TENT_SPOTS),
    ROOM_PRICES: {},
    ROOM_COUNTS: {},
  };
  CONFIG.ROOMS.forEach(r => {
    s.ROOM_PRICES[r.id] = r.price_eur;
    s.ROOM_COUNTS[r.id] = r.count;
  });
  return s;
}

async function setKey(key, value) {
  await db.query(
    'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, String(value)]
  );
}
async function deleteKey(key) { await db.query('DELETE FROM settings WHERE key = $1', [key]); }

// Same semantics as the original saveAdminSettings (undefined = untouched).
async function saveSettings(input) {
  const present = v => v !== undefined && v !== '' && v !== null;
  for (const k of BOOL_KEYS) if (input[k] !== undefined) await setKey(k, input[k] ? 'true' : 'false');
  for (const k of TEXT_KEYS) if (input[k] !== undefined) await setKey(k, input[k] === null ? '' : input[k]);
  for (const k of NUM_KEYS) if (present(input[k]) && !isNaN(parseFloat(input[k]))) await setKey(k, parseFloat(input[k]));
  for (const k of INT_KEYS) if (present(input[k]) && !isNaN(parseInt(input[k], 10))) await setKey(k, Math.max(0, parseInt(input[k], 10)));
  if (input.ROOM_COUNTS || input.ROOM_PRICES) await rooms.updateCountsPrices(input.ROOM_COUNTS, input.ROOM_PRICES);
}

module.exports = { getSettings, saveSettings, setKey };
