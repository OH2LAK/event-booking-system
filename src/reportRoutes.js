'use strict';
const express = require('express');
const db = require('./db');
const repo = require('./repo');
const auth = require('./auth');
const report = require('./report');
const { getSettings } = require('./settings');
const { CONFIG } = require('./config');
const S = require('./structure');

const router = express.Router();

const jsonForScript = v => JSON.stringify(v).replace(/</g, '\\u003c');
function loginPage(view) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${String(CONFIG.EVENT_SHORT).replace(/[<>&"]/g, "")} — Report</title></head>
<body style="margin:0;background:#f6f8fa"><div id="auth-root"></div><script src="/admin-auth.js"></script>
<script>EbsAuth.mount(document.getElementById('auth-root'), { mode: 'admin', title: ${jsonForScript(String(CONFIG.EVENT_SHORT))},
  onReady: function () { location.href = '/report?view=' + encodeURIComponent(${jsonForScript(view)}); } });</script></body></html>`;
}

// Row shape used by the report views
function toReportRow(row, addonMap) {
  const o = repo.toObj(row);
  const extras = (addonMap && addonMap[row.id]) || [];
  return {
    extras, extrasText: extras.map(a => a.name + (a.qty > 1 ? ' x' + a.qty : '') + (a.note ? ' (' + a.note + ')' : '')).join(', '), paymentStatus: o.paymentStatus,
    bookingRef: o.bookingRef, callsign: o.callsign, name: o.name, email: o.email, phone: o.phone,
    country: o.country, type: o.type, roomId: o.roomId, roomRef: o.roomRef,
    isPrimary: o.isPrimaryBooker === 'YES', extraNights: S.keys(o.extraNights), nights: S.pickNights(o.nights), fullBoard: o.fullBoard === 'YES',
    dietary: o.dietary, shirtSize: o.shirtSize, totalPrice: o.totalPrice, status: o.status,
    roomNumber: o.roomNumber, isOrganizer: o.isOrganizer === 'YES', visitorDays: S.keys(o.visitorDays),
    soloRoom: o.soloRoom === 'YES', freeText: o.freeText, orgComment: o.orgComment, checkedIn: o.status === 'CHECKED_IN',
  };
}

router.get('/report', async (req, res, next) => {
  try {
    const view = String(req.query.view || 'hotel');
    res.set('X-Frame-Options', 'DENY');
    if (!auth.isAdmin(req)) return res.type('html').send(loginPage(view));
    const settings = await getSettings();
    report.setRC(settings);
    const addonMap = {};
    (await db.query('SELECT booking_id, name, qty, unit_price, note FROM booking_addons ORDER BY addon_id')).rows.forEach(a => { (addonMap[a.booking_id] = addonMap[a.booking_id] || []).push({ name: a.name, qty: Number(a.qty), unitPrice: Number(a.unit_price), note: a.note || '' }); });
    const ticketMap = {};
    (await db.query('SELECT booking_id, name FROM booking_tickets ORDER BY booking_id, sort')).rows.forEach(t => { (ticketMap[t.booking_id] = ticketMap[t.booking_id] || []).push(t.name); });
    const rows = (await repo.all(db)).filter(r => r.status !== 'CANCELLED').map(r => Object.assign(toReportRow(r, addonMap), { tickets: ticketMap[r.id] || [] }));
    if (req.query.fmt === 'csv') {
      const csv = report.buildCsv_(rows);
      res.set('Content-Disposition', `attachment; filename="${csv.filename}"`);
      return res.type('text/csv; charset=utf-8').send(csv.content);
    }
    const safe = report.escapeRows(rows);
    const ref = String(req.query.ref || '');
    let html;
    if (view === 'checkin') html = report.checkinView_(safe, ref);
    else if (view === 'summary') html = report.summaryView_(safe);
    else if (view === 'print') html = report.printView_(safe, ref);
    else html = report.hotelView_(safe);
    res.type('html').send(html);
  } catch (e) { next(e); }
});

router.post('/report/checkin', async (req, res) => {
  if (!auth.isAdmin(req)) return res.status(401).json({ ok: false, error: 'Istunto vanhentunut, kirjaudu uudelleen' });
  const ref = String((req.body && req.body.ref) || '');
  const r = await db.query(`UPDATE bookings SET status = 'CHECKED_IN' WHERE booking_ref = $1 AND status <> 'CANCELLED'`, [ref]);
  if (!r.rowCount) return res.json({ ok: false, error: 'Booking not found: ' + ref });
  db.logEvent('OK', 'checked_in', '', ref);
  res.json({ ok: true });
});

module.exports = router;
