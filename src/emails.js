'use strict';
// Email templates (sent through SMTP with nodemailer).
// If SMTP_HOST is empty, emails are logged to the console instead of being sent.
const nodemailer = require('nodemailer');
const { CONFIG } = require('./config');
const i18n = require('./i18n');
const currency = require('./currency');
const S = require('./structure');
const daysText = list => S.pickDays(list).map(k => S.dayByKey(k).short).join(' + ');
const nightsLine = data => (S.mode() === 'per_night' && (data.type === 'room' || data.type === 'singlebed'))
  ? 'Nights   : ' + (data.nights && data.nights.length ? S.pickNights(data.nights).map(S.nightLabel).join(', ') : 'All') : '';
const extrasText = list => S.pickExtras(list).map(k => { const x = S.extraByKey(k); return x.label + (x.includes ? ' (' + x.includes + ')' : ''); }).join(', ');

let transporter = null;
function getTransporter() {
  if (transporter || !process.env.SMTP_HOST) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

// opts: { name, replyTo, bcc }
async function sendMail(to, subject, text, opts) {
  opts = opts || {};
  const t = getTransporter();
  if (!to) return;
  if (!t) {
    console.log(`[email disabled] subject=${subject}`); // never log the recipient (personal data)
    return;
  }
  // Privacy footer on every message to a participant (not on organizer notifications or erasure notices)
  if (!opts.noFooter && to !== CONFIG.REPLY_TO_EMAIL) text = text + '\n\n' + require('./privacy').footerText(opts.lang);
  const fromAddr = process.env.EMAIL_FROM || process.env.SMTP_USER || CONFIG.REPLY_TO_EMAIL;
  await t.sendMail({
    from: `"${(opts.name || CONFIG.EMAIL_SENDER_NAME).replace(/"/g, '')}" <${fromAddr}>`,
    to, subject, text,
    replyTo: opts.replyTo || CONFIG.REPLY_TO_EMAIL || undefined,
    bcc: opts.bcc || undefined,
  });
}

// ---- guest-facing emails: sent in the booking's language (organizer copies stay in English) ----
const DBL = '═'.repeat(59), SGL = '─'.repeat(57);
const sec = title => `${SGL}\n${title}\n${SGL}`;
const head = lines => [DBL].concat(lines.filter(Boolean).map(l => '  ' + l), [DBL]).join('\n');
const kv = rows => {
  const r = rows.filter(x => x[1] !== undefined && x[1] !== null && x[1] !== '');
  const w = Math.max.apply(null, r.map(x => x[0].length));
  return r.map(x => x[0].padEnd(w) + ' : ' + x[1]).join('\n');
};
const langOf = x => { const l = String(x || '').toLowerCase(); return i18n.enabledCodes().includes(l) ? l : i18n.defaultLang(); };
const roomNote = (lang, id) => { const r = i18n.localizedRooms(lang).find(x => x.id === id); return r ? r.note_en : ''; };
const livePrice = (settings, roomCfg) => (settings.ROOM_PRICES && settings.ROOM_PRICES[roomCfg.id] !== undefined) ? settings.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur;

function helpers(lang) {
  const t = (k, v) => i18n.t(lang, k, v);
  const LS = i18n.localizedStructure(lang);
  const dayShort = k => (LS.days.find(d => d.key === k) || {}).short || k;
  const extra = k => LS.extraNights.find(x => x.key === k);
  return {
    t, LS,
    days: list => S.pickDays(list).map(dayShort).join(' + '),
    nightLabel: k => { const x = extra(k); return x ? x.label : t('js.nightOf', { day: dayShort(k) }); },
    extras: list => S.pickExtras(list).map(k => { const x = extra(k) || { label: k }; return x.label + (x.includes ? ' (' + x.includes + ')' : ''); }).join(', '),
    typeLabel: (type, roomId) => {
      if (type === 'room') return (roomId && roomNote(lang, roomId)) || t('mail.tRoom');
      if (type === 'camper') return t('mail.tCamper');
      if (type === 'tent') return t('mail.tTent');
      if (type === 'singlebed') return t('mail.tSingle');
      if (type === 'dayvisitor') return t('mail.tDayVisitor');
      return type;
    },
    mealLines: isRoomLike => {
      const orig = CONFIG.FULL_BOARD_INCLUDES_EN || [];
      const loc = (LS.package && LS.package.includes) || orig;
      return orig.map((o, i) => ({ keep: isRoomLike || !String(o).toLowerCase().includes('breakfast is included in all room'), text: loc[i] || o }))
        .filter(x => x.keep).map(x => '  • ' + x.text).join('\n');
    },
  };
}
const signoff = () => `73,\n${CONFIG.EMAIL_SENDER_NAME}`;
const mailOpts = (lang, extra) => Object.assign({ name: CONFIG.EMAIL_SENDER_NAME, replyTo: CONFIG.REPLY_TO_EMAIL, lang }, extra || {});

// Indicative total in the guest's chosen display currency (rate fixed when they booked). Empty when none was chosen.
function approxLine(t, total, cur, rate) {
  if (!cur || !rate || !total) return '';
  return '\n' + t('mail.approx', { amt: currency.fmtApproxWith(total, rate, cur), native: currency.native(), rate: currency.fmtRate(Number(rate)), cur });
}

async function sendConfirmationEmail(data, bookingRef, price, webAppUrl, settings, primaryRow) {
  const lang = langOf(data.language);
  const H = helpers(lang), t = H.t;
  const callsign = data.callsign.toUpperCase();
  const s = i18n.localizedSettings(lang, settings);
  let roomCfg = data.roomId ? CONFIG.ROOMS.find(r => r.id === data.roomId) : null;
  const primaryBooker_ = (data.roomRef && !data.isPrimaryBooker) ? (primaryRow || null) : null;
  if (!roomCfg && primaryBooker_ && primaryBooker_.roomId) roomCfg = CONFIG.ROOMS.find(r => r.id === primaryBooker_.roomId);
  const isRoomLike = data.type === 'room' || data.type === 'singlebed';
  const ev = k => i18n.ev(lang, k);
  const parts = [];
  parts.push(head([ev('EVENT_NAME').toUpperCase(), t('mail.confirmTitle'), ev('LOCATION'), ev('DATES_TEXT')]));
  parts.push(`${t('mail.dear', { name: data.name })}\n\n${t('mail.confirmed')}\n\n${t('mail.refLabel', { ref: bookingRef })}`);
  parts.push(sec(t('mail.secGuest')) + '\n' + kv([
    [t('mail.lCallsign'), callsign], [t('mail.lName'), data.name], [t('mail.lEmail'), data.email],
    [t('mail.lPhone'), data.phone], [t('mail.lCountry'), data.country]]));

  if (data.type === 'dayvisitor') {
    parts.push(sec(t('mail.secAttendance')) + '\n' + kv([[t('mail.lType'), t('mail.tDayVisitor')], [t('mail.lDays'), H.days(data.visitorDays)]]));
  } else {
    const rows = [[t('mail.lType'), H.typeLabel(data.type, roomCfg && roomCfg.id)]];
    const blocks = [];
    if (data.type === 'camper' && s.CAMPER_INFO) blocks.push(s.CAMPER_INFO);
    if (data.type === 'tent' && s.TENT_INFO) blocks.push(s.TENT_INFO);
    const url = `${webAppUrl}?join=${encodeURIComponent(bookingRef)}` + (i18n.enabledCodes().length > 1 ? '&lang=' + lang : '');
    if (data.isPrimaryBooker && data.type === 'room') {
      rows.push([t('mail.lRoomRef'), bookingRef]);
      blocks.push(`${t('mail.shareRoomTitle')}\n${t('mail.shareRoomBody', { ref: bookingRef, url })}`);
    }
    if (data.isPrimaryBooker && data.type === 'camper') {
      rows.push([t('mail.lSpotRef'), bookingRef]);
      blocks.push(`${t('mail.shareCamperTitle')}\n${t('mail.shareCamperBody', { ref: bookingRef, url })}`);
    }
    if (!data.isPrimaryBooker) {
      blocks.push(t(data.type === 'camper' ? 'mail.joiningCamper' : 'mail.joiningRoom', { ref: data.roomRef })
        + (primaryBooker_ ? t('mail.bookedBy', { who: primaryBooker_.callsign.toUpperCase() + ' ' + primaryBooker_.name }) : ''));
    }
    if (S.mode() === 'per_night' && isRoomLike)
      rows.push([t('mail.lNights'), data.nights && data.nights.length ? S.pickNights(data.nights).map(H.nightLabel).join(', ') : t('mail.lAllNights')]);
    if (data.extraNights && data.extraNights.length) rows.push([t('mail.lExtra'), H.extras(data.extraNights)]);
    parts.push(sec(t('mail.secAccommodation')) + '\n' + kv(rows) + (blocks.length ? '\n\n' + blocks.join('\n\n') : ''));
  }

  const extraLines = [];
  if (data.fullBoard) extraLines.push(`${t('mail.mealIncludes')}\n${H.mealLines(isRoomLike)}`);
  else if (CONFIG.STRUCTURE.package.enabled) extraLines.push(t('mail.mealNo'));
  if (data.dietary) extraLines.push(t('mail.dietary', { v: data.dietary }));
  if (data.shirtSize) extraLines.push(t('mail.shirt', { v: data.shirtSize }));
  if (data.freeText) extraLines.push(`${t('mail.freeText')}\n${data.freeText}`);
  parts.push(sec(t('mail.secServices')) + '\n' + String(price.breakdown).split(' | ').join('\n') + '\n\n' + extraLines.join('\n\n'));
  parts.push(SGL + '\n' + t('mail.total', { n: price.total }) + approxLine(t, price.total, data.displayCurrency, data.displayRate) + (s.PRICE_DISCLAIMER ? `\n\n* ${s.PRICE_DISCLAIMER}` : ''));
  // Nothing to pay: no payment section. The organizer's own payment text replaces the built-in one when set.
  if (price.total > 0) parts.push(sec(t('mail.secPayment')) + '\n' + (ev('PAYMENT_INFO') || t('mail.payBody'))
    + (data.isPrimaryBooker && data.type === 'room' && roomCfg ? '\n\n' + t('mail.roomBookerNote', { n: livePrice(settings, roomCfg) }) : ''));
  if (CONFIG.EVENT_MODE !== 'day') parts.push(`${SGL}\n\n${t('mail.checkin', { v: ev('CHECKIN_TIME') })}\n${t('mail.checkout', { v: ev('CHECKOUT_TIME') })}`);
  parts.push(`${SGL}\n${t('mail.questions')}\n${CONFIG.REPLY_TO_EMAIL}\n\n${signoff()}\n${DBL}`);

  await sendMail(data.email, `[${CONFIG.EVENT_SHORT}] ${t('mail.confirmSubject', { ref: bookingRef })}`, parts.join('\n\n'), mailOpts(lang));
}

async function sendRoomJoinNotification(primary, joiner, joinerRef, settings) {
  const lang = langOf(primary.language);
  const H = helpers(lang), t = H.t;
  const jc = joiner.callsign.toUpperCase();
  const roomCfg = primary.roomId ? CONFIG.ROOMS.find(r => r.id === primary.roomId) : null;
  const parts = [];
  parts.push(head([`${i18n.ev(lang, 'EVENT_NAME').toUpperCase()} — ${t('mail.roomNotice')}`]));
  parts.push(`${t('mail.dear', { name: primary.name })}\n\n${t('mail.joinBody', { cs: jc, name: joiner.name })}\n\n`
    + kv([[t('mail.lRef'), primary.bookingRef], [t('mail.lTheirRef'), joinerRef], [t('mail.lRoomType'), roomCfg ? roomNote(lang, roomCfg.id) : '']]));
  if (roomCfg) {
    const total = livePrice(settings, roomCfg);
    parts.push(sec(t('mail.secRoomCosts')) + '\n' + kv([[t('mail.roomTotal'), currency.fmt(total)], [t('mail.perPersonN', { n: roomCfg.persons }), currency.fmt(Math.round(total / roomCfg.persons))]]));
  }
  parts.push(t('mail.settle'));
  parts.push(sec(t('mail.secPayment')) + '\n' + t('mail.payShort'));
  parts.push(`${SGL}\n\n${t('mail.questionsInline', { mail: CONFIG.REPLY_TO_EMAIL })}\n\n${signoff()}\n${DBL}`);
  await sendMail(primary.email, `[${CONFIG.EVENT_SHORT}] ${t('mail.joinSubject', { cs: jc, ref: primary.bookingRef })}`, parts.join('\n\n'), mailOpts(lang));
}

async function sendRoomFullNotification(primary, roomCfg, allOccupants, settings) {
  const total = livePrice(settings, roomCfg);
  const core = lang => {
    const t = (k, v) => i18n.t(lang, k, v);
    const list = allOccupants.map((b, i) => `  ${i + 1}. ${b.callsign.toUpperCase()} — ${b.name}${b.isPrimaryBooker === 'YES' ? t('mail.primaryTag') : ''}`).join('\n');
    return [head([`${i18n.ev(lang, 'EVENT_NAME').toUpperCase()} — ${t('mail.roomNotice')}`]),
      t('mail.roomFull') + '\n\n' + kv([[t('mail.lRef'), primary.bookingRef], [t('mail.lRoomType'), roomNote(lang, roomCfg.id)], [t('mail.lCapacity'), t('mail.capacityVal', { n: roomCfg.persons })]]),
      sec(t('mail.secOccupants')) + '\n' + list,
      sec(t('mail.secRoomCosts')) + '\n' + kv([[t('mail.roomTotal'), currency.fmt(total)], [t('mail.perPersonN', { n: roomCfg.persons }), currency.fmt(Math.round(total / roomCfg.persons))]])].join('\n\n');
  };
  const lang = langOf(primary.language), t = (k, v) => i18n.t(lang, k, v);
  await sendMail(primary.email, `[${CONFIG.EVENT_SHORT}] ${t('mail.fullSubject', { ref: primary.bookingRef })}`,
    `${core(lang)}\n\n${t('mail.allBooked')}\n\n${t('mail.settle')}\n\n${SGL}\n${t('mail.questionsInline', { mail: CONFIG.REPLY_TO_EMAIL })}\n\n${signoff()}\n${DBL}`, mailOpts(lang));
  // organizer copy (English)
  await sendMail(CONFIG.REPLY_TO_EMAIL, `[${CONFIG.EVENT_SHORT}] Room full: ${primary.bookingRef} — ${roomNote('en', roomCfg.id)}`, `${core('en')}\n\n${DBL}`, mailOpts('en'));
}

async function sendAccommodationChangeEmail_(booking, oldType, oldRoomCfg, newType, newRoomCfg, oldPrice, newPrice, settings) {
  const lang = langOf(booking.language);
  const H = helpers(lang), t = H.t;
  const s = i18n.localizedSettings(lang, settings);
  const ev = k => i18n.ev(lang, k);
  const diff = newPrice.total - oldPrice.total;
  const diffStr = diff === 0 ? t('mail.noChange') : currency.fmtSigned(diff);
  const parts = [
    head([ev('EVENT_NAME').toUpperCase(), t('mail.changeTitle'), ev('LOCATION'), ev('DATES_TEXT')]),
    `${t('mail.dear', { name: booking.name })}\n\n${t('mail.changeIntro')}\n\n${t('mail.refLabel', { ref: booking.bookingRef })}`,
    sec(t('mail.secChange')) + '\n' + kv([
      [t('mail.lPrevious'), H.typeLabel(oldType, oldRoomCfg && oldRoomCfg.id)], [t('mail.lNew'), H.typeLabel(newType, newRoomCfg && newRoomCfg.id)]])
      + '\n\n' + kv([[t('mail.lPrevTotal'), currency.fmt(oldPrice.total)], [t('mail.lNewTotal'), currency.fmt(newPrice.total)], [t('mail.lDiff'), diffStr]]) + approxLine(t, newPrice.total, booking.displayCurrency, booking.displayRate),
    sec(t('mail.secNewBreakdown')) + '\n' + String(newPrice.breakdown).split(' | ').join('\n') + (s.PRICE_DISCLAIMER ? `\n\n* ${s.PRICE_DISCLAIMER}` : ''),
    sec(t('mail.secPayment')) + '\n' + t('mail.payChange'),
    `${SGL}\n${t('mail.questions')}\n${CONFIG.REPLY_TO_EMAIL}\n\n${signoff()}\n${DBL}`,
  ];
  await sendMail(booking.email, `[${CONFIG.EVENT_SHORT}] ${t('mail.changeSubject', { ref: booking.bookingRef })}`, parts.join('\n\n'), mailOpts(lang, { bcc: CONFIG.REPLY_TO_EMAIL }));
}

// Plain notices used by the admin tools (booking update, cascade, erasure, shutdown), in the guest's language
function bookingUpdatedMail(obj, bookingRef, changed, price) {
  const lang = langOf(obj.language), t = (k, v) => i18n.t(lang, k, v);
  return { lang, subject: `[${CONFIG.EVENT_SHORT}] ${t('mail.updSubject', { ref: bookingRef })}`,
    body: `${t('mail.dear', { name: obj.name + ' (' + obj.callsign + ')' })}\n\n${t('mail.updIntro')}\n\n`
      + kv([[t('mail.lRef'), bookingRef], [t('mail.lUpdated'), changed.join(', ')]])
      + `\n\n${sec(t('mail.secCurrent'))}\n${String(price.breakdown || '').replace(/ \| /g, '\n')}\n\n${t('mail.total', { n: price.total })}${approxLine(t, price.total, obj.displayCurrency, obj.displayRate)}\n\n${SGL}\n${t('mail.questionsInline', { mail: CONFIG.REPLY_TO_EMAIL })}\n\n${i18n.ev(lang, 'ORGANIZER')}` };
}
function roommateCancelledMail(rm, primaryRef) {
  const lang = langOf(rm.language), t = (k, v) => i18n.t(lang, k, v);
  return { lang, subject: t('mail.cascSubject', { ev: CONFIG.EVENT_SHORT }),
    body: `${t('mail.dear', { name: rm.name + ' (' + rm.callsign.toUpperCase() + ')' })}\n\n${t('mail.cascBody', { ref: primaryRef, ref2: rm.booking_ref, mail: CONFIG.REPLY_TO_EMAIL })}\n\n${CONFIG.EMAIL_SENDER_NAME}` };
}
function erasureMail(row) {
  const lang = langOf(row.language), t = (k, v) => i18n.t(lang, k, v);
  const mail = require('./privacy').contactEmail();
  return { lang, subject: `[${CONFIG.EVENT_SHORT}] ${t('mail.eraseSubject')}`,
    body: `${t('mail.dear', { name: row.name })}\n\n${t('mail.eraseBody', { event: i18n.ev(lang, 'EVENT_NAME'), ref: row.booking_ref })}\n`
      + (mail ? t('mail.eraseContact', { mail }) + '\n' : '') + `\n${CONFIG.EMAIL_SENDER_NAME}` };
}
function shutdownMail(row) {
  const lang = langOf(row.language), t = (k, v) => i18n.t(lang, k, v);
  const mail = require('./privacy').contactEmail();
  return { lang, subject: `[${CONFIG.EVENT_SHORT}] ${t('mail.shutSubject')}`,
    body: `${t('mail.dear', { name: row.name })}\n\n${t('mail.shutBody', { event: i18n.ev(lang, 'EVENT_NAME') })}\n`
      + (mail ? t('mail.shutContact', { mail }) + '\n' : '') + `\n${t('mail.thanks')}\n${CONFIG.EMAIL_SENDER_NAME}` };
}

async function sendOrganizerNotification(data, bookingRef, price, settings) {
  const callsign = data.callsign.toUpperCase();
  const roomCfg = data.roomId ? CONFIG.ROOMS.find(r => r.id === data.roomId) : null;
  const orgSettings = settings;
  const mealLines = CONFIG.FULL_BOARD_INCLUDES_EN
    .filter(l => (data.type === 'room' || data.type === 'singlebed') ? true : !l.toLowerCase().includes('breakfast is included in all room'))
    .map(l => `  • ${l}`).join("\n");

  const subject = `[${CONFIG.EVENT_SHORT}] New booking: ${callsign} — ${bookingRef}`;

  const body = `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  ${CONFIG.EVENT_NAME.toUpperCase()} — NEW BOOKING NOTIFICATION
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

New booking received:

BOOKING REFERENCE: ${bookingRef}
Timestamp: ${new Date().toISOString()}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
GUEST DETAILS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Callsign : ${callsign}
Name     : ${data.name}
Email    : ${data.email}
Phone    : ${data.phone || "\u2014"}
Country  : ${data.country || "\u2014"}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.type === "dayvisitor" ? "ATTENDANCE" : "ACCOMMODATION"}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.type === "dayvisitor" ? `Type     : Day visitor (no overnight accommodation)
Days     : ${daysText(data.visitorDays)}` : `Type     : ${data.type === "room" ? (roomCfg ? roomCfg.note_en : "Room") : data.type === "camper" ? "Camper van" : data.type === "tent" ? "Tent" : data.type}
${data.type === "room" && data.isPrimaryBooker ? `Role     : Primary booker (room holder)` : ""}
${data.type === "room" && !data.isPrimaryBooker ? `Role     : Joining existing room: ${data.roomRef}` : ""}
${nightsLine(data)}
Extra nights: ${data.extraNights && data.extraNights.length ? extrasText(data.extraNights) : "No"}`}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ORDERED SERVICES
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${price.breakdown.split(" | ").join("\n")}

Meal package: ${data.fullBoard ? "YES" : "No"}
${data.fullBoard ? `${mealLines}` : ""}
Dietary: ${data.dietary || "\u2014"}
T-shirt size: ${data.shirtSize || "\u2014"}
${data.freeText ? `\nAdditional info from booker:\n${data.freeText}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
TOTAL: ${currency.fmt(price.total)}
${price.total === 0 ? "(Price pending — check with organizers)" : ""}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
`.trim();

  await sendMail(CONFIG.REPLY_TO_EMAIL, subject, body, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: data.email,
  });
}


module.exports = {
  sendMail,
  isEnabled: () => !!process.env.SMTP_HOST,
  sendConfirmationEmail,
  sendRoomJoinNotification,
  sendRoomFullNotification,
  sendOrganizerNotification,
  sendAccommodationChangeEmail_,
  bookingUpdatedMail, roommateCancelledMail, erasureMail, shutdownMail,
};
