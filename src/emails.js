'use strict';
// Email templates, ported 1:1 from the Apps Script version (Gmail -> SMTP via nodemailer).
// If SMTP_HOST is empty, emails are logged to the console instead of being sent.
const nodemailer = require('nodemailer');
const { CONFIG } = require('./config');

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
    console.log(`[email disabled] to=${to} subject=${subject}`);
    return;
  }
  const fromAddr = process.env.EMAIL_FROM || process.env.SMTP_USER || CONFIG.REPLY_TO_EMAIL;
  await t.sendMail({
    from: `"${(opts.name || CONFIG.EMAIL_SENDER_NAME).replace(/"/g, '')}" <${fromAddr}>`,
    to, subject, text,
    replyTo: opts.replyTo || CONFIG.REPLY_TO_EMAIL || undefined,
    bcc: opts.bcc || undefined,
  });
}

async function sendConfirmationEmail(data, bookingRef, price, webAppUrl, settings, primaryRow) {
  const callsign = data.callsign.toUpperCase();
  const emailSettings = settings;
  let roomCfg = data.roomId ? CONFIG.ROOMS.find(r => r.id === data.roomId) : null;
  const primaryBooker_ = (data.roomRef && !data.isPrimaryBooker) ? (primaryRow || null) : null;
  if (!roomCfg && primaryBooker_ && primaryBooker_.roomId) roomCfg = CONFIG.ROOMS.find(r => r.id === primaryBooker_.roomId);
  const liveRoomPrice = roomCfg
    ? ((emailSettings.ROOM_PRICES && emailSettings.ROOM_PRICES[roomCfg.id] !== undefined)
        ? emailSettings.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur)
    : null;
  const mealLines = CONFIG.FULL_BOARD_INCLUDES_EN
    .filter(l => (data.type === 'room' || data.type === 'singlebed') ? true : !l.toLowerCase().includes('breakfast is included in all room'))
    .map(l => `  • ${l}`).join("\n");

  const subject = `[Nordic VUSHF 2026] Booking confirmation — ${bookingRef}`;

  const body = `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  NORDIC VUSHF MEETING 2026
  BOOKING CONFIRMATION
  ${CONFIG.LOCATION}
  ${CONFIG.DATE_FRI} \u2013 ${CONFIG.DATE_SUN}
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Dear ${data.name},

Your booking has been confirmed!

BOOKING REFERENCE: ${bookingRef}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
GUEST DETAILS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Callsign : ${callsign}
Name     : ${data.name}
Email    : ${data.email}
${data.phone ? `Phone    : ${data.phone}` : ""}
${data.country ? `Country  : ${data.country}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.type === "dayvisitor" ? "ATTENDANCE" : "ACCOMMODATION"}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.type === "dayvisitor" ? `Type     : Day visitor (no overnight accommodation)
Days     : ${data.dayVisitorDays === "both" ? "Friday 15.5 + Saturday 16.5" : data.dayVisitorDays === "fri" ? "Friday 15.5 only" : "Saturday 16.5 only"}` : `Type     : ${data.type === "room" ? (roomCfg ? roomCfg.note_en : "Room") : data.type === "camper" ? "Camper van spot" : data.type === "tent" ? "Tent" : data.type}
${data.type === "camper" ? `\n${emailSettings.CAMPER_INFO}` : ""}${data.type === "tent" ? `\n${emailSettings.TENT_INFO}` : ""}
${data.isPrimaryBooker && data.type === "room" ? `Room ref : ${bookingRef}

! IMPORTANT — SHARING YOUR ROOM !
Anyone joining your room MUST use one of these options:

  1) Use "Join a booking" on the booking page and enter your
     booking reference: ${bookingRef}

  2) Or use this direct join link (pre-fills the reference):
     ${webAppUrl}?join=${encodeURIComponent(bookingRef)}

Roommates who do NOT use the join option will be registered
as separate guests and may be assigned a different room.` : ""}
${data.isPrimaryBooker && data.type === "camper" ? `Spot ref : ${bookingRef}

