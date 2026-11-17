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

function loginPage(view) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${String(CONFIG.EVENT_SHORT).replace(/[<>&"]/g, "")} — Report</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:2rem;width:320px}h1{font-size:1.1rem;margin:0 0 1rem}
input{width:100%;padding:.55rem;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;margin-bottom:.75rem}
button{width:100%;padding:.55rem;border:0;border-radius:4px;background:#0f766e;color:#fff;font-weight:600;cursor:pointer}
#err{color:#b91c1c;font-size:.85rem;min-height:1.2em;margin-top:.5rem}</style></head><body>
<div class="box"><h1>${String(CONFIG.EVENT_NAME).replace(/[<>&"]/g, '')}<br>Report &amp; Check-in</h1>
<input type="password" id="pw" placeholder="Password" autofocus>
<button id="go">Log in</button><div id="err"></div></div>
<script>
var view=${JSON.stringify(view)};
function go(){var pw=document.getElementById('pw').value;if(!pw){return;}
fetch('/api/rpc/checkAdminPassword',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({args:[pw]})})
.then(function(r){return r.json();}).then(function(d){if(d.result){location.href='/report?view='+encodeURIComponent(view);}else{document.getElementById('err').textContent=d.error||'Wrong password';}})
.catch(function(){document.getElementById('err').textContent='Error';});}
document.getElementById('go').addEventListener('click',go);
document.getElementById('pw').addEventListener('keydown',function(e){if(e.key==='Enter')go();});
</script></body></html>`;
}

// Row shape used by the report views
function toReportRow(row, addonMap) {
  const o = repo.toObj(row);
  const extras = (addonMap && addonMap[row.id]) || [];
  return {
    extras, extrasText: extras.map(a => a.name + (a.qty > 1 ? ' x' + a.qty : '')).join(', '), paymentStatus: o.paymentStatus,
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
    (await db.query('SELECT booking_id, name, qty, unit_price FROM booking_addons ORDER BY addon_id')).rows.forEach(a => { (addonMap[a.booking_id] = addonMap[a.booking_id] || []).push({ name: a.name, qty: Number(a.qty), unitPrice: Number(a.unit_price) }); });
    const rows = (await repo.all(db)).filter(r => r.status !== 'CANCELLED').map(r => toReportRow(r, addonMap));
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
