'use strict';
// Event identity and branding. Stored in the database (table event_config), edited in the admin panel
// ("Event setup") and applied onto the shared CONFIG object so every module sees the current values.
const { CONFIG } = require('./config');
const db = require('./db');
const I18N = require('./i18n');

// type: text | textarea | url | email | color | date | number
const FIELDS = [
  { group: 'Event', key: 'EVENT_NAME', label: 'Event name (full)', type: 'text', max: 120, help: 'Shown in page titles, headings and emails.' },
  { group: 'Event', key: 'EVENT_SHORT', label: 'Event name (short)', type: 'text', max: 60, help: 'Used in email subjects, e.g. "[Short name] Booking confirmation".' },
  { group: 'Event', key: 'ORGANIZER', label: 'Organizer (full)', type: 'text', max: 150 },
  { group: 'Event', key: 'ORGANIZER_SHORT', label: 'Organizer (short)', type: 'text', max: 40 },
  { group: 'Event', key: 'LOCATION', label: 'Venue (full)', type: 'text', max: 150, help: 'e.g. venue, city, country.' },
  { group: 'Event', key: 'LOCATION_SHORT', label: 'Venue (short)', type: 'text', max: 60, help: 'Usually the city.' },
  { group: 'Event', key: 'EVENT_MODE', label: 'Event type', type: 'select', max: 10, options: [['overnight', 'Overnight event (rooms, camping, nights)'], ['day', 'One-day event (registration and optional extras only)']], help: 'A one-day event hides rooms, camping and nights: guests register, and can add optional extras such as meals (set them up in the "Extras" card). For a one-day event define a single day in "Event structure".' },
  { group: 'Dates and times', key: 'DATES_TEXT', label: 'Event dates (short text)', type: 'text', max: 60, help: 'e.g. 13-16 May 2027' },
  { group: 'Dates and times', key: 'CHECKIN_TIME', label: 'Check-in text', type: 'text', max: 100 },
  { group: 'Dates and times', key: 'CHECKOUT_TIME', label: 'Check-out text', type: 'text', max: 100 },
  { group: 'Languages', key: 'LANGUAGES', label: 'Enabled languages', type: 'langs', max: 60, help: 'Comma-separated codes: en, fi, sv, no, da, is, et, lv, lt, pl, de. Guests can switch between them on the booking pages.' },
  { group: 'Languages', key: 'DEFAULT_LANGUAGE', label: 'Default language', type: 'text', max: 2, help: 'One of the enabled codes. Event texts you enter in this panel (event name, announcement, ...) are in this language; translate them in "Translations".' },
  { group: 'Payments', key: 'PAYMENT_INFO', label: 'How guests pay', type: 'textarea', max: 300, help: 'Shown on the booking page and in the confirmation email, e.g. "Pay at the door by card or cash." Online payment is not available yet; mark bookings as paid in the booking list.' },
  { group: 'Currency', key: 'CURRENCY', label: 'Native currency (ISO code)', type: 'currency', max: 3, help: 'The currency of all prices and of the payment, e.g. EUR, SEK, NOK, DKK, ISK, PLN. Enter the room, meal and fee prices in this currency. Changing it does not convert existing prices.' },
  { group: 'Currency', key: 'CURRENCIES', label: 'Extra currencies for guests (optional)', type: 'currencies', max: 60, help: 'Comma-separated ISO codes, e.g. USD, GBP, SEK. Guests can pick one to see an approximate conversion; payment is always in the native currency. Set the rates in the "Currencies" card below.' },
  { group: 'Contact and email', key: 'REPLY_TO_EMAIL', label: 'Organizer email', type: 'email', max: 150, help: 'Reply-To address; organizer notifications are sent here.' },
  { group: 'Contact and email', key: 'EMAIL_SENDER_NAME', label: 'Email sender name', type: 'text', max: 80 },
  { group: 'Privacy and data retention', key: 'CONTROLLER_NAME', label: 'Data controller (name)', type: 'text', max: 150, help: 'Who is responsible for the personal data collected here. Empty = organizer name.' },
  { group: 'Privacy and data retention', key: 'CONTROLLER_ADDRESS', label: 'Data controller (postal address)', type: 'text', max: 200, help: 'Optional, shown in the privacy notice.' },
  { group: 'Privacy and data retention', key: 'PRIVACY_CONTACT_EMAIL', label: 'Privacy contact email', type: 'email', max: 150, help: 'Where people send access, correction and erasure requests. Empty = organizer email.' },
  { group: 'Privacy and data retention', key: 'PRIVACY_URL', label: 'Own privacy notice URL (optional)', type: 'url', max: 300, help: 'If set, the booking form links to this page instead of the built-in notice. The built-in notice stays available at /privacy.' },
  { group: 'Privacy and data retention', key: 'EVENT_END_DATE', label: 'Last day of the event', type: 'date', max: 10, help: 'Starts the retention clock. Personal data must be erased no later than the retention period after this date.' },
  { group: 'Privacy and data retention', key: 'RETENTION_DAYS', label: 'Retention after the event (days)', type: 'number', max: 3, help: 'Default 30, maximum 365.' },
  { group: 'Privacy and data retention', key: 'RETENTION_HOLD', label: 'Retention hold (open matter)', type: 'text', max: 200, help: 'Normally empty. If a dispute or similar matter is open, enter a short reason; retention reminders pause until you clear this. Do not enter personal data here.' },
  { group: 'Integrations', key: 'API_ENABLED', label: 'API for other systems', type: 'select', max: 3, options: [['no', 'Off (no API access)'], ['yes', 'On (API keys can be used)']], help: 'Lets other systems read counts and bookings, export data and create bookings, using API keys you create in the "API and webhooks" card below. Keep it off if you do not need it.' },
  { group: 'Branding', key: 'LOGO1_URL', label: 'Logo 1 (image URL, https)', type: 'url', max: 300, help: 'Optional.' },
  { group: 'Branding', key: 'LOGO2_URL', label: 'Logo 2 (image URL, https)', type: 'url', max: 300, help: 'Optional.' },
  { group: 'Branding', key: 'ACCENT_COLOR', label: 'Accent color', type: 'color', max: 7, help: 'Hex color, e.g. #b45309' },
  { group: 'Branding', key: 'HOME_URL', label: 'Event home page URL', type: 'url', max: 300, help: 'Adds a back link on the booking pages. Empty = no link.' },
  { group: 'Branding', key: 'HOME_LABEL', label: 'Home page link text', type: 'text', max: 60 },
];