! IMPORTANT — SHARING YOUR CAMPER SPOT !
Anyone travelling in the same vehicle MUST use one of these options:

  1) Use "Join a booking" on the booking page and enter your
     booking reference: ${bookingRef}

  2) Or use this direct join link (pre-fills the reference):
     ${webAppUrl}?join=${encodeURIComponent(bookingRef)}

Co-travellers who do NOT use the join option will be registered
as separate camper spots.` : ""}
${!data.isPrimaryBooker ? `Joining ${data.type === 'camper' ? 'camper spot' : 'room'}: ${data.roomRef}${primaryBooker_ ? " — booked by " + primaryBooker_.callsign.toUpperCase() + " " + primaryBooker_.name : ""}` : ""}
${data.thuExtraNight ? `Thu extra night: YES (${CONFIG.THU_EXTRA_INCLUDES})` : ""}`}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ORDERED SERVICES
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${price.breakdown.split(" | ").join("\n")}

${data.fullBoard ? `Meal package includes:\n${mealLines}` : "Meal package: No"}
${!data.fullBoard && data.meals && Object.values(data.meals).some(Boolean) ? `Individual meals:\n${[
  data.meals.friBbq   ? '  • Friday BBQ dinner' : '',
  data.meals.friLunch ? '  • Friday lunch' : '',
  data.meals.satLunch ? '  • Saturday lunch' : '',
  data.meals.satHam   ? '  • Saturday Ham Dinner' : '',
].filter(Boolean).join('\n')}` : ""}

${data.dietary ? `Dietary requirements: ${data.dietary}` : ""}
${data.shirtSize ? `T-shirt size: ${data.shirtSize}` : ""}
${data.freeText ? `\nAdditional information sent:\n${data.freeText}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
TOTAL: \u20AC${price.total}
${emailSettings.THU_EXTRA_NIGHT_PRICE === null && data.thuExtraNight ? "(+ Thu extra night TBD — to be confirmed separately)" : ""}
${emailSettings.PRICE_DISCLAIMER ? `\n* ${emailSettings.PRICE_DISCLAIMER}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
PAYMENT
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
All payments are to be completed upon arrival at the venue.

Accepted payment methods:
  • Cash
  • Debit and credit cards (Visa, Mastercard)
  x No Amex or Diners Club

${data.isPrimaryBooker && data.type === "room" && roomCfg ? `NOTE: The room total is \u20AC${liveRoomPrice}. As the room booker you are responsible for settling the room costs with your roommates.` : ""}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

CHECK-IN: ${CONFIG.CHECKIN_TIME}
CHECK-OUT: ${CONFIG.CHECKOUT_TIME}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
If you have any questions, please contact us:
${CONFIG.REPLY_TO_EMAIL}

73,
${CONFIG.EMAIL_SENDER_NAME}
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
`.trim();

  await sendMail(data.email, subject, body, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL,
  });
}

async function sendRoomJoinNotification(primary, joiner, joinerRef, settings) {
  const joinerCallsign = joiner.callsign.toUpperCase();
  const roomCfg = primary.roomId ? CONFIG.ROOMS.find(r => r.id === primary.roomId) : null;
  const s = settings;
  const liveRoomPrice = roomCfg
    ? ((s.ROOM_PRICES && s.ROOM_PRICES[roomCfg.id] !== undefined) ? s.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur)
    : null;
  const subject = `[Nordic VUSHF 2026] ${joinerCallsign} has joined your room — ${primary.bookingRef}`;

  const body = `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  NORDIC VUSHF MEETING 2026 — ROOM NOTICE
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Dear ${primary.name},

${joinerCallsign} (${joiner.name}) has joined your room booking.

Booking reference  : ${primary.bookingRef}
Their reference    : ${joinerRef}
${roomCfg ? `Room type          : ${roomCfg.note_en}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ROOM COSTS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${roomCfg ? `Room total price : \u20AC${liveRoomPrice}\nPer person (${roomCfg.persons} persons) : \u20AC${Math.round(liveRoomPrice / roomCfg.persons)}` : ""}

IMPORTANT: As the primary room booker, you are responsible
for settling the total room cost with your roommates.
Please agree amongst yourselves who pays what upon arrival.

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
PAYMENT
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
All payments are completed upon arrival at the venue.
Accepted: Cash, Visa, Mastercard
Not accepted: Amex, Diners Club
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

If you have any questions, please contact us: ${CONFIG.REPLY_TO_EMAIL}

73,
${CONFIG.EMAIL_SENDER_NAME}
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
`.trim();

  await sendMail(primary.email, subject, body, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL,
  });
}

