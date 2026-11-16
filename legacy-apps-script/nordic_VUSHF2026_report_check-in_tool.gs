// =============================================================================
// TOKEN AUTH — 24h session tokens stored in Script Properties
// =============================================================================
var TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function generateToken_() {
  var token = Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    RC.ADMIN_PASSWORD + new Date().getTime() + Math.random()
  )).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  var props = PropertiesService.getScriptProperties();
  props.setProperty('auth_token', token);
  props.setProperty('auth_token_ts', new Date().getTime().toString());
  return token;
}

function validateToken_(token) {
  if (!token) return false;
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty('auth_token');
  var ts     = parseInt(props.getProperty('auth_token_ts') || '0');
  if (!stored || token !== stored) return false;
  if (new Date().getTime() - ts > TOKEN_TTL_MS) return false;
  return true;
}

// =============================================================================
// NORDIC VUSHF MEETING 2026 — REPORT & CHECK-IN TOOL
// Separate GAS project reading the same Bookings sheet as the booking system.
// Deploy as Web App (Execute as: Me, Who has access: Anyone with the link)
//
// Views:
//   ?view=hotel    — Hotel list (grouped by room, pre-event delivery to hotel)
//   ?view=checkin  — Check-in desk: search + printable per-guest confirmation
//   ?view=summary  — Summary stats and meal counts
// =============================================================================

const SHEET_ID = 'REDACTED_SHEET_ID';

function testAuth() {
  UrlFetchApp.fetch('https://www.google.com');
  Logger.log('Auth OK');
}

const VERSION = '20260504-2136';  // ← update when deploying a new version

const RC = {
  SHEET_ID:       SHEET_ID,
  SHEET_NAME:     'Bookings',
  ADMIN_PASSWORD: 'REDACTED_ADMIN_PASSWORD',

  EVENT_NAME:  'Nordic VUSHF Meeting 2026',
  ORGANIZER:   'RATS – Radio Amateur Technology Society of Finland',
  LOCATION:    'Hotelli Martinhovi, Raisio, Finland',
  DATES_EN:    'Fri–Sun 15–17 May 2026',
  DATES_FI:    'Pe–Su 15–17.5.2026',
  CHECKIN_EN:  'Check-in from 15:00 on Thursday/Friday',
  CHECKIN_FI:  'Sisäänkirjautuminen to/pe alkaen klo 15:00',
  CHECKOUT_EN: 'Check-out by 12:00 on Sunday',
  CHECKOUT_FI: 'Uloskirjautuminen su klo 12:00 mennessä',

  ROOMS: [
    { id: '1S-W',  note_en: 'Single room, window, upstairs',    note_fi: '1hh huone, ikkuna, yläkerta',      persons: 1, price: 220 },
    { id: '1S-NW', note_en: 'Single room, NO WINDOW, upstairs', note_fi: '1hh huone ilman ikkunaa, yläkerta', persons: 1, price: 200 },
    { id: '2S',    note_en: 'Double room, upstairs',            note_fi: '2hh huone, yläkerta',             persons: 2, price: 270 },
    { id: '3S-U',  note_en: 'Triple room, upstairs',            note_fi: '3hh huone, yläkerta',             persons: 3, price: 330 },
    { id: '3S',    note_en: 'Triple room, downstairs',          note_fi: '3hh huone, alakerta',             persons: 3, price: 330 },
    { id: '4S',    note_en: 'Quad room, downstairs',            note_fi: '4hh huone, alakerta',             persons: 4, price: 400 },
    { id: '7S',    note_en: 'Seven-person room, downstairs',    note_fi: '7hh huone, alakerta',          persons: 7, price: 540 },
  ],

  FULL_BOARD_PRICE:    75,
  MEETING_FEE_WEEKEND: 10,
  MEETING_FEE_DAY:     5,
  CAMPER_PRICE:        40,
  TENT_PRICE:          10,
  THU_EXTRA_PRICE:     null,

  MEALS_EN: ['Friday: BBQ dinner', 'Saturday: lunch', 'Saturday: Ham Dinner'],
  MEALS_FI:  ['Perjantai: BBQ-illallinen', 'Lauantai: lounas', 'Lauantai: Ham Dinner'],
};

// =============================================================================
// ENTRY POINT
// =============================================================================
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'login') {
      if (data.pw !== RC.ADMIN_PASSWORD) return jsonResp_({ok:false,error:'Väärä salasana'});
      var token = generateToken_();
      return jsonResp_({ok:true, token:token});
    }
    // All other actions require token auth
    if (!validateToken_(data.token)) return jsonResp_({ok:false,error:'Istunto vanhentunut, kirjaudu uudelleen'});
    if (data.action === 'checkin') return jsonResp_(checkIn_(data.ref));
    return jsonResp_({ok:false,error:'Unknown action'});
  } catch(err) {
    return jsonResp_({ok:false,error:err.message});
  }
}

function jsonResp_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkIn_(ref) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(RC.SHEET_NAME);
  var data  = sheet.getDataRange().getValues();
  var hdrs  = data[0];
  var refIdx    = hdrs.indexOf('BookingRef');
  var statusIdx = hdrs.indexOf('Status');
  for (var i = 1; i < data.length; i++) {
    if (data[i][refIdx] === ref) {
      sheet.getRange(i + 1, statusIdx + 1).setValue('CHECKED_IN');
      return {ok:true};
    }
  }
  return {ok:false, error:'Booking not found: ' + ref};
}

function doGet(e) {
  const p     = e && e.parameter ? e.parameter : {};
  const token = p.token || '';
  const view  = p.view  || 'hotel';
  const ref   = p.ref   || '';
  const fmt   = p.fmt   || 'html';

  if (!validateToken_(token)) return loginPage_();
  const rows = getBookings_();
  if (fmt === 'csv')  return buildCsv_(rows);
  if (fmt === 'xlsx') return buildXlsx_();

  var html;
  if      (view === 'hotel')   html = hotelView_(rows, token);
  else if (view === 'checkin') html = checkinView_(rows, token, ref);
  else if (view === 'summary') html = summaryView_(rows, token);
  else if (view === 'print')   html = printView_(rows, token, ref);
  else                         html = hotelView_(rows, pw);

  return HtmlService.createHtmlOutput(html)
    .setTitle('VUSHF 2026')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =============================================================================
// DATA
// =============================================================================
function getBookings_() {
  const ss    = RC.SHEET_ID
    ? SpreadsheetApp.openById(RC.SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RC.SHEET_NAME);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0];
  const idx  = {};
  hdrs.forEach(function(h, i) { idx[h] = i; });
  return data.slice(1)
    .filter(function(r) { return r[idx['Status']] !== 'CANCELLED' && r[idx['BookingRef']]; })
    .map(function(r) { return {
      bookingRef: r[idx['BookingRef']]      || '',
      callsign:   r[idx['Callsign']]        || '',
      name:       r[idx['Name']]            || '',
      email:      r[idx['Email']]           || '',
      phone:      r[idx['Phone']]           || '',
      country:    r[idx['Country']]         || '',
      type:       r[idx['Type']]            || '',
      roomId:     r[idx['RoomId']]          || '',
      roomRef:    r[idx['RoomRef']]         || '',
      isPrimary:  r[idx['IsPrimaryBooker']] === 'YES',
      thuExtra:   r[idx['ThuExtraNight']]   === 'YES',
      fullBoard:  r[idx['FullBoard']]       === 'YES',
      meals:      r[idx['Meals']]           || '',
      dietary:    r[idx['Dietary']]         || '',
      shirtSize:  r[idx['ShirtSize']]       || '',
      totalPrice: parseFloat(r[idx['TotalPrice']]) || 0,
      status:     r[idx['Status']]          || '',
      roomNumber: r[idx['RoomNumber']]      || '',
      isOrganizer:r[idx['IsOrganizer']]     === 'YES',
      dayVisitorDays: r[idx['DayVisitorDays']] || '',
      soloRoom:   r[idx['SoloRoom']]        === 'YES',
      freeText:   r[idx['FreeText']]        || '',
      orgComment: r[idx['OrgComment']]      || '',
      checkedIn:  r[idx['Status']]          === 'CHECKED_IN',
    };});
}

