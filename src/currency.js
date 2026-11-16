'use strict';
// Currencies. The event has one native currency: every price, total and payment is in it.
// Guests may pick another configured currency for an indicative conversion only (display, marked with "≈").
// Rates are stored as "units of the other currency per 1 native unit" in table currency_rates, entered by hand
// or fetched from the ECB reference rates by the organizer.
const { CONFIG } = require('./config');
const db = require('./db');

const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const NBSP = ' ';
let rates = {}; // code -> { rate, manual, updated, base }

const isCode = c => /^[A-Z]{3}$/.test(String(c || ''));
const native = () => (isCode(CONFIG.CURRENCY) ? CONFIG.CURRENCY : 'EUR');
const extras = () => Array.from(new Set(String(CONFIG.CURRENCIES || '').toUpperCase().split(/[\s,;]+/).filter(c => isCode(c) && c !== native())));
const symbol = code => (code === 'EUR' ? '€' : code);
const digits = code => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } };
const nameOf = code => { try { return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) || code; } catch (e) { return code; } };

// Format an amount in the native currency (or another code): "€120" for EUR, "1 200 SEK" for others.
function fmt(n, code) {
  code = code || native();
  n = Number(n) || 0;
  const d = digits(code);
  const s = d === 0 ? String(Math.round(n)) : (Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2));
  return code === 'EUR' ? '€' + s : s + NBSP + code;
}
// "−€12" / "+€12" for differences
const fmtSigned = n => (n < 0 ? '−' : '+') + fmt(Math.abs(n));

// Rate for one extra currency (units per 1 native), or null when none is set for the current native currency.
function rateFor(code) {
  const r = rates[code];
  return r && r.base === native() && r.rate > 0 ? r.rate : null;
}
function convert(amount, code) {
  const r = rateFor(code);
  return r === null ? null : Number(amount) * r;
}
// Indicative amount in the guest's display currency: whole units (zero-decimal currencies) or 2 decimals when small.
function fmtApprox(amount, code) {
  const c = convert(amount, code);
  if (c === null) return '';
  const d = digits(code);
  const v = d === 0 || c >= 100 ? Math.round(c) : Math.round(c * 100) / 100;
  return v.toLocaleString('en').replace(/,/g, NBSP) + NBSP + code;
}
// Indicative amount with an explicit rate (the rate stored with a booking)
function fmtApproxWith(amount, rate, code) {
  const c = Number(amount) * Number(rate), d = digits(code);
  const v = d === 0 || c >= 100 ? Math.round(c) : Math.round(c * 100) / 100;
  return v.toLocaleString('en').replace(/,/g, NBSP) + NBSP + code;
}
const fmtRate = r => (r >= 100 ? r.toFixed(2) : r >= 1 ? r.toFixed(4) : r.toPrecision(4)).replace(/\.?0+$/, '');

// Which of the configured extra currencies actually have a rate (guests only see these)
const usable = () => extras().filter(c => rateFor(c) !== null);
function publicInfo() {
  const n = native();
  return { native: n, symbol: symbol(n), digits: digits(n), extras: usable().map(c => ({ code: c, rate: rateFor(c), digits: digits(c) })) };
}
// Validate a guest-supplied display currency; returns { code, rate } or { code: '', rate: null }
function pickDisplay(input) {
  const c = String(input || '').toUpperCase();
  const r = c && c !== native() && extras().includes(c) ? rateFor(c) : null;
  return r === null ? { code: '', rate: null } : { code: c, rate: r };
}

// Replace the euro sign in catalog texts by the native currency. EUR keeps the text unchanged.
function localizeText(s) {
  const n = native();
  if (n === 'EUR' || typeof s !== 'string' || s.indexOf('€') < 0) return s;
  return s.replace(/€\s?(\{\w+\})/g, '$1' + NBSP + n).replace(/(\{\w+\})\s?€/g, '$1' + NBSP + n).replace(/€/g, n);
}

