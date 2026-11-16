'use strict';
// Internationalization. Built-in texts live in src/locales/<code>.json (flat key -> text, "{name}" placeholders).
// Admins can override any text, and translate event content (event name, announcement, day labels, ...), in the
// admin panel; overrides are stored in the "translations" table and merged on top of the built-in catalog.
//   key lookup order: override[lang] -> catalog[lang] -> catalog[default language] -> catalog.en -> the key itself
const { CONFIG } = require('./config');
const db = require('./db');

const LANGS = [
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Suomi' },
  { code: 'sv', name: 'Svenska' },
  { code: 'no', name: 'Norsk' },
  { code: 'da', name: 'Dansk' },
  { code: 'is', name: 'Íslenska' },
  { code: 'et', name: 'Eesti' },
  { code: 'lv', name: 'Latviešu' },
  { code: 'lt', name: 'Lietuvių' },
  { code: 'pl', name: 'Polski' },
  { code: 'de', name: 'Deutsch' },
  { code: 'tlh', name: 'tlhIngan Hol', partial: true },
  { code: 'fkv', name: 'Kainun kieli', partial: true },
  { code: 'fit', name: 'Meänkieli', partial: true },
];
// Browser language tags that map to a built-in language (Norwegian Bokmål/Nynorsk -> no)
const ALIASES = { nb: 'no', nn: 'no' };
const CODES = LANGS.map(l => l.code);
const catalogs = {};
CODES.forEach(c => {
  try { catalogs[c] = require('./locales/' + c + '.json'); }
  catch (e) {
    catalogs[c] = {};
    if (e.code !== 'MODULE_NOT_FOUND') console.error('Translation file src/locales/' + c + '.json is not valid JSON: ' + e.message);
  }
});

let overrides = {}; // lang -> { key: value }

async function load() {
  const r = await db.query('SELECT lang, key, value FROM translations');
  const o = {};
  r.rows.forEach(x => { (o[x.lang] = o[x.lang] || {})[x.key] = x.value; });
  overrides = o;
}

function enabledCodes() {
  const list = String(CONFIG.LANGUAGES || 'en').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(c => CODES.includes(c));
  const uniq = Array.from(new Set(list));
  return uniq.length ? uniq : ['en'];
}
function defaultLang() {
  const d = String(CONFIG.DEFAULT_LANGUAGE || '').toLowerCase();
  const en = enabledCodes();
  return en.includes(d) ? d : en[0];
}

function raw(lang, key) {
  const chain = [lang, defaultLang(), 'en'];
  for (const l of chain) {
    if (overrides[l] && overrides[l][key] !== undefined && overrides[l][key] !== '') return overrides[l][key];
    if (catalogs[l] && catalogs[l][key] !== undefined) return catalogs[l][key];
  }
  return key;
}
function fill(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] === undefined ? m : String(vars[n])));
}
const currency = require('./currency');
const t = (lang, key, vars) => fill(currency.localizeText(raw(lang, key)), vars);

// all texts of a language whose key starts with prefix (for the browser)
function dict(lang, prefix) {
  const keys = new Set(Object.keys(catalogs.en).filter(k => k.startsWith(prefix)));
  const out = {};
  keys.forEach(k => { out[k] = currency.localizeText(raw(lang, k)); });
  return out;
}
const safeJson = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// ---- event content that admins write themselves (translated per language, default language = the stored value) ----
function content(lang, key, original) {
  if (!lang || lang === defaultLang()) return original;
  const o = overrides[lang] && overrides[lang]['content.' + key];
  return o !== undefined && o !== '' ? o : original;
}
const EVENT_KEYS = ['EVENT_NAME', 'ORGANIZER', 'LOCATION', 'DATES_TEXT', 'CHECKIN_TIME', 'CHECKOUT_TIME', 'HOME_LABEL'];
const ev = (lang, key) => content(lang, 'event.' + key, CONFIG[key]);
const SETTING_KEYS = ['ANNOUNCEMENT', 'CLOSED_MESSAGE', 'CAMPER_INFO', 'TENT_INFO', 'PRICE_DISCLAIMER'];

function localizedSettings(lang, settings) {
  const s = Object.assign({}, settings);
  SETTING_KEYS.forEach(k => { if (s[k]) s[k] = content(lang, 'setting.' + k, s[k]); });
  return s;
}
function localizedStructure(lang) {
  const st = JSON.parse(JSON.stringify(CONFIG.STRUCTURE));
  st.days.forEach(d => { d.label = content(lang, `structure.day.${d.key}.label`, d.label); d.short = content(lang, `structure.day.${d.key}.short`, d.short); });
  st.extraNights.forEach(x => { x.label = content(lang, `structure.extra.${x.key}.label`, x.label); if (x.includes) x.includes = content(lang, `structure.extra.${x.key}.includes`, x.includes); });
  if (st.package) {
    st.package.sub = content(lang, 'structure.package.sub', st.package.sub);
    st.package.includes = (st.package.includes || []).map((s, i) => content(lang, `structure.package.includes.${i}`, s));
  }
  return st;
}
function localizedRooms(lang) {
  return CONFIG.ROOMS.map(r => {
    const base = lang === 'fi' && r.note_fi ? r.note_fi : r.note_en;
    return Object.assign({}, r, { note_en: content(lang, `room.${r.id}.note`, base) });
  });
}
function contentItems(settings) {
  const items = [];
  const add = (key, label, source) => { if (source) items.push({ key: 'content.' + key, label, source: String(source) }); };
  EVENT_KEYS.forEach(k => add('event.' + k, 'Event: ' + k, CONFIG[k]));
  SETTING_KEYS.forEach(k => add('setting.' + k, 'Setting: ' + k, settings && settings[k]));
  CONFIG.STRUCTURE.days.forEach(d => { add(`structure.day.${d.key}.label`, `Day label (${d.key})`, d.label); add(`structure.day.${d.key}.short`, `Day short label (${d.key})`, d.short); });
  CONFIG.STRUCTURE.extraNights.forEach(x => { add(`structure.extra.${x.key}.label`, `Extra night (${x.key})`, x.label); add(`structure.extra.${x.key}.includes`, `Extra night note (${x.key})`, x.includes); });
  if (CONFIG.STRUCTURE.package) {
    add('structure.package.sub', 'Meal package: short description', CONFIG.STRUCTURE.package.sub);
    (CONFIG.STRUCTURE.package.includes || []).forEach((s, i) => add(`structure.package.includes.${i}`, `Meal package: includes #${i + 1}`, s));
  }
  CONFIG.ROOMS.forEach(r => add(`room.${r.id}.note`, `Room type ${r.id}`, r.note_en));
  return items;
}

