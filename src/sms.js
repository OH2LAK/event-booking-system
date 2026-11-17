'use strict';
// SMS sending through an HTTP SMS gateway (Setera). Off unless SMS_GATEWAY_URL, SMS_API_TOKEN and SMS_SENDER_ID are all set.
// Request format (same as the Setera gateway used in OH2LAK/UPS_monitor):
//   POST <SMS_GATEWAY_URL>   headers: token: <API token>, Content-Type: application/json
//   body: {"to": "<E.164 without +>", "from": "<sender id>", "content": "<text>", "external_id": "<optional>"}
// Everything provider-specific is inside send(), so another gateway only needs changes there.
const db = require('./db');

const cfg = () => ({
  url: process.env.SMS_GATEWAY_URL || '',
  token: process.env.SMS_API_TOKEN || '',
  sender: process.env.SMS_SENDER_ID || '',
  country: String(process.env.SMS_DEFAULT_COUNTRY_CODE || '358').replace(/\D/g, ''),
  maxPerInstance: parseInt(process.env.SMS_MAX_PER_INSTANCE || '300', 10)
});

// Alphanumeric sender IDs: at most 11 characters, letters/digits (and space), not only digits.
function validSender(s) { return /^[A-Za-z0-9 ]{1,11}$/.test(s) && !/^\d+$/.test(s); }

function enabled() {
  const c = cfg();
  return !!(c.url && c.token && validSender(c.sender)) && process.env.DEMO_MODE !== '1' && process.env.DEMO_MODE !== 'true';
}

// Turns what a guest typed into digits-only E.164 ("358401234567"), or null if it does not look like a phone number.
function normalizeNumber(raw, defaultCountry = cfg().country) {
  let s = String(raw || '').trim().replace(/[\s().-]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  else if (s.startsWith('0')) s = defaultCountry + s.slice(1);
  else return null;                       // no prefix we can trust: do not guess
  return /^[1-9]\d{7,14}$/.test(s) ? s : null;
}

async function sentCount() {
  const r = await db.query("SELECT count(*)::int AS n FROM event_log WHERE event='sms_sent'");
  return r.rows[0].n;
}

// Sends one SMS. Returns { ok, skipped?, status?, error? }. Never throws and never logs the token.
async function send(to, text, opts = {}) {
  const c = cfg(), fetchImpl = opts.fetch || fetch;
  if (!enabled()) return { ok: false, skipped: 'disabled' };
  const number = normalizeNumber(to, c.country);
  if (!number) return { ok: false, skipped: 'bad-number' };
  try {
    if (c.maxPerInstance > 0 && await sentCount() >= c.maxPerInstance) return { ok: false, skipped: 'limit' };
    const body = { to: number, from: c.sender, content: String(text).slice(0, 480) };
    if (opts.externalId) body.external_id = String(opts.externalId).slice(0, 64);
    const res = await fetchImpl(c.url, { method: 'POST', headers: { token: c.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!res.ok) { await db.logEvent('WARN', 'sms_failed', opts.label || '', 'HTTP ' + res.status); return { ok: false, status: res.status }; }
    await db.logEvent('INFO', 'sms_sent', opts.label || '', '');
    return { ok: true, status: res.status };
  } catch (e) {
    await db.logEvent('WARN', 'sms_failed', opts.label || '', e.message);
    return { ok: false, error: e.message };
  }
}
module.exports = { send, enabled, normalizeNumber, validSender };