function defaults() {
  const d = {};
  FIELDS.forEach(f => { d[f.key] = CONFIG[f.key] === undefined ? '' : CONFIG[f.key]; });
  return d;
}
const BASE = defaults(); // placeholder defaults from config.js, captured once

let configured = false;

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
}

function apply(values) {
  FIELDS.forEach(f => { CONFIG[f.key] = values[f.key]; });
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
  FIELDS.forEach(f => { v[f.key] = CONFIG[f.key]; });
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
    if (f.type === 'langs') {
      const codes = v.toLowerCase().split(/[\s,;]+/).filter(Boolean);
      if (!codes.length) v = 'en';
      else if (codes.some(c => !I18N.CODES.includes(c))) return { error: `${f.label}: allowed codes are ${I18N.CODES.join(', ')}` };
      else v = Array.from(new Set(codes)).join(',');
    }
    if (f.key === 'DEFAULT_LANGUAGE') {
      v = v.toLowerCase() || 'en';
      const enabled = String(out.LANGUAGES || 'en').split(',');
      if (!enabled.includes(v)) return { error: `${f.label} must be one of the enabled languages (${enabled.join(', ')})` };
    }
    if (f.type === 'select') {
      v = v || f.options[0][0];
      if (!f.options.some(o => o[0] === v)) return { error: `${f.label}: choose one of the listed values` };
    }
    if (f.type === 'currency') {
      v = v.toUpperCase() || 'EUR';
      if (!/^[A-Z]{3}$/.test(v)) return { error: `${f.label} must be a three-letter code like EUR` };
    }
    if (f.type === 'currencies') {
      const codes = Array.from(new Set(v.toUpperCase().split(/[\s,;]+/).filter(Boolean)));
      if (codes.some(c => !/^[A-Z]{3}$/.test(c))) return { error: `${f.label}: use three-letter codes separated by commas` };
      const nat = String(out.CURRENCY || 'EUR');
      const list = codes.filter(c => c !== nat);
      if (list.length > 8) return { error: `${f.label}: at most 8 currencies` };
      v = list.join(',');
    }
    if (f.type === 'date' && v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T00:00:00Z')))) return { error: `${f.label} must be a date like 2027-05-16` };
    if (f.type === 'number') {
      if (v === '') v = String(CONFIG[f.key] || '30');
      if (!/^\d{1,3}$/.test(v) || parseInt(v, 10) > 365) return { error: `${f.label} must be a whole number from 0 to 365` };
      v = String(parseInt(v, 10));
    }
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