async function sendRoomFullNotification(primary, roomCfg, allOccupants, settings) {
  const s = settings;
  const liveRoomPrice = (s.ROOM_PRICES && s.ROOM_PRICES[roomCfg.id] !== undefined) ? s.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur;
  const occupantList = allOccupants.map((b, i) =>
    `  ${i+1}. ${b.callsign.toUpperCase()} — ${b.name}${b.isPrimaryBooker === "YES" ? " (primary booker)" : ""}`
  ).join("\n");

  const bodyCore = `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  NORDIC VUSHF MEETING 2026 — ROOM NOTICE
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Room full!

Booking reference : ${primary.bookingRef}
Room type         : ${roomCfg.note_en}
Capacity          : ${roomCfg.persons} persons

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ROOM OCCUPANTS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${occupantList}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ROOM COSTS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Room total price : \u20AC${liveRoomPrice}
Per person       : \u20AC${Math.round(liveRoomPrice / roomCfg.persons)}
`.trim();

  const subjectPrimary = `[Nordic VUSHF 2026] Your room is full! — ${primary.bookingRef}`;
  const bodyPrimary = `${bodyCore}

All spots in your room have now been booked.

IMPORTANT: As the primary room booker, you are responsible
for settling the total room cost with your roommates.
Please agree amongst yourselves who pays what upon arrival.

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
If you have any questions, please contact us: ${CONFIG.REPLY_TO_EMAIL}

73,
${CONFIG.EMAIL_SENDER_NAME}
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`;

  await sendMail(primary.email, subjectPrimary, bodyPrimary, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL,
  });

  const subjectOrg = `[Nordic VUSHF 2026] Room full: ${primary.bookingRef} — ${roomCfg.note_en}`;
  const bodyOrg = `${bodyCore}

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`;

  await sendMail(CONFIG.REPLY_TO_EMAIL, subjectOrg, bodyOrg, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL,
  });
}

async function sendOrganizerNotification(data, bookingRef, price, settings) {
  const callsign = data.callsign.toUpperCase();
  const roomCfg = data.roomId ? CONFIG.ROOMS.find(r => r.id === data.roomId) : null;
  const orgSettings = settings;
  const mealLines = CONFIG.FULL_BOARD_INCLUDES_EN
    .filter(l => (data.type === 'room' || data.type === 'singlebed') ? true : !l.toLowerCase().includes('breakfast is included in all room'))
    .map(l => `  • ${l}`).join("\n");

  const subject = `[Nordic VUSHF 2026] New booking: ${callsign} — ${bookingRef}`;

  const body = `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  NORDIC VUSHF MEETING 2026 — NEW BOOKING NOTIFICATION
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
Days     : ${data.dayVisitorDays === "both" ? "Friday 15.5 + Saturday 16.5" : data.dayVisitorDays === "fri" ? "Friday 15.5 only" : "Saturday 16.5 only"}` : `Type     : ${data.type === "room" ? (roomCfg ? roomCfg.note_en : "Room") : data.type === "camper" ? "Camper van" : data.type === "tent" ? "Tent" : data.type}
${data.type === "room" && data.isPrimaryBooker ? `Role     : Primary booker (room holder)` : ""}
${data.type === "room" && !data.isPrimaryBooker ? `Role     : Joining existing room: ${data.roomRef}` : ""}
Thu extra night: ${data.thuExtraNight ? "YES" : "No"}`}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ORDERED SERVICES
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${price.breakdown.split(" | ").join("\n")}

