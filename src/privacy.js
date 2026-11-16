'use strict';
// Privacy notice text, retention schedule and helpers. All wording is generated from the Event setup values,
// so the built-in notice is correct for any event without editing code. It is a template, not legal advice:
// the controller remains responsible for checking that it matches what they actually do.
const { CONFIG } = require('./config');

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAY = 24 * 60 * 60 * 1000;

const controllerName = () => CONFIG.CONTROLLER_NAME || CONFIG.ORGANIZER || CONFIG.EVENT_NAME;
const contactEmail = () => CONFIG.PRIVACY_CONTACT_EMAIL || CONFIG.REPLY_TO_EMAIL || '';
const baseUrl = () => (process.env.PUBLIC_URL || CONFIG.FRIENDLY_URL || '').replace(/\/+$/, '');
const noticeUrl = () => CONFIG.PRIVACY_URL || (baseUrl() + '/privacy');

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

function retentionSentence() {
  const by = deleteBy();
  const n = retentionDays();
  const core = by
    ? `We erase all personal data from the booking system no later than ${iso(by)} (${n} days after the event ends on ${iso(endDate())}).`
    : `We erase all personal data from the booking system no later than ${n} days after the event ends.`;
  return core + ' If an open matter related to the event (for example a payment dispute or a complaint) still needs the data, we keep only what that matter requires and erase it as soon as the matter is closed.';
}

// One-paragraph version shown next to the booking form and used in emails
function shortText() {
  return `${controllerName()} collects this information only to register you for ${CONFIG.EVENT_NAME} and to organize the event `
    + '(accommodation, catering, check-in and contacting you about your booking). It is not used for any other purpose, not sold, '
    + 'and not shared with anyone who does not need it to organize the event. '
    + retentionSentence();
}

function footerText() {
  return '--\n'
    + `Your personal data is processed by ${controllerName()} only to organize ${CONFIG.EVENT_NAME}. ${retentionSentence()}\n`
    + `Privacy notice: ${noticeUrl()}`
    + (contactEmail() ? `\nAccess, correction or erasure requests: ${contactEmail()}` : '');
}

function sections() {
  const ctl = controllerName();
  const addr = CONFIG.CONTROLLER_ADDRESS;
  const mail = contactEmail();
  const ev = CONFIG.EVENT_NAME;
  return [
    ['Who is responsible for your data',
      `<p>The data controller is <strong>${esc(ctl)}</strong>${addr ? ', ' + esc(addr) : ''}.`
      + (mail ? ` Contact for all privacy matters: <a href="mailto:${esc(mail)}">${esc(mail)}</a>.` : '') + '</p>'],
    ['What we collect and why',
      '<p>When you register for ' + esc(ev) + ' we collect: your callsign, name, email address, country, optional phone number, the type of accommodation and the days or nights you choose, '
      + 'meal and extra-night choices, optional dietary requirements, optional T-shirt size, optional free-text comments, and the price calculated for your booking. '
      + 'The organizers may add a room number, an internal comment and your check-in status.</p>'
      + '<p>We use this data <strong>only</strong> to register you, allocate rooms and places, plan catering, calculate your fees, contact you about your booking and the event, and check you in on site. '
      + 'We do not use it for marketing, we do not sell it, we do not profile you and we make no automated decisions about you.</p>'],
    ['Legal basis',
      '<ul><li>Registration, accommodation, catering and fees: taking steps at your request to enter into a contract and performing it (GDPR Art. 6(1)(b)).</li>'
      + '<li>Showing your callsign and first name on the public participant list: your consent, which is optional and given by ticking a box (Art. 6(1)(a)). You can withdraw it at any time.</li>'
      + '<li>Dietary requirements can reveal health or religious information. They are optional; by filling them in you give your explicit consent for catering use only (Art. 9(2)(a)).</li>'
      + '<li>Basic security and error logs: our legitimate interest in keeping the service secure (Art. 6(1)(f)). These logs hold callsigns and booking references, not names or emails.</li></ul>'],
    ['Who sees your data',
      '<p>Only the event organizers and volunteers who need it to run the event have access, through a password-protected admin area. '
      + 'If you share a room, your roommates and the room\'s primary booker see the names and callsigns needed to coordinate. '
      + 'The venue or hotel receives the names, stay dates and dietary information it needs for rooming and catering. '
      + 'Our hosting and email providers process data on our behalf. '
      + 'If you give consent, your callsign and first name appear on the public participant list; nothing else is published.</p>'],
    ['How long we keep it', '<p>' + esc(retentionSentence()) + '</p>'
      + '<p>Backups, if any, are erased or overwritten on the same schedule. Confirmation emails already sent to you stay in your own mailbox.</p>'],
    ['Your rights',
      '<p>You have the right to access your data, have it corrected, have it erased, restrict or object to its processing, receive it in a portable format, and withdraw consent at any time. '
      + (mail ? `To use any of these rights write to <a href="mailto:${esc(mail)}">${esc(mail)}</a>. ` : 'To use any of these rights contact the organizers. ')
      + 'You also have the right to complain to the data protection authority of your country.</p>'
      + '<p>Providing the registration data is necessary to take part in the event. Without it we cannot register you.</p>'],
    ['Cookies and tracking',
      '<p>The public booking pages set no cookies and use no analytics, advertising or tracking tools, and load no third-party content. '
      + 'Organizers who log in to the admin area receive one strictly necessary session cookie. Your web host or reverse proxy may keep technical access logs (for example IP addresses) for security; the booking application itself does not store them.</p>'],
    ['Transfers outside the EU/EEA',
      '<p>Your data is stored on the organizer\'s own server or hosting provider. If a provider outside the EU/EEA is used, the organizer ensures an adequate safeguard such as EU Standard Contractual Clauses.</p>'],
  ];
}

function noticeBody() {
  return sections().map(([h, body]) => `<h2>${esc(h)}</h2>${body}`).join('\n');
}

function noticePage() {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + `<title>Privacy notice — ${esc(CONFIG.EVENT_NAME)}</title>`
    + '<style>:root{--accent:#b45309}body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f0f2f5;margin:0;color:#1f2328;line-height:1.55}'
    + '.wrap{max-width:760px;margin:0 auto;padding:1.5rem 1rem 3rem}.card{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:1.5rem 1.75rem}'
    + 'h1{font-size:1.4rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:1.4rem 0 .35rem;color:var(--accent)}p,li{font-size:.95rem}a{color:var(--accent)}'
    + '.back{display:inline-block;margin-bottom:1rem;font-size:.9rem}</style></head><body><div class="wrap"><a class="back" href="/">&larr; Back to registration</a>'
    + `<div class="card"><h1>Privacy notice</h1><div style="color:#57606a;font-size:.9rem">${esc(CONFIG.EVENT_NAME)} · ${esc(controllerName())}</div>`
    + noticeBody() + '</div></div></body></html>';
}

module.exports = { controllerName, contactEmail, noticeUrl, retentionDays, endDate, deleteBy, status, retentionSentence, shortText, footerText, noticePage, iso };