function calcPrices_(r) {
  var acc = 0, meals = 0, fee = 0;
  var rc = RC.ROOMS.find(function(x) { return x.id === r.roomId; });
  if (r.type === 'room' || r.type === 'singlebed') {
    if (r.isPrimary && rc) acc = rc.price / rc.persons;
    if (r.thuExtra && RC.THU_EXTRA_PRICE) acc += RC.THU_EXTRA_PRICE;
    fee = RC.MEETING_FEE_WEEKEND;
  } else if (r.type === 'camper') {
    if (r.isPrimary) acc = RC.CAMPER_PRICE;
    fee = RC.MEETING_FEE_WEEKEND;
  } else if (r.type === 'tent') {
    acc = RC.TENT_PRICE; fee = RC.MEETING_FEE_WEEKEND;
  } else if (r.type === 'dayvisitor') {
    fee = r.dayVisitorDays === 'both' ? RC.MEETING_FEE_WEEKEND : RC.MEETING_FEE_DAY;
  }
  if (r.fullBoard) meals = RC.FULL_BOARD_PRICE;
  return { accommodation: acc, meals: meals, hotelTotal: acc + meals, meetingFee: fee, total: acc + meals + fee };
}

// =============================================================================
// SHARED LAYOUT
// =============================================================================
var BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#1f2937;background:#f9fafb}
.page{max-width:1200px;margin:0 auto;padding:1.5rem}
h1{font-size:1.3rem;margin-bottom:0.2rem}
h2{font-size:1rem;font-weight:700;margin:1.25rem 0 0.5rem;padding-bottom:0.3rem;border-bottom:2px solid #e5e7eb;color:#374151}
.meta{font-size:0.78rem;color:#6b7280;margin-bottom:1rem}
.toolbar{display:flex;gap:0.5rem;margin-bottom:1.25rem;flex-wrap:wrap;align-items:center}
.ts{font-size:0.75rem;color:#9ca3af;margin-left:auto}
.btn{padding:0.35rem 0.85rem;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:0.8rem;text-decoration:none;color:#374151;white-space:nowrap;display:inline-block}
.btn:hover{background:#f3f4f6}
.btn-active{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:1rem}
th{background:#f3f4f6;font-weight:600;text-align:left;padding:0.4rem 0.6rem;border-bottom:1px solid #e5e7eb;white-space:nowrap;font-size:0.78rem}
td{padding:0.32rem 0.6rem;border-bottom:1px solid #f3f4f6;vertical-align:middle;font-size:0.8rem}
tr:last-child td{border-bottom:none}
.num{text-align:right;font-family:monospace}
.bold{font-weight:700}
.joiner td{background:#fafafa;color:#6b7280}
.joiner td:first-child{padding-left:1.5rem}
.attention td{background:#fffbeb!important}
.cards{display:flex;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:0.7rem 1rem;min-width:120px}
.card .lbl{font-size:0.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em}
.card .val{font-size:1.35rem;font-weight:700}
.card .sub{font-size:0.72rem;color:#9ca3af}
.badge{display:inline-block;font-size:0.68rem;font-weight:700;padding:1px 5px;border-radius:3px;vertical-align:middle;margin-left:3px}
.badge-staff{background:#ede9fe;color:#6d28d9}
.badge-attn{background:#fef3c7;color:#92400e}
.infobox{background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;padding:0.5rem 0.75rem;margin-bottom:0.75rem;font-size:0.8rem;color:#1e40af}
@media print{
  body{background:#fff;font-size:11px}
  .no-print{display:none!important}
  .print-only{display:block!important}
  .page{padding:0;max-width:100%}
  table{font-size:10px}
  .print-break{page-break-after:always}
}`;

function nav_(token, active) {
  var u = ScriptApp.getService().getUrl() + '?token=' + encodeURIComponent(token);
  function t(v, lbl) {
    return '<a href="' + u + '&view=' + v + '" target="_top" class="btn' + (v===active?' btn-active':'') + '">' + lbl + '</a>';
  }
  return '<div class="toolbar">'
    + t('hotel','🏨 Hotellilista') + t('checkin','✅ Sisäänkirjautuminen') + t('summary','📊 Yhteenveto')
    + '<a href="' + u + '&fmt=xlsx" class="btn" target="_blank">⬇ Excel</a>'
    + '<a href="' + u + '&fmt=csv" class="btn" target="_top" title="CSV — avautuu Excelissä">⬇ CSV</a>'
    + '<button class="btn" onclick="printPdf()" title="Tulosta / Tallenna PDF:nä">🖨 PDF</button>'
    + '<span class="ts">' + Utilities.formatDate(new Date(),'Europe/Helsinki','dd.MM.yyyy HH:mm') + '</span>'
    + '<button class="btn" onclick="localStorage.removeItem(\'vushf_pw\');window.top.location=\'' + ScriptApp.getService().getUrl() + '\'" title="Kirjaudu ulos" style="color:#9ca3af">🔒</button>'
    + '</div>';
}

function wrap_(title, body, token, active) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>VUSHF 2026 — ' + title + '</title>'
    + '<style>' + BASE_CSS + '</style>'
    + '<script>console.log("%c Nordic VUSHF 2026 Report & Check-in %c v' + VERSION + ' ","background:#0f766e;color:#fff;font-weight:bold","background:#e5e7eb;color:#374151");</script>'
    + '</head><body><div class="page">'
    + '<h1>Nordic VUSHF Meeting 2026</h1>'
    + '<div class="meta">' + RC.LOCATION + ' · ' + RC.DATES_EN + '</div>'
    + nav_(token, active) + body + '</div>'
    + '<script>function printPdf(){'
    + 'var tip=document.createElement("div");'
    + 'tip.style="position:fixed;bottom:1rem;right:1rem;background:#1d4ed8;color:#fff;padding:0.75rem 1rem;border-radius:6px;font-size:0.85rem;z-index:9999;max-width:260px";'
    + 'tip.innerHTML="Valitse tulostimeksi <strong>Tallenna PDF:nä</strong> tai <strong>Save as PDF</strong>";'
    + 'document.body.appendChild(tip);'
    + 'setTimeout(function(){window.print();document.body.removeChild(tip);},600);'
    + '}</script>'
    + '</body></html>';
}

// =============================================================================
// VIEW 1: HOTEL LIST
// Grouped by room: primary + joiners; then camper/tent/dayvisitor
// =============================================================================

function mealLabel_(r) {
  if (r.fullBoard) return '✓ Pe BBQ<br>✓ La lounas<br>✓ La Ham Dinner';
  if (!r.meals) return '—';
  var m = r.meals.toLowerCase();
  var parts = [];
  if (m.includes('fri') || m.includes('bbq'))           parts.push('Pe BBQ');
  if (m.includes('lunch'))                               parts.push('La lounas');
  if (m.includes('dinner') || m.includes('ham dinner')) parts.push('La Ham Dinner');
  return parts.length ? parts.join('<br>') : r.meals;
}
function hotelView_(rows, token) {
  var body = '<h2>🏨 Hotellilista</h2>'
    + '<div class="infobox">Hotellille ja ravintolalle toimitettava ennakkokoonti. '
    + 'Pe–Su ja To–Su majoittujat eritelty omiin listoihinsa. '
    + 'Erityisruokavaliot listattu lopussa.</div>';

  // Helper: build a room guest table for a given set of primaries
  function roomTable(primaries, allRows) {
    if (!primaries.length) return '';
    // Group primaries by roomId, then sort within group by roomNumber then callsign
    var byType = {};
    primaries.forEach(function(p) {
      if (!byType[p.roomId]) byType[p.roomId] = [];
      byType[p.roomId].push(p);
    });
    // Sort each group by roomNumber then callsign
    Object.keys(byType).forEach(function(id) {
      byType[id].sort(function(a,b) {
        var an = parseInt(a.roomNumber)||999, bn = parseInt(b.roomNumber)||999;
        if (an !== bn) return an - bn;
        return a.callsign.localeCompare(b.callsign);
      });
    });
    // Output in ROOMS config order
    var tRows = '';
    RC.ROOMS.forEach(function(rc) {
      var group = byType[rc.id];
      if (!group || !group.length) return;
      // Section header for room type
      tRows += '<tr style="background:#e0e7ff"><td colspan="7" style="font-weight:700;font-size:0.8rem;color:#3730a3;padding:0.35rem 0.6rem">'
        + '🏠 ' + rc.note_fi + ' (€' + rc.price + '/huone · max ' + rc.persons + ' hlö/huone)</td></tr>';
      group.forEach(function(p) {
        var joiners = allRows.filter(function(r) { return r.roomRef===p.bookingRef && !r.isPrimary && r.type==='room'; });
        [p].concat(joiners).forEach(function(r,i) {
          var badges = (r.isOrganizer ? '<span class="badge badge-staff">👷</span>' : '')
                     + (r.status==='NEEDS_ATTENTION' ? '<span class="badge badge-attn">⚠</span>' : '');
          tRows += '<tr class="' + (i>0?'joiner':'') + (r.status==='NEEDS_ATTENTION'?' attention':'') + '">'
            + '<td>' + (i>0?'↳ ':'') + '<strong style="font-family:monospace">' + r.callsign + '</strong>' + badges + '</td>'
            + '<td>' + r.name + '</td>'
            + '<td>' + r.country + '</td>'
            + '<td class="num" style="font-weight:700">' + (i===0 ? (p.roomNumber||'<em style="color:#9ca3af">—</em>') : '') + '</td>'
            + '<td>' + mealLabel_(r) + '</td>'
            + '<td>' + (r.dietary?'<span style="color:#b45309">⚠ '+r.dietary+'</span>':'—') + '</td>'
            + '</tr>';
        });
      });
    });

    return '<table><thead><tr>'
      + '<th>Kutsu</th><th>Nimi</th><th>Maa</th><th class="num">Huone nro</th><th>Ruokailu</th><th>Erityisruokavalio</th>'
      + '</tr></thead><tbody>' + tRows + '</tbody></table>';
  }

  // Split room primaries into Thu starters and Fri starters
  var roomPrimaries = rows.filter(function(r) { return r.type==='room' && r.isPrimary; });
  var thuPrimaries = roomPrimaries.filter(function(r) { return r.thuExtra; });
  var friPrimaries = roomPrimaries.filter(function(r) { return !r.thuExtra; });

  if (thuPrimaries.length) {
    body += '<h2>🌙 To–Su majoittujat (' + thuPrimaries.length + ' huonetta)</h2>';
    body += roomTable(thuPrimaries, rows);
  }
  if (friPrimaries.length) {
    body += '<h2>🏨 Pe–Su majoittujat (' + friPrimaries.length + ' huonetta)</h2>';
    body += roomTable(friPrimaries, rows);
  }

  // Campers
  var camperPrimaries = rows.filter(function(r) { return r.type==='camper' && r.isPrimary; });
  if (camperPrimaries.length) {
    body += '<h2>🚐 Matkailuautopaikat (' + camperPrimaries.length + ' paikkaa)</h2>'
      + '<table><thead><tr><th>Kutsu</th><th>Nimi</th><th>Maa</th><th>Varausviite</th><th>Ruokailu</th><th>Erityisruokavalio</th></tr></thead><tbody>';
    camperPrimaries.forEach(function(p) {
      var joiners = rows.filter(function(r) { return r.roomRef===p.bookingRef && !r.isPrimary && r.type==='camper'; });
      [p].concat(joiners).forEach(function(r,i) {
        body += '<tr class="' + (i>0?'joiner':'') + '">'
          + '<td>' + (i>0?'↳ ':'🚐 ') + '<strong style="font-family:monospace">' + r.callsign + '</strong></td>'
          + '<td>' + r.name + '</td><td>' + r.country + '</td>'
          + '<td style="font-family:monospace;font-size:0.75rem">' + (i===0?p.bookingRef:'') + '</td>'
          + '<td>' + mealLabel_(r) + '</td>'
          + '<td>' + (r.dietary?'<span style="color:#b45309">⚠ '+r.dietary+'</span>':'—') + '</td></tr>';
      });
    });
    body += '</tbody></table>';
  }

  // Tent
  var tents = rows.filter(function(r) { return r.type==='tent'; });
  if (tents.length) {
    body += '<h2>⛺ Telttavieraat (' + tents.length + ')</h2>'
      + '<table><thead><tr><th>Kutsu</th><th>Nimi</th><th>Maa</th><th>Ruokailu</th><th>Erityisruokavalio</th></tr></thead><tbody>';
    tents.forEach(function(r) {
      body += '<tr><td><strong style="font-family:monospace">' + r.callsign + '</strong></td>'
        + '<td>' + r.name + '</td><td>' + r.country + '</td>'
        + '<td>' + mealLabel_(r) + '</td>'
        + '<td>' + (r.dietary?'<span style="color:#b45309">⚠ '+r.dietary+'</span>':'—') + '</td></tr>';
    });
    body += '</tbody></table>';
  }

  // Day visitors
  var dvs = rows.filter(function(r) { return r.type==='dayvisitor'; });
  if (dvs.length) {
    body += '<h2>🎫 Päivävieraat (' + dvs.length + ')</h2>'
      + '<table><thead><tr><th>Kutsu</th><th>Nimi</th><th>Maa</th><th>Päivät</th><th>Ruokailu</th><th>Erityisruokavalio</th></tr></thead><tbody>';
    dvs.forEach(function(r) {
      var days = r.dayVisitorDays==='both'?'Pe+La':r.dayVisitorDays==='fri'?'Pe':'La';
      body += '<tr><td><strong style="font-family:monospace">' + r.callsign + '</strong></td>'
        + '<td>' + r.name + '</td><td>' + r.country + '</td><td>' + days + '</td>'
        + '<td>' + mealLabel_(r) + '</td>'
        + '<td>' + (r.dietary?'<span style="color:#b45309">⚠ '+r.dietary+'</span>':'—') + '</td></tr>';
    });
    body += '</tbody></table>';
  }

  // Meal counts
  var fb       = rows.filter(function(r){return r.fullBoard;}).length;
  var fri      = rows.filter(function(r){return r.fullBoard||(r.meals&&r.meals.toLowerCase().includes('fri'));}).length;
  var satLunch = rows.filter(function(r){return r.fullBoard||(r.meals&&r.meals.toLowerCase().includes('lunch'));}).length;
  var satDin   = rows.filter(function(r){return r.fullBoard||(r.meals&&r.meals.toLowerCase().includes('dinner'));}).length;
  var thu      = rows.filter(function(r){return r.thuExtra;}).length;

  body += '<h2>🍽 Ateriamäärät ravintolalle</h2>'
    + '<table style="max-width:380px"><thead><tr><th>Ateria</th><th class="num">kpl</th></tr></thead><tbody>'
    + '<tr><td>Täyshoitopaketit</td><td class="num bold">' + fb + '</td></tr>'
    + '<tr><td style="padding-left:1.5rem;color:#6b7280">Pe BBQ-illallinen</td><td class="num">' + fri + '</td></tr>'
    + '<tr><td style="padding-left:1.5rem;color:#6b7280">La lounas</td><td class="num">' + satLunch + '</td></tr>'
    + '<tr><td style="padding-left:1.5rem;color:#6b7280">La Ham Dinner</td><td class="num">' + satDin + '</td></tr>'
    + '<tr><td>To-lisäyö (aamiaiset)</td><td class="num">' + thu + '</td></tr>'
    + '</tbody></table>';

  // Dietary
  var dietary = rows.filter(function(r) { return r.dietary; });
  if (dietary.length) {
    body += '<h2>⚠ Erityisruokavaliot</h2><table style="max-width:600px">'
      + '<thead><tr><th>Kutsu</th><th>Nimi</th><th>Erityisruokavalio</th></tr></thead><tbody>';
    dietary.forEach(function(r) {
      body += '<tr><td><strong style="font-family:monospace">' + r.callsign + '</strong></td>'
        + '<td>' + r.name + '</td><td style="color:#b45309">' + r.dietary + '</td></tr>';
    });
    body += '</tbody></table>';
  }

  return wrap_('Hotellilista', body, token, 'hotel');
}

// =============================================================================
// VIEW 2: CHECK-IN DESK
// Search box + alphabetical list → click → printable A4 confirmation slip
// =============================================================================
function checkinView_(rows, token, preRef) {
  var url = ScriptApp.getService().getUrl() + '?token=' + encodeURIComponent(token) + '&view=checkin';
  var slipHtml = '';
  if (preRef) {
    var target = rows.find(function(r) { return r.bookingRef === preRef; });
    slipHtml = target ? confirmationSlip_(rows, target, pw) : '<div style="color:red;padding:0.5rem">Varausta ei löydy: ' + preRef + '</div>';
  }

  var sorted = rows.slice().sort(function(a,b){ return a.callsign.localeCompare(b.callsign); });
  var listRows = sorted.map(function(r) {
    var icon = r.checkedIn?'✅':(r.type==='room'?(r.isPrimary?'🏠':'↳'):r.type==='camper'?'🚐':r.type==='tent'?'⛺':'🎫');
    var room = r.roomId + (r.roomNumber?' / '+r.roomNumber:'');
    var attn = r.status==='NEEDS_ATTENTION'?' <span class="badge badge-attn">⚠</span>':'';
    return '<tr onclick="showRef(\'' + r.bookingRef + '\')" style="cursor:pointer">'
      + '<td>' + icon + ' <strong style="font-family:monospace">' + r.callsign + '</strong>' + attn + '</td>'
      + '<td>' + r.name + '</td><td>' + r.country + '</td>'
      + '<td>' + (r.type==='room'||r.type==='singlebed'?room:r.type) + '</td>'
      + '<td>' + (r.fullBoard?'✓ TB':r.meals?'yks.':'') + '</td>'
      + '</tr>';
  }).join('');

  var body = '<h2>✅ Ilmoittautumistiski</h2>'
    + '<div class="infobox no-print">Hae kutsumerkillä tai nimellä — klikkaa riviä avataksesi vahvistuksen.</div>'
    + '<div class="no-print" style="display:flex;gap:0.5rem;margin-bottom:0.75rem">'
    + '<input id="srch" type="text" placeholder="Kutsu tai nimi..." oninput="doFilter()" autofocus '
    + 'style="flex:1;padding:0.45rem 0.7rem;border:1px solid #d1d5db;border-radius:4px;font-size:0.9rem">'
    + '<button class="btn" onclick="clearAll()">✕</button></div>'
    + '<div id="list-wrap" class="no-print">'
    + '<table><thead><tr><th>Kutsu</th><th>Nimi</th><th>Maa</th><th>Huone</th><th>Ruokailu</th></tr></thead>'
    + '<tbody id="glist">' + listRows + '</tbody></table></div>'
    + '<div id="slip-wrap">' + slipHtml + '</div>'
    // Printable full list (only visible when printing, no slip selected)
    + '<div class="print-only" style="display:none">'
    + '<h2>Ilmoittautumislista — ' + RC.EVENT_NAME + '</h2>'
    + '<table><thead><tr><th>#</th><th>Kutsu</th><th>Nimi</th><th>Maa</th><th>Huone</th><th>To</th><th>Ruokailu</th><th>✓</th></tr></thead>'
    + '<tbody>' + sorted.map(function(r, i) {
        var room = (r.type==='room'||r.type==='singlebed') ? r.roomId+(r.roomNumber?' / '+r.roomNumber:'') : r.type;
        return '<tr>'
          + '<td style="color:#9ca3af;font-size:0.75rem">'+(i+1)+'</td>'
          + '<td><strong style="font-family:monospace">'+r.callsign+'</strong></td>'
          + '<td>'+r.name+'</td>'
          + '<td>'+r.country+'</td>'
          + '<td>'+room+'</td>'
          + '<td>'+(r.thuExtra?'✓':'')+'</td>'
          + '<td>'+(r.fullBoard?'TB':r.meals?'yks.':'—')+'</td>'
          + '<td style="width:2rem;border:1px solid #d1d5db">&nbsp;</td>'
          + '</tr>';
      }).join('')
    + '</tbody></table></div>'
    + '<script>'
    + 'function doFilter(){var q=document.getElementById("srch").value.toLowerCase();'
    + 'Array.from(document.getElementById("glist").rows).forEach(function(r){r.style.display=r.textContent.toLowerCase().includes(q)?"":"none";});}'
    + 'function clearAll(){document.getElementById("srch").value="";doFilter();'
    + 'document.getElementById("slip-wrap").innerHTML="";document.getElementById("list-wrap").style.display="";}'
    + 'function showRef(ref){window.top.location="' + url + '&ref="+ref;}'
    + (preRef ? 'document.getElementById("list-wrap").style.display="none";' : '')
    + '</script>';

  return wrap_('Sisäänkirjautuminen', body, token, 'checkin');
}

function confirmationSlip_(rows, r, pw) {
  var p   = calcPrices_(r);
  var rc  = RC.ROOMS.find(function(x){return x.id===r.roomId;})||{};
  var backUrl = ScriptApp.getService().getUrl()+'?token='+encodeURIComponent(token)+'&view=checkin';

  // Roommates
  var mates = [];
  if ((r.type==='room'||r.type==='camper') && r.isPrimary) {
    mates = rows.filter(function(x){return x.roomRef===r.bookingRef && x.bookingRef!==r.bookingRef;});
  } else if (r.type==='room'||r.type==='camper') {
    var pri = rows.find(function(x){return x.bookingRef===r.roomRef;});
    if (pri) mates = [pri].concat(rows.filter(function(x){
      return x.roomRef===r.roomRef && x.bookingRef!==r.bookingRef && x.bookingRef!==pri.bookingRef;
    }));
  }

  // Accommodation text EN + FI
  var acc='';
  if (r.type==='room'||r.type==='singlebed') {
    acc = rc.note_en||r.roomId;
    if (r.roomNumber) acc+=' — Room '+r.roomNumber;
    else acc+=' — Room number TBD';
    if (r.thuExtra) acc+=' + Thu extra night';
  } else if (r.type==='camper') {
    acc='Camper van spot (2 nights, incl. electricity)';
    if (!r.isPrimary) acc+=' — joining '+r.roomRef;
  } else if (r.type==='tent') {
    acc='Tent pitch (2 nights)';
  } else if (r.type==='singlebed') {
    acc='Single bed — Room '+(r.roomNumber||'TBD');
  } else if (r.type==='dayvisitor') {
    var days=r.dayVisitorDays==='both'?'Friday+Saturday':r.dayVisitorDays==='fri'?'Friday only':'Saturday only';
    acc='Day visitor ('+days+')';
  }

  // Meals text EN + FI
  var meals='';
  if (r.fullBoard) {
    meals='Full board: '+RC.MEALS_EN.join(', ');
  } else if (r.meals) {
    meals='Individual meals: '+r.meals;
  } else {
    meals='No meal package';
  }

  var matesHtml = '';
  if (mates.length) {
    matesHtml = '<tr><td colspan="2" style="padding-top:0.4rem;font-weight:700;font-size:0.8rem">'
      + 'Roommates</td></tr>';
    mates.forEach(function(x) {
      matesHtml += '<tr><td style="padding-left:1rem;color:#374151;font-family:monospace">' + x.callsign + '</td>'
        + '<td>' + x.name + (x.fullBoard?' · Full board':x.meals?' · '+x.meals:'') + '</td></tr>';
    });
  }

  var attnHtml = r.status==='NEEDS_ATTENTION'
    ? '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;padding:0.5rem 0.75rem;margin-bottom:0.75rem;font-size:0.82rem;color:#92400e">⚠ NEEDS ATTENTION — please check with organizer before proceeding</div>'
    : '';

  return '<div class="print-break" style="background:#fff;border:2px solid #1d4ed8;border-radius:8px;padding:1.25rem;margin-bottom:1rem;max-width:680px">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem">'
    +   '<div>'
    +     '<div style="font-size:1.2rem;font-weight:800;font-family:monospace">' + r.callsign + '</div>'
    +     '<div style="font-size:1rem;color:#374151">' + r.name + '</div>'
    +     '<div style="font-size:0.78rem;color:#6b7280">' + r.country + (r.phone?' · '+r.phone:'') + '</div>'
    +   '</div>'
    +   '<div style="text-align:right">'
    +     '<div style="font-size:0.68rem;color:#6b7280;text-transform:uppercase">Booking ref / Varausviite</div>'
    +     '<div style="font-size:1rem;font-weight:700;font-family:monospace;color:#1d4ed8">' + r.bookingRef + '</div>'
    +     '<div style="font-size:0.68rem;color:#6b7280;margin-top:0.2rem">Nordic VUSHF Meeting 2026</div>'
    +   '</div>'
    + '</div>'
    + attnHtml
    + '<table style="margin-bottom:0.75rem;border:1px solid #e5e7eb">'
    +   '<tr style="background:#eff6ff">'
    +     '<td style="font-weight:700;padding:0.35rem 0.6rem;width:44%;font-size:0.82rem">Accommodation</td>'
    +     '<td style="padding:0.35rem 0.6rem;font-size:0.82rem">' + acc + '</td>'
    +   '</tr>'
    +   '<tr>'
    +     '<td style="font-weight:700;padding:0.35rem 0.6rem;font-size:0.82rem">Meals</td>'
    +     '<td style="padding:0.35rem 0.6rem;font-size:0.82rem">' + meals + '</td>'
    +   '</tr>'
    + (r.dietary ? '<tr><td style="font-weight:700;padding:0.35rem 0.6rem;color:#b45309;font-size:0.82rem">⚠ Dietary requirement</td><td style="padding:0.35rem 0.6rem;color:#b45309;font-size:0.82rem">' + r.dietary + '</td></tr>' : '')
    + matesHtml
    + '</table>'
    // Payment table
    + '<table style="border:1px solid #e5e7eb;max-width:420px;margin-bottom:0.75rem">'
    +   '<thead><tr style="background:#f3f4f6"><th colspan="2" style="font-size:0.82rem">Payment / Maksu</th></tr></thead>'
    +   '<tbody>'
    + (p.accommodation>0?'<tr><td style="font-size:0.8rem">Accommodation</td><td class="num">€'+p.accommodation.toFixed(0)+'</td></tr>':'')
    + (p.meals>0?'<tr><td style="font-size:0.8rem">Meal package</td><td class="num">€'+p.meals.toFixed(0)+'</td></tr>':'')
    + (p.hotelTotal>0?'<tr style="background:#eff6ff"><td style="font-weight:700;font-size:0.8rem">→ Pay to hotel</td><td class="num bold">€'+p.hotelTotal.toFixed(0)+'</td></tr>':'')
    + '<tr style="background:#f0fdf4"><td style="font-weight:700;font-size:0.8rem">→ Meeting fee (to camp)</td><td class="num bold">€'+p.meetingFee.toFixed(0)+'</td></tr>'
    + '<tr><td style="font-weight:700;font-size:0.8rem">Total</td><td class="num bold">€'+p.total.toFixed(0)+'</td></tr>'
    +   '</tbody>'
    + '</table>'
    + '<div style="font-size:0.7rem;color:#9ca3af">'
    + RC.CHECKIN_EN + ' · ' + RC.CHECKOUT_EN
    + '</div></div>'
    // Staff-only info box (not printed)
    + ((r.freeText || r.orgComment) ? (
        '<div class="no-print" style="background:#fefce8;border:1px solid #fde047;border-radius:6px;padding:0.75rem 1rem;margin-bottom:0.75rem;font-size:0.82rem">'
        + '<div style="font-weight:700;font-size:0.75rem;text-transform:uppercase;color:#854d0e;margin-bottom:0.4rem">📋 Tiskihenkilöstölle (ei tulostu)</div>'
        + (r.freeText ? '<div style="margin-bottom:0.35rem"><strong>Vieraan lisätieto:</strong> ' + r.freeText + '</div>' : '')
        + (r.orgComment ? '<div><strong>Järjestäjän kommentti:</strong> ' + r.orgComment + '</div>' : '')
        + '</div>'
      ) : '')
    // Check-in status badge
    + '<div class="no-print" id="checkin-status-' + r.bookingRef + '" style="margin-bottom:0.75rem">'
    + (r.checkedIn
        ? '<span style="background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:4px;padding:0.3rem 0.75rem;font-size:0.82rem;font-weight:700">✓ Kirjautunut sisään</span>'
        : '<span style="background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db;border-radius:4px;padding:0.3rem 0.75rem;font-size:0.82rem">Ei kirjautunut sisään</span>')
    + '</div>'
    // Action buttons
    + '<div class="no-print" style="margin-bottom:1.5rem;display:flex;gap:0.5rem;flex-wrap:wrap">'
    + (r.checkedIn ? '' :
        '<button id="btn-checkin-print-' + r.bookingRef + '" class="btn" '
        + 'onclick="doCheckinAndPrint(\'' + r.bookingRef + '\',\'' + encodeURIComponent(token) + '\')" '
        + 'style="background:#16a34a;color:#fff;border-color:#16a34a">✅ Tee sisäänkirjaus ja tulosta vahvistus</button>')
    + '<a href="' + ScriptApp.getService().getUrl() + '?token=' + encodeURIComponent(token) + '&view=print&ref=' + r.bookingRef + '" target="_blank" class="btn" style="background:#1d4ed8;color:#fff;border-color:#1d4ed8">🖨 Tulosta vahvistus</a>'
    + '<a href="' + backUrl + '" class="btn" target="_top">← Takaisin listaan</a>'
    + '</div>'
    + '<script>'
    + 'function doCheckinAndPrint(ref, token) {'
    + '  var btn = document.getElementById("btn-checkin-print-" + ref);'
    + '  if (btn) { btn.disabled=true; btn.textContent="Kirjataan..."; }'
    + '  fetch("' + ScriptApp.getService().getUrl() + '", {'
    + '    method: "POST",'
    + '    body: JSON.stringify({token: decodeURIComponent(token), action: "checkin", ref: ref})'
    + '  }).then(function(r){return r.json();}).then(function(data){'
    + '    if (data.ok) {'
    + '      var badge = document.getElementById("checkin-status-" + ref);'
    + '      if (badge) badge.innerHTML = \'<span style="background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:4px;padding:0.3rem 0.75rem;font-size:0.82rem;font-weight:700">✓ Kirjautunut sisään</span>\';'
    + '      if (btn) btn.remove();'
    + '      window.open("' + ScriptApp.getService().getUrl() + '?token=" + decodeURIComponent(token) + "&view=print&ref=" + ref, "_blank");'
    + '    } else {'
    + '      alert("Virhe: " + (data.error || "tuntematon virhe"));'
    + '      if (btn) { btn.disabled=false; btn.textContent="✅ Tee sisäänkirjaus ja tulosta vahvistus"; }'
    + '    }'
    + '  }).catch(function(e){ alert("Virhe: " + e.message); if(btn){btn.disabled=false;btn.textContent="✅ Tee sisäänkirjaus ja tulosta vahvistus";} });'
    + '}'
    + '</script>';
}

// =============================================================================
// VIEW 3: SUMMARY
// =============================================================================
function summaryView_(rows, token) {
  var roomGuests   = rows.filter(function(r){return r.type==='room';}).length;
  var camperSpots  = rows.filter(function(r){return r.type==='camper'&&r.isPrimary;}).length;
  var camperGuests = rows.filter(function(r){return r.type==='camper';}).length;
  var tentSpots    = rows.filter(function(r){return r.type==='tent'&&r.isPrimary;}).length;
  var tentGuests   = rows.filter(function(r){return r.type==='tent';}).length;
  var dayvis       = rows.filter(function(r){return r.type==='dayvisitor';}).length;
  var fb           = rows.filter(function(r){return r.fullBoard;}).length;
  var thu          = rows.filter(function(r){return r.thuExtra;}).length;
  var revenue      = rows.reduce(function(s,r){return s+r.totalPrice;},0);

  var roomRows='';
  RC.ROOMS.forEach(function(rc) {
    var guests = rows.filter(function(r){return r.type==='room'&&r.roomId===rc.id;}).length;
    var rooms  = rows.filter(function(r){return r.type==='room'&&r.roomId===rc.id&&r.isPrimary;}).length;
    if (!guests) return;
    roomRows += '<tr><td>'+rc.id+'</td><td>'+rc.note_en+'</td>'
      +'<td class="num">'+rooms+'</td><td class="num">'+guests+'</td><td class="num">€'+rc.price+'</td></tr>';
  });

  var fri    = rows.filter(function(r){return r.fullBoard||(r.meals&&r.meals.toLowerCase().includes('fri'));}).length;
  var lunch  = rows.filter(function(r){return r.fullBoard||(r.meals&&r.meals.toLowerCase().includes('lunch'));}).length;
  var dinner = rows.filter(function(r){return r.fullBoard||(r.meals&&r.meals.toLowerCase().includes('dinner'));}).length;

  var body = '<h2>📊 Yhteenveto</h2>'
    + '<div class="cards">'
    + '<div class="card"><div class="lbl">Hotel guests</div><div class="val">'+roomGuests+'</div></div>'
    + '<div class="card"><div class="lbl">Camper spots</div><div class="val">'+camperSpots+'</div><div class="sub">'+camperGuests+' guests</div></div>'
    + '<div class="card"><div class="lbl">Tent spots</div><div class="val">'+tentSpots+'</div><div class="sub">'+tentGuests+' guests</div></div>'
    + '<div class="card"><div class="lbl">Day visitors</div><div class="val">'+dayvis+'</div></div>'
    + '<div class="card"><div class="lbl">Full board</div><div class="val">'+fb+'</div></div>'
    + '<div class="card"><div class="lbl">Thu extra night</div><div class="val">'+thu+'</div></div>'
    + '<div class="card"><div class="lbl">Total guests</div><div class="val">'+rows.length+'</div></div>'
    + '<div class="card"><div class="lbl">Revenue (est.)</div><div class="val">€'+revenue.toFixed(0)+'</div></div>'
    + '</div>'
    + '<h2>Huonejakauma</h2>'
    + '<table style="max-width:600px"><thead><tr><th>ID</th><th>Tyyppi</th><th class="num">Huoneita</th><th class="num">Vieraita</th><th class="num">Hinta/huone</th></tr></thead>'
    + '<tbody>'+roomRows+'</tbody></table>'
    + '<h2>Ateriamäärät</h2>'
    + '<table style="max-width:350px"><thead><tr><th>Ateria</th><th class="num">kpl</th></tr></thead><tbody>'
    + '<tr><td>Täyshoitopaketit</td><td class="num bold">'+fb+'</td></tr>'
    + '<tr><td style="padding-left:1.5rem;color:#6b7280">Fri BBQ dinner</td><td class="num">'+fri+'</td></tr>'
    + '<tr><td style="padding-left:1.5rem;color:#6b7280">Sat lunch</td><td class="num">'+lunch+'</td></tr>'
    + '<tr><td style="padding-left:1.5rem;color:#6b7280">Sat Ham Dinner</td><td class="num">'+dinner+'</td></tr>'
    + '<tr><td>To-lisäyö (aamiaiset)</td><td class="num">'+thu+'</td></tr>'
    + '</tbody></table>';

  return wrap_('Yhteenveto', body, token, 'summary');
}

// =============================================================================
// CSV EXPORT
// =============================================================================
function buildCsv_(rows) {
  var hdrs = ['Callsign','Name','Email','Country','Type','RoomId','RoomNo','RoomRef',
    'IsPrimary','ThuExtra','FullBoard','Meals','Dietary','ShirtSize',
    'Accommodation+Meals_EUR','MeetingFee_EUR','Total_EUR','Status','BookingRef'];
  var lines = [hdrs.join(';')];
  rows.forEach(function(r) {
    var p = calcPrices_(r);
    lines.push([r.callsign,r.name,r.email,r.country,r.type,r.roomId,r.roomNumber,r.roomRef,
      r.isPrimary?'YES':'NO', r.thuExtra?'YES':'NO', r.fullBoard?'YES':'NO',
      r.meals,r.dietary,r.shirtSize,
      p.hotelTotal.toFixed(0), p.meetingFee.toFixed(0), p.total.toFixed(0),
      r.status, r.bookingRef,
    ].map(function(v){
      v=(v||'').toString().replace(/"/g,'""');
      return v.includes(';')||v.includes('"')||v.includes('\n')?'"'+v+'"':v;
    }).join(';'));
  });
  var now=Utilities.formatDate(new Date(),'Europe/Helsinki','yyyyMMdd-HHmm');
  return ContentService.createTextOutput('\uFEFF'+lines.join('\r\n'))
    .setMimeType(ContentService.MimeType.CSV)
    .downloadAsFile('vushf2026-'+now+'.csv');
}

// =============================================================================
// LOGIN
// =============================================================================
// =============================================================================
// VIEW: PRINT — Clean printable confirmation slip with logos, auto-prints
// =============================================================================
function printView_(rows, token, ref) {
  if (!ref) return HtmlService.createHtmlOutput('<p>Viite puuttuu</p>');
  var r = rows.find(function(x) { return x.bookingRef === ref; });
  if (!r) return HtmlService.createHtmlOutput('<p>Varausta ei löydy: ' + ref + '</p>');

  var p   = calcPrices_(r);
  var rc  = RC.ROOMS.find(function(x) { return x.id === r.roomId; }) || {};

  // Roommates
  var mates = [];
  if ((r.type==='room'||r.type==='camper') && r.isPrimary) {
    mates = rows.filter(function(x){ return x.roomRef===r.bookingRef && x.bookingRef!==r.bookingRef; });
  } else if (r.type==='room'||r.type==='camper') {
    var pri = rows.find(function(x){ return x.bookingRef===r.roomRef; });
    if (pri) mates = [pri].concat(rows.filter(function(x){
      return x.roomRef===r.roomRef && x.bookingRef!==r.bookingRef && x.bookingRef!==pri.bookingRef;
    }));
  }

  // Accommodation EN + FI
  var accEN='', accFI='';
  if (r.type==='room'||r.type==='singlebed') {
    accEN = rc.note_en||r.roomId; accFI = rc.note_fi||r.roomId;
    if (r.roomNumber){accEN+=' — Room '+r.roomNumber; accFI+=' — Huone '+r.roomNumber;}
    else {accEN+=' — Room number TBD'; accFI+=' — Huonenumero ilmoitetaan';}
    if (r.thuExtra){accEN+=' + Thursday extra night'; accFI+=' + Torstai lisäyö';}
  } else if (r.type==='camper') {
    accEN='Camper van spot (2 nights, incl. electricity)'; accFI='Matkailuautopaikka (2 yötä, sähkö mukana)';
    if (!r.isPrimary){accEN+=' — joining '+r.roomRef; accFI+=' — liittyy varaukseen '+r.roomRef;}
  } else if (r.type==='tent') {
    accEN='Tent pitch (2 nights)'; accFI='Telttapaikka (2 yötä)';
  } else if (r.type==='dayvisitor') {
    var dEN=r.dayVisitorDays==='both'?'Friday + Saturday':r.dayVisitorDays==='fri'?'Friday only':'Saturday only';
    var dFI=r.dayVisitorDays==='both'?'Perjantai + lauantai':r.dayVisitorDays==='fri'?'Vain perjantai':'Vain lauantai';
    accEN='Day visitor ('+dEN+')'; accFI='Päivävieras ('+dFI+')';
  }

  // Meals EN + FI
  var mealsEN='', mealsFI='';
  if (r.fullBoard) {
    mealsEN='Full board: '+RC.MEALS_EN.join(', ');
    mealsFI='Täyshoito: '+RC.MEALS_FI.join(', ');
  } else if (r.meals) {
    mealsEN='Individual meals: '+r.meals; mealsFI='Yksittäiset ateriat: '+r.meals;
  } else {
    mealsEN='No meal package'; mealsFI='Ei ruokapakettia';
  }

  var matesRows = '';
  if (mates.length) {
    matesRows = '<tr><td colspan="2" style="padding:6px 8px;font-weight:700;font-size:11px;background:#f3f4f6">'
      + 'Roommates / Huonetoverit</td></tr>';
    mates.forEach(function(x) {
      matesRows += '<tr><td style="padding:4px 8px 4px 20px;font-family:monospace">' + x.callsign + ' — ' + x.name + '</td>'
        + '<td style="padding:4px 8px">' + (x.fullBoard?'✓ Full board / Täyshoito':x.meals||'—') + '</td></tr>';
    });
  }

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<title>VUSHF 2026 — ' + r.callsign + '</title>'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px;color:#1f2937;background:#fff;padding:1.5cm}'
    + '.header{display:flex;align-items:center;gap:16px;margin-bottom:20px;padding-bottom:16px;border-bottom:3px solid #1d4ed8}'
    + '.logos{display:flex;gap:12px;align-items:center}'
    + '.event-title{flex:1}'
    + '.event-title h1{font-size:16px;font-weight:800;color:#1d4ed8}'
    + '.event-title p{font-size:11px;color:#6b7280;margin-top:2px}'
    + '.ref-box{text-align:right}'
    + '.ref-box .label{font-size:9px;text-transform:uppercase;color:#6b7280;letter-spacing:0.05em}'
    + '.ref-box .ref{font-size:18px;font-weight:800;font-family:monospace;color:#1d4ed8}'
    + '.guest{margin-bottom:16px}'
    + '.guest .name{font-size:16px;font-weight:700}'
    + '.guest .meta{font-size:11px;color:#6b7280;margin-top:2px}'
    + 'table{width:100%;border-collapse:collapse;margin-bottom:14px;border:1px solid #e5e7eb}'
    + 'th{background:#eff6ff;font-weight:700;text-align:left;padding:6px 8px;font-size:11px;border-bottom:1px solid #bfdbfe}'
    + 'td{padding:5px 8px;border-bottom:1px solid #f3f4f6;font-size:11px;vertical-align:top}'
    + 'tr:last-child td{border-bottom:none}'
    + '.fi{color:#6b7280;font-size:10px}'
    + '.pay-hotel{background:#eff6ff;font-weight:700}'
    + '.pay-camp{background:#f0fdf4;font-weight:700}'
    + '.total{font-weight:700}'
    + '.footer{margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af}'
    + '.attn{background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;padding:6px 10px;margin-bottom:12px;font-size:11px;color:#92400e}'
    + '@media print{body{padding:1cm} .no-print{display:none}}'
    + '</style></head><body>'

    // Print/close buttons (hidden when printing)
    + '<div class="no-print" style="margin-bottom:16px;display:flex;gap:8px">'
    + '<button onclick="window.print()" style="padding:6px 14px;background:#1d4ed8;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">🖨 Tulosta / Print</button>'
    + '<button onclick="window.close()" style="padding:6px 14px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;font-size:12px">✕ Sulje / Close</button>'
    + '</div>'

    // Header with logos
    + '<div class="header">'
    + '<div class="logos">'
    + '<img src="https://rats.fi/wp-content/uploads/2026/02/vushf26-logo-small.png" style="height:50px;width:auto">'
    + '<img src="https://rats.fi/wp-content/uploads/2015/06/cropped-RATSrotta-286x300.jpg" style="height:40px;width:auto">'
    + '</div>'
    + '<div class="event-title">'
    + '<h1>Nordic VUSHF Meeting 2026</h1>'
    + '<p>' + RC.LOCATION + ' · ' + RC.DATES_EN + ' / ' + RC.DATES_FI + '</p>'
    + '<p>Registration confirmation / Varausvahvistus</p>'
    + '</div>'
    + '<div class="ref-box">'
    + '<div class="label">Booking ref / Varausviite</div>'
    + '<div class="ref">' + r.bookingRef + '</div>'
    + (r.roomNumber ? '<div style="margin-top:10px;display:inline-block;border:3px solid #1d4ed8;border-radius:50%;width:72px;height:72px;text-align:center;line-height:1;padding-top:10px">'
      + '<div style="font-size:9px;text-transform:uppercase;color:#1d4ed8;letter-spacing:0.05em;font-weight:700">Huone<br>Room</div>'
      + '<div style="font-size:22px;font-weight:900;font-family:monospace;color:#1d4ed8">' + r.roomNumber + '</div>'
      + '</div>' : '')
    + '</div>'
    + '</div>'

    // Guest info
    + '<div class="guest">'
    + '<div class="name">' + r.callsign + ' — ' + r.name + '</div>'
    + '<div class="meta">' + r.country + '</div>'
    + '</div>'

    // Attention
    + (r.status==='NEEDS_ATTENTION'?'<div class="attn">⚠ NEEDS ATTENTION — please check with organizer / Tarkista järjestäjältä</div>':'')

    // Accommodation + meals table
    + '<table>'
    + '<tr><th colspan="2">Accommodation & Meals / Majoitus &amp; Ruokailu</th></tr>'
    + '<tr><td style="width:40%;font-weight:700">Accommodation / Majoitus</td>'
    + '<td>' + accEN + '<br><span class="fi">' + accFI + '</span></td></tr>'
    + '<tr><td style="font-weight:700">Meals / Ruokailu</td>'
    + '<td>' + mealsEN + '<br><span class="fi">' + mealsFI + '</span></td></tr>'
    + (r.dietary?'<tr><td style="font-weight:700;color:#b45309">⚠ Dietary / Ruokavalio</td><td style="color:#b45309">'+r.dietary+'</td></tr>':'')
    + matesRows
    + '</table>'

    // Payment table
    + '<table style="max-width:380px">'
    + '<tr><th colspan="2">Payment / Maksu</th></tr>'
    + (p.accommodation>0?'<tr><td>Accommodation / Majoitus</td><td style="text-align:right;font-family:monospace">€'+p.accommodation.toFixed(0)+'</td></tr>':'')
    + (p.meals>0?'<tr><td>Meal package / Ruokapaketti</td><td style="text-align:right;font-family:monospace">€'+p.meals.toFixed(0)+'</td></tr>':'')
    + (p.hotelTotal>0?'<tr class="pay-hotel"><td>→ Pay to hotel / Hotellille</td><td style="text-align:right;font-family:monospace">€'+p.hotelTotal.toFixed(0)+'</td></tr>':'')
    + '<tr class="pay-camp"><td>→ Meeting fee to camp / Leirimaksu</td><td style="text-align:right;font-family:monospace">€'+p.meetingFee.toFixed(0)+'</td></tr>'
    + '<tr class="total"><td>Total / Yhteensä</td><td style="text-align:right;font-family:monospace">€'+p.total.toFixed(0)+'</td></tr>'
    + '</table>'

    // Footer
    + '<div class="footer">'
    + RC.CHECKIN_EN + ' · ' + RC.CHECKOUT_EN + '<br>'
    + RC.CHECKIN_FI + ' · ' + RC.CHECKOUT_FI + '<br><br>'
    + RC.ORGANIZER + ' · meeting@rats.fi'
    + '</div>'
    + '<script>window.onload=function(){window.print();};</script>'
    + '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('VUSHF 2026 — ' + r.callsign)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// Exports the Bookings sheet as .xlsx, saves to Drive, redirects to download link
// =============================================================================
function buildXlsx_() {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var id    = ss.getId();
  var now   = Utilities.formatDate(new Date(), 'Europe/Helsinki', 'yyyyMMdd-HHmm');
  var fname = 'vushf2026-bookings-' + now + '.xlsx';
  var gid   = ss.getSheetByName(RC.SHEET_NAME).getSheetId();
  var url   = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx&gid=' + gid;
  var token = ScriptApp.getOAuthToken();
  var resp  = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif;padding:2rem;color:red">Excel-vienti epäonnistui ('+resp.getResponseCode()+')</p>'
    );
  }
  var b64 = Utilities.base64Encode(resp.getContent());
  return HtmlService.createHtmlOutput(
    '<html><head><meta charset="UTF-8"><title>Lataa Excel</title></head><body>'
    + '<p style="font-family:sans-serif;padding:1rem">Ladataan...</p>'
    + '<script>'
    + 'var b64="' + b64 + '";'
    + 'var bin=atob(b64);'
    + 'var buf=new Uint8Array(bin.length);'
    + 'for(var i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);'
    + 'var blob=new Blob([buf],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});'
    + 'var a=document.createElement("a");'
    + 'a.href=URL.createObjectURL(blob);'
    + 'a.download="' + fname + '";'
    + 'document.body.appendChild(a);a.click();'
    + '</script>'
    + '</body></html>'
  ).setTitle('Lataa Excel');
}

function loginPage_() {
  var url = ScriptApp.getService().getUrl();
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>VUSHF 2026</title>'
    +'<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f9fafb}'
    +'.box{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:2rem;width:320px;text-align:center}'
    +'h1{font-size:1.1rem;margin-bottom:1rem}'
    +'input,select{width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:4px;margin-bottom:0.75rem;font-size:0.9rem}'
    +'button{width:100%;padding:0.6rem;background:#1d4ed8;color:#fff;border:none;border-radius:4px;font-size:0.9rem;cursor:pointer}'
    +'button:hover{background:#1e40af}'
    +'.err{color:#dc2626;font-size:0.82rem;margin-top:0.5rem}'
    +'.hint{font-size:0.75rem;color:#9ca3af;margin-top:0.5rem;cursor:pointer}'
    +'.hint:hover{color:#6b7280}</style></head>'
    +'<body><div class="box"><h1>🏔 Nordic VUSHF 2026<br>Raportit &amp; Ilmoittautuminen</h1>'
    +'<input type="password" id="pw" placeholder="Salasana">'
    +'<select id="view">'
    +'<option value="hotel">🏨 Hotellilista</option>'
    +'<option value="checkin">✅ Ilmoittautumistiski</option>'
    +'<option value="summary">📊 Yhteenveto</option>'
    +'</select>'
    +'<button onclick="go()" id="login-btn">Avaa →</button>'
    +'<div class="err" id="err"></div>'
    +'<div class="hint" id="forget-hint" style="display:none" onclick="forget()">🔒 Unohda tallennettu istunto</div>'
    +'</div>'
    +'<script>'
    +'var url="'+ url +'";'
    +'function go(){'
    +'  var pw=document.getElementById("pw").value;'
    +'  var view=document.getElementById("view").value;'
    +'  if(!pw){document.getElementById("err").textContent="Syötä salasana";return;}'
    +'  var btn=document.getElementById("login-btn");'
    +'  btn.disabled=true;btn.textContent="Kirjaudutaan...";'
    +'  fetch(url,{method:"POST",body:JSON.stringify({action:"login",pw:pw})})'
    +'  .then(function(r){return r.json();})'
    +'  .then(function(d){'
    +'    if(d.ok){'
    +'      localStorage.setItem("vushf_token",d.token);'
    +'      window.top.location=url+"?token="+d.token+"&view="+view;'
    +'    }else{'
    +'      document.getElementById("err").textContent=d.error||"Kirjautuminen epäonnistui";'
    +'      btn.disabled=false;btn.textContent="Avaa →";'
    +'    }'
    +'  }).catch(function(e){document.getElementById("err").textContent="Virhe: "+e.message;btn.disabled=false;btn.textContent="Avaa →";});'
    +'}'
    +'function forget(){'
    +'  localStorage.removeItem("vushf_token");'
    +'  document.getElementById("pw").value="";'
    +'  document.getElementById("forget-hint").style.display="none";'
    +'}'
    +'window.onload=function(){'
    +'  var saved=localStorage.getItem("vushf_token");'
    +'  if(saved){'
    +'    var view=document.getElementById("view").value;'
    +'    window.top.location=url+"?token="+saved+"&view="+view;'
    +'  }'
    +'  if(localStorage.getItem("vushf_token")) document.getElementById("forget-hint").style.display="block";'
    +'};'
    +'document.getElementById("pw").addEventListener("keydown",function(e){if(e.key==="Enter")go();});'
    +'</script>'
    +'</body></html>'
  ).setTitle('VUSHF 2026');
}