Meal package: ${data.fullBoard ? "YES" : "No"}
${data.fullBoard ? `${mealLines}` : ""}
${!data.fullBoard && data.meals && Object.values(data.meals).some(Boolean) ? `Individual meals: ${[
  data.meals.friBbq   ? 'Fri BBQ' : '',
  data.meals.friLunch ? 'Fri lunch' : '',
  data.meals.satLunch ? 'Sat lunch' : '',
  data.meals.satHam   ? 'Sat Ham Dinner' : '',
].filter(Boolean).join(', ')}` : ""}
Dietary: ${data.dietary || "\u2014"}
T-shirt size: ${data.shirtSize || "\u2014"}
${data.freeText ? `\nAdditional info from booker:\n${data.freeText}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
TOTAL: \u20AC${price.total}
${price.total === 0 ? "(Price pending — check with organizers)" : ""}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
`.trim();

  await sendMail(CONFIG.REPLY_TO_EMAIL, subject, body, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: data.email,
  });
}

async function sendAccommodationChangeEmail_(booking, oldType, oldRoomCfg, newType, newRoomCfg, oldPrice, newPrice, settings) {
  const typeLabel = (type, cfg) => {
    if (type === 'room')       return cfg ? cfg.note_en : 'Room';
    if (type === 'camper')     return 'Camper van spot';
    if (type === 'tent')       return 'Tent';
    if (type === 'singlebed')  return 'Single bed (organizer-assigned)';
    if (type === 'dayvisitor') return 'Day visitor';
    return type;
  };
  const subject = `[Nordic VUSHF 2026] Accommodation change — ${booking.bookingRef}`;
  const sep = '\u2500'.repeat(57);
  const dsep = '\u2550'.repeat(59);
  const priceDiff = newPrice.total - oldPrice.total;
  const diffStr = priceDiff === 0 ? 'No change' : (priceDiff > 0 ? '+€' + priceDiff : '\u2212€' + Math.abs(priceDiff));

  const body = `
${dsep}
  NORDIC VUSHF MEETING 2026
  ACCOMMODATION CHANGE NOTICE
  ${CONFIG.LOCATION}
  ${CONFIG.DATE_FRI} \u2013 ${CONFIG.DATE_SUN}
${dsep}

Dear ${booking.name},

The organizers have updated your accommodation booking.

BOOKING REFERENCE: ${booking.bookingRef}

${sep}
CHANGE DETAILS
${sep}
Previous : ${typeLabel(oldType, oldRoomCfg)}
New      : ${typeLabel(newType, newRoomCfg)}

Previous total : \u20AC${oldPrice.total}
New total      : \u20AC${newPrice.total}
Difference     : ${diffStr}

${sep}
NEW PRICE BREAKDOWN
${sep}
${newPrice.breakdown.split(' | ').join('\n')}

${settings.PRICE_DISCLAIMER ? `\n* ${settings.PRICE_DISCLAIMER}` : ''}
${sep}
PAYMENT
${sep}
All payments are completed upon arrival at the venue.
Accepted: Cash · Visa · Mastercard  (no Amex/Diners)

${sep}
If you have any questions, please contact us:
${CONFIG.REPLY_TO_EMAIL}

73,
${CONFIG.EMAIL_SENDER_NAME}
${dsep}
`.trim();

  await sendMail(booking.email, subject, body, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL,
    bcc: CONFIG.REPLY_TO_EMAIL,
  });
}

module.exports = {
  sendMail,
  sendConfirmationEmail,
  sendRoomJoinNotification,
  sendRoomFullNotification,
  sendOrganizerNotification,
  sendAccommodationChangeEmail_,
};