// ---- storage ----
async function load() {
  const r = await db.query('SELECT code, rate, manual, base, updated_at FROM currency_rates');
  rates = {};
  r.rows.forEach(x => { rates[x.code] = { rate: Number(x.rate), manual: x.manual, base: x.base, updated: x.updated_at }; });
}
function adminView() {
  const n = native();
  return {
    success: true, native: n, nativeName: nameOf(n),
    rates: extras().map(c => ({ code: c, name: nameOf(c), rate: rateFor(c), manual: !!(rates[c] && rates[c].manual), updated: rates[c] ? rates[c].updated : null, stale: !!(rates[c] && rates[c].base !== n) })),
  };
}
async function saveRates(list) {
  const n = native();
  for (const x of Array.isArray(list) ? list : []) {
    const code = String(x.code || '').toUpperCase();
    if (!extras().includes(code)) return { success: false, error: `${code || '?'} is not one of the enabled extra currencies` };
    const raw = String(x.rate === undefined || x.rate === null ? '' : x.rate).replace(',', '.').trim();
    if (raw === '') { await db.query('DELETE FROM currency_rates WHERE code = $1', [code]); continue; }
    const rate = Number(raw);
    if (!isFinite(rate) || rate <= 0 || rate > 1e9) return { success: false, error: `Rate for ${code} must be a positive number` };
    await db.query(
      `INSERT INTO currency_rates (code, rate, manual, base, updated_at) VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (code) DO UPDATE SET rate = EXCLUDED.rate, manual = EXCLUDED.manual, base = EXCLUDED.base, updated_at = now()`,
      [code, rate, x.manual !== false, n]);
  }
  await load();
  return adminView();
}

// ---- ECB reference rates ----
function parseEcb(xml) {
  const out = { EUR: 1 };
  const re = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
  let m; while ((m = re.exec(xml))) out[m[1]] = Number(m[2]);
  const d = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml);
  return { rates: out, date: d ? d[1] : '' };
}
// Per-native rates from EUR-based ECB rates. Returns { code: rate } for codes the ECB publishes.
function crossRates(ecb, nativeCode, codes) {
  const out = {}, base = ecb[nativeCode];
  if (!base) return out;
  codes.forEach(c => { if (ecb[c]) out[c] = ecb[c] / base; });
  return out;
}
async function fetchEcb(fetchImpl) {
  const f = fetchImpl || fetch;
  let xml;
  try {
    const res = await f(ECB_URL, { headers: { 'User-Agent': 'event-booking-system' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    xml = await res.text();
  } catch (e) { return { success: false, error: 'Could not fetch the ECB rates: ' + e.message }; }
  const ecb = parseEcb(xml);
  const n = native();
  if (!ecb.rates[n]) return { success: false, error: `The ECB does not publish a rate for the native currency ${n}. Enter the rates by hand.` };
  const got = crossRates(ecb.rates, n, extras());
  const updated = [], keptManual = [], missing = [];
  for (const c of extras()) {
    if (!got[c]) { missing.push(c); continue; }
    if (rates[c] && rates[c].manual && rates[c].base === n) { keptManual.push(c); continue; }
    await db.query(
      `INSERT INTO currency_rates (code, rate, manual, base, updated_at) VALUES ($1,$2,false,$3,now())
       ON CONFLICT (code) DO UPDATE SET rate = EXCLUDED.rate, manual = false, base = EXCLUDED.base, updated_at = now()`,
      [c, got[c], n]);
    updated.push(c);
  }
  await load();
  return Object.assign(adminView(), { ecbDate: ecb.date, updated, keptManual, missing });
}

module.exports = { ECB_URL, native, extras, usable, symbol, digits, fmt, fmtSigned, fmtApprox, fmtApproxWith, fmtRate, rateFor, convert, publicInfo, pickDisplay,
  localizeText, load, adminView, saveRates, parseEcb, crossRates, fetchEcb, isCode, nameOf };
