'use strict';
// Privacy notice text, retention schedule and helpers. All wording is generated from the Event setup values and the
// language catalog (keys priv.*), so the built-in notice is correct for any event and language without editing code.
// It is a template, not legal advice: the controller remains responsible for checking that it matches what they do.
const { CONFIG } = require('./config');
const i18n = require('./i18n');

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAY = 24 * 60 * 60 * 1000;
const dl = lang => lang || i18n.defaultLang();

const controllerName = () => CONFIG.CONTROLLER_NAME || CONFIG.ORGANIZER || CONFIG.EVENT_NAME;
const contactEmail = () => CONFIG.PRIVACY_CONTACT_EMAIL || CONFIG.REPLY_TO_EMAIL || '';
const baseUrl = () => (process.env.PUBLIC_URL || CONFIG.FRIENDLY_URL || '').replace(/\/+$/, '');
const noticeUrl = lang => CONFIG.PRIVACY_URL || (baseUrl() + '/privacy' + (i18n.qsLang(dl(lang)) ? '?' + i18n.qsLang(dl(lang)) : ''));

function retentionDays() {
  const n = parseInt(CONFIG.RETENTION_DAYS, 10);
  return Number.isFinite(n) && n >= 0 && n <= 365 ? n : 30;
}
function endDate() {
  const s = String(CONFIG.EVENT_END_DATE || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}
function deleteBy() {
  const e = endDate();
  return e ? new Date(e.getTime() + retentionDays() * DAY) : null;
}
const iso = d => (d ? d.toISOString().slice(0, 10) : '');

// Retention state for the admin panel: unset | ok | due_soon | overdue | hold
function status(now) {
  now = now || new Date();
  const end = endDate(); const by = deleteBy();
  const hold = String(CONFIG.RETENTION_HOLD || '').trim();
  const out = { endDate: iso(end), deleteBy: iso(by), retentionDays: retentionDays(), hold, daysLeft: null, state: 'unset', eventEnded: false };
  if (!by) return out;
  // "deleteBy" is the last allowed day, so the deadline passes at the end of that day (UTC)
  out.daysLeft = Math.ceil((by.getTime() + DAY - now.getTime()) / DAY) - 1;
  out.eventEnded = now.getTime() >= end.getTime() + DAY;
  out.state = hold ? 'hold' : out.daysLeft < 0 ? 'overdue' : out.daysLeft <= 7 ? 'due_soon' : 'ok';
  return out;
}

function retentionSentence(lang) {
  lang = dl(lang);
  const by = deleteBy(); const n = retentionDays();
  const core = by ? i18n.t(lang, 'priv.retDate', { date: iso(by), n, end: iso(endDate()) }) : i18n.t(lang, 'priv.retNoDate', { n });
  return core + ' ' + i18n.t(lang, 'priv.retMatter');
}

// plain-text versions (form statement, emails)
function shortText(lang) {
  lang = dl(lang);
  return i18n.t(lang, 'priv.short', { controller: controllerName(), event: i18n.ev(lang, 'EVENT_NAME'), retention: retentionSentence(lang) });
}
function footerText(lang) {
  lang = dl(lang);
  const mail = contactEmail();
  return '--\n' + i18n.t(lang, 'mail.privFooter', { controller: controllerName(), event: i18n.ev(lang, 'EVENT_NAME'), retention: retentionSentence(lang), url: noticeUrl(lang) })
    + (mail ? '\n' + i18n.t(lang, 'mail.privRequests', { mail }) : '');
}

// HTML: text is escaped, *word* becomes bold, raw HTML (links) is inserted through named placeholders
function rich(lang, key, vars, html) {
  html = html || {};
  const v = Object.assign({}, vars);
  Object.keys(html).forEach(k => { v[k] = '\u0001' + k + '\u0001'; });
  let s = esc(i18n.t(lang, key, v)).replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
  Object.keys(html).forEach(k => { s = s.split('\u0001' + k + '\u0001').join(html[k]); });
  return s;
}

function noticeBody(lang) {
  lang = dl(lang);
  const mail = contactEmail();
  const link = mail ? `<a href="mailto:${esc(mail)}">${esc(mail)}</a>` : '';
  const P = (key, vars, html) => '<p>' + rich(lang, key, vars, html) + '</p>';
  const H = key => '<h2>' + esc(i18n.t(lang, key)) + '</h2>';
  const ev = i18n.ev(lang, 'EVENT_NAME');
  return [
    H('priv.h.controller'),
    P('priv.controller', { name: controllerName(), addr: CONFIG.CONTROLLER_ADDRESS ? ', ' + CONFIG.CONTROLLER_ADDRESS : '' })
      + (mail ? P('priv.contact', {}, { mail: link }) : ''),
    H('priv.h.collect'), P('priv.collect1', { event: ev }), P('priv.collect2'),
    H('priv.h.basis'),
    '<ul>' + ['priv.basis1', 'priv.basis2', 'priv.basis3', 'priv.basis4'].map(k => '<li>' + rich(lang, k) + '</li>').join('') + '</ul>',
    H('priv.h.who'), P('priv.who'),
    H('priv.h.keep'), '<p>' + esc(retentionSentence(lang)) + '</p>', P('priv.keepExtra'),
    H('priv.h.rights'),
    P('priv.rights1', { contact: '\u0002' }).replace('\u0002', mail ? rich(lang, 'priv.rightsContactMail', {}, { mail: link }) : esc(i18n.t(lang, 'priv.rightsContactNone'))),
    P('priv.rights2'),
    H('priv.h.cookies'), P('priv.cookies'),
    H('priv.h.transfers'), P('priv.transfers'),
  ].join('\n');
}

function noticePage(lang, sw) {
  lang = dl(lang);
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">`
    + `<title>${esc(i18n.t(lang, 'priv.title'))} — ${esc(i18n.ev(lang, 'EVENT_NAME'))}</title>`
    + '<style>:root{--accent:#b45309}body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f0f2f5;margin:0;color:#1f2328;line-height:1.55}'
    + '.wrap{max-width:760px;margin:0 auto;padding:1.5rem 1rem 3rem}.card{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:1.5rem 1.75rem}'
    + 'h1{font-size:1.4rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:1.4rem 0 .35rem;color:var(--accent)}p,li{font-size:.95rem}a{color:var(--accent)}'
    + `.back{display:inline-block;margin-bottom:1rem;font-size:.9rem}</style></head><body><div class="wrap">${sw || ''}<a class="back" href="/${i18n.qsLang(lang) ? '?' + i18n.qsLang(lang) : ''}">${esc(i18n.t(lang, 'priv.back'))}</a>`
    + `<div class="card"><h1>${esc(i18n.t(lang, 'priv.title'))}</h1><div style="color:#57606a;font-size:.9rem">${esc(i18n.ev(lang, 'EVENT_NAME'))} · ${esc(controllerName())}</div>`
    + noticeBody(lang) + '</div></div></body></html>';
}

module.exports = { controllerName, contactEmail, noticeUrl, retentionDays, endDate, deleteBy, status, retentionSentence, shortText, footerText, noticePage, iso };
