'use strict';
// Event identity and branding. Stored in the database (table event_config), edited in the admin panel
// ("Event setup") and applied onto the shared CONFIG object so every module sees the current values.
const { CONFIG } = require('./config');
const db = require('./db');

// type: text | textarea | url | email | color
const FIELDS = [
  { group: 'Event', key: 'EVENT_NAME', label: 'Event name (full)', type: 'text', max: 120, help: 'Shown in page titles, headings and emails.' },
  { group: 'Event', key: 'EVENT_SHORT', label: 'Event name (short)', type: 'text', max: 60, help: 'Used in email subjects, e.g. "[Short name] Booking confirmation".' },
  { group: 'Event', key: 'ORGANIZER', label: 'Organizer (full)', type: 'text', max: 150 },
  { group: 'Event', key: 'ORGANIZER_SHORT', label: 'Organizer (short)', type: 'text', max: 40 },
  { group: 'Event', key: 'LOCATION', label: 'Venue (full)', type: 'text', max: 150, help: 'e.g. venue, city, country.' },
  { group: 'Event', key: 'LOCATION_SHORT', label: 'Venue (short)', type: 'text', max: 60, help: 'Usually the city.' },
  { group: 'Dates and days', key: 'DATES_TEXT', label: 'Event dates (short text)', type: 'text', max: 60, help: 'e.g. 13-16 May 2027' },
  { group: 'Dates and days', key: 'DATE_THU', label: 'Extra night day (Thursday)', type: 'text', max: 60 },
  { group: 'Dates and days', key: 'DATE_FRI', label: 'Day 1 (Friday)', type: 'text', max: 60 },
  { group: 'Dates and days', key: 'DATE_SAT', label: 'Day 2 (Saturday)', type: 'text', max: 60 },
  { group: 'Dates and days', key: 'DATE_SUN', label: 'Day 3 (Sunday)', type: 'text', max: 60 },
  { group: 'Dates and days', key: 'DAY_FRI_SHORT', label: 'Day 1 label for day visitors', type: 'text', max: 40, help: 'e.g. "Friday 14.5"' },
  { group: 'Dates and days', key: 'DAY_SAT_SHORT', label: 'Day 2 label for day visitors', type: 'text', max: 40, help: 'e.g. "Saturday 15.5"' },
  { group: 'Dates and days', key: 'THU_NIGHT_LABEL', label: 'Extra night label', type: 'text', max: 30, help: 'e.g. "13.5 -> 14.5"' },
  { group: 'Dates and days', key: 'THU_EXTRA_INCLUDES', label: 'Extra night includes', type: 'text', max: 100, help: 'e.g. "Includes Friday breakfast"' },
  { group: 'Dates and days', key: 'CHECKIN_TIME', label: 'Check-in text', type: 'text', max: 100 },
  { group: 'Dates and days', key: 'CHECKOUT_TIME', label: 'Check-out text', type: 'text', max: 100 },
  { group: 'Meals', key: 'MEAL_PACKAGE_SUB', label: 'Meal package summary (booking form)', type: 'text', max: 120, help: 'One line under the meal package option.' },
  { group: 'Meals', key: 'MEAL_INCLUDES', label: 'Meal package contents (emails)', type: 'textarea', max: 600, help: 'One item per line.' },
  { group: 'Contact and email', key: 'REPLY_TO_EMAIL', label: 'Organizer email', type: 'email', max: 150, help: 'Reply-To address; organizer notifications are sent here.' },
  { group: 'Contact and email', key: 'EMAIL_SENDER_NAME', label: 'Email sender name', type: 'text', max: 80 },
  { group: 'Branding', key: 'LOGO1_URL', label: 'Logo 1 (image URL, https)', type: 'url', max: 300, help: 'Optional.' },
  { group: 'Branding', key: 'LOGO2_URL', label: 'Logo 2 (image URL, https)', type: 'url', max: 300, help: 'Optional.' },
  { group: 'Branding', key: 'ACCENT_COLOR', label: 'Accent color', type: 'color', max: 7, help: 'Hex color, e.g. #b45309' },
  { group: 'Branding', key: 'HOME_URL', label: 'Event home page URL', type: 'url', max: 300, help: 'Adds a back link on the booking pages. Empty = no link.' },
  { group: 'Branding', key: 'HOME_LABEL', label: 'Home page link text', type: 'text', max: 60 },
];

const DEFAULT_INCLUDES = 'Friday: dinner\nSaturday: lunch + dinner\nNote: breakfast is included in all room prices';

function defaults() {
  const d = {};
  FIELDS.forEach(f => { d[f.key] = CONFIG[f.key] === undefined ? '' : CONFIG[f.key]; });
  d.MEAL_INCLUDES = (CONFIG.FULL_BOARD_INCLUDES_EN || []).join('\n') || DEFAULT_INCLUDES;
  return d;
}
const BASE = defaults(); // placeholder defaults from config.js, captured once

let configured = false;

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
}

function apply(values) {
  FIELDS.forEach(f => { if (f.key !== 'MEAL_INCLUDES') CONFIG[f.key] = values[f.key]; });
  CONFIG.FULL_BOARD_INCLUDES_EN = String(values.MEAL_INCLUDES || '').split('\n').map(x => x.trim()).filter(Boolean);
  CONFIG.SLUG = slugify(values.EVENT_SHORT);
  if (!CONFIG.REPLY_TO_EMAIL && process.env.REPLY_TO_EMAIL) CONFIG.REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL;
}

async function load() {
  const r = await db.query('SELECT config FROM event_config WHERE id = 1');
  configured = r.rows.length > 0;
  apply(Object.assign({}, BASE, configured ? r.rows[0].config : {}));
  return configured;
}

function current() {
  const v = {};
  FIELDS.forEach(f => { v[f.key] = f.key === 'MEAL_INCLUDES' ? CONFIG.FULL_BOARD_INCLUDES_EN.join('\n') : CONFIG[f.key]; });
  return v;
}

function validate(input) {
  const out = {};
  for (const f of FIELDS) {
    let v = input[f.key] === undefined || input[f.key] === null ? '' : String(input[f.key]);
    v = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[<>]/g, '');
    v = f.type === 'textarea' ? v.replace(/\r/g, '').trim() : v.replace(/\s+/g, ' ').trim();
    if (v.length > f.max) return { error: `${f.label} is too long (max ${f.max} characters)` };
    if (f.type === 'url' && v && !/^https?:\/\/[^\s"'`]+$/i.test(v)) return { error: `${f.label} must start with http:// or https://` };
    if (f.type === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { error: `${f.label} is not a valid email address` };
    if (f.type === 'color' && !/^#[0-9a-fA-F]{6}$/.test(v)) return { error: `${f.label} must be a hex color like #b45309` };
    if (['EVENT_NAME', 'EVENT_SHORT', 'ORGANIZER'].includes(f.key) && !v) return { error: `${f.label} is required` };
    out[f.key] = v;
  }
  return { values: out };
}

async function save(input) {
  const { values, error } = validate(input || {});
  if (error) return { success: false, error };
  await db.query(
    `INSERT INTO event_config (id, config, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
    [JSON.stringify(values)]
  );
  configured = true;
  apply(values);
  return { success: true };
}

module.exports = { FIELDS, load, save, current, isConfigured: () => configured };