// ---- language selection and switcher ----
function pickLang(req) {
  const en = enabledCodes();
  const q = String((req.query && req.query.lang) || '').toLowerCase();
  if (en.includes(q)) return q;
  for (const part of String((req.headers && req.headers['accept-language']) || '').split(',')) {
    let code = part.trim().split(/[;-]/)[0].toLowerCase();
    code = ALIASES[code] || code;
    if (en.includes(code)) return code;
  }
  return defaultLang();
}
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function switcher(lang, req) {
  const en = enabledCodes();
  if (en.length < 2) return '';
  const links = en.map(c => {
    const p = new URLSearchParams();
    Object.keys(req.query || {}).forEach(k => { if (k !== 'lang' && typeof req.query[k] === 'string') p.set(k, req.query[k]); });
    p.set('lang', c);
    const name = LANGS.find(l => l.code === c).name;
    return c === lang
      ? `<strong style="color:var(--text,#1c2128)">${escAttr(name)}</strong>`
      : `<a href="${escAttr(req.path + '?' + p.toString())}" hreflang="${c}" style="color:var(--muted,#57606a);text-decoration:none">${escAttr(name)}</a>`;
  });
  return `<div class="lang-switch" style="text-align:right;font-size:0.82rem;font-family:var(--mono,monospace);padding:0.4rem 0.2rem">${links.join(' &middot; ')}</div>`;
}
function pickCode(x) { const l = String(x || '').toLowerCase(); return enabledCodes().includes(l) ? l : defaultLang(); }
function roomNote(lang, id) { const r = localizedRooms(lang).find(x => x.id === id); return r ? r.note_en : ''; }
function nightLabel(lang, k) {
  const st = localizedStructure(lang);
  const x = st.extraNights.find(y => y.key === k);
  if (x) return x.label;
  const d = st.days.find(y => y.key === k);
  return t(lang, 'js.nightOf', { day: d ? d.short : k });
}
const qsLang = lang => (enabledCodes().length > 1 ? 'lang=' + lang : '');

// ---- admin editor ----
function clean(v) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[<>]/g, '').trim(); }

async function getTranslations(lang, settings) {
  if (!CODES.includes(lang)) return { success: false, error: 'Unknown language' };
  const ov = overrides[lang] || {};
  const ui = Object.keys(catalogs.en).sort().map(key => ({
    key, en: catalogs.en[key],
    builtin: catalogs[lang][key] !== undefined ? catalogs[lang][key] : '',
    value: ov[key] !== undefined ? ov[key] : '',
  }));
  const contentRows = contentItems(settings).map(i => Object.assign({}, i, { value: ov[i.key] !== undefined ? ov[i.key] : '' }));
  return {
    success: true, lang, isDefault: lang === defaultLang(), languages: LANGS, enabled: enabledCodes(), defaultLang: defaultLang(),
    ui, content: contentRows,
    missing: ui.filter(r => lang !== 'en' && !r.builtin && !r.value).length,
  };
}

// map: { key: value }. An empty value removes the override.
async function saveTranslations(lang, map) {
  if (!CODES.includes(lang)) return { success: false, error: 'Unknown language' };
  map = map && typeof map === 'object' ? map : {};
  const valid = new Set(Object.keys(catalogs.en));
  let saved = 0; let removed = 0;
  for (const key of Object.keys(map)) {
    if (!valid.has(key) && !key.startsWith('content.')) continue;
    const v = clean(map[key]);
    if (v.length > 4000) return { success: false, error: `Text for ${key} is too long` };
    if (!v || (valid.has(key) && catalogs[lang][key] === v)) {
      await db.query('DELETE FROM translations WHERE lang = $1 AND key = $2', [lang, key]);
      if (overrides[lang]) delete overrides[lang][key];
      removed++;
    } else {
      await db.query(`INSERT INTO translations (lang, key, value, updated_at) VALUES ($1,$2,$3,now())
                      ON CONFLICT (lang, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [lang, key, v]);
      (overrides[lang] = overrides[lang] || {})[key] = v;
      saved++;
    }
  }
  return { success: true, saved, removed };
}

module.exports = { pickCode, roomNote, nightLabel, LANGS, CODES, load, t, dict, safeJson, content, ev, EVENT_KEYS, localizedSettings, localizedStructure, localizedRooms,
  enabledCodes, defaultLang, pickLang, switcher, qsLang, getTranslations, saveTranslations, catalogs };
