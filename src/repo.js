'use strict';
// Maps between PostgreSQL rows and the "sheet style" objects the original UI and email
// templates expect (header names such as BookingRef, YES/NO strings).
const TZ = process.env.TZ_NAME || 'Europe/Helsinki';

// [sheet header, db column, kind]   kind: t=text, b=YES/NO boolean, n=number
const COLS = [
  ['Timestamp', 'created_at', 'ts'],
  ['BookingRef', 'booking_ref', 't'],
  ['Callsign', 'callsign', 't'],
  ['Name', 'name', 't'],
  ['Email', 'email', 't'],
  ['Phone', 'phone', 't'],
  ['Country', 'country', 't'],
  ['Type', 'type', 't'],
  ['RoomId', 'room_id', 't'],
  ['RoomRef', 'room_ref', 't'],
  ['IsPrimaryBooker', 'is_primary', 'b'],
  ['ExtraNights', 'extra_nights', 't'],
  ['Nights', 'nights', 't'],
  ['FullBoard', 'full_board', 'b'],
  ['Dietary', 'dietary', 't'],
  ['ShirtSize', 'shirt_size', 't'],
  ['TotalPrice', 'total_price', 'n'],
  ['PriceBreakdown', 'price_breakdown', 't'],
  ['Status', 'status', 't'],
  ['RoomNumber', 'room_number', 't'],
  ['OrgComment', 'org_comment', 't'],
  ['PublishConsent', 'publish_consent', 'b'],
  ['SoloRoom', 'solo_room', 'b'],
  ['VisitorDays', 'visitor_days', 't'],
  ['IsOrganizer', 'is_organizer', 'b'],
  ['FreeText', 'free_text', 't'],
  ['Meals', 'meals', 't'],
  ['Language', 'language', 't'],
];
const HEADERS = COLS.map(c => c[0]);
const BY_HEADER = Object.fromEntries(COLS.map(c => [c[0], c]));

// Fields the admin may edit (same list as the Apps Script updateBooking)
const EDITABLE = [
  'Callsign', 'Name', 'Email', 'Phone', 'Country', 'Type', 'RoomId', 'RoomRef',
  'IsPrimaryBooker', 'ExtraNights', 'Nights', 'FullBoard', 'Dietary', 'Status',
  'RoomNumber', 'OrgComment', 'PublishConsent', 'SoloRoom', 'FreeText', 'IsOrganizer', 'VisitorDays',
];

const ACTIVE = ['CONFIRMED', 'CHECKED_IN', 'NEEDS_ATTENTION'];

function fmtTs(d) {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(d));
  return p.replace('T', ' ');
}

function cell(row, [, col, kind]) {
  const v = row[col];
  if (kind === 'ts') return fmtTs(v);
  if (kind === 'b') return v ? 'YES' : 'NO';
  if (kind === 'n') return v === null || v === undefined ? 0 : Number(v);
  return v === null || v === undefined ? '' : String(v);
}

// camelCase sheet-style object (what the booking logic and emails use)
function toObj(row) {
  const o = {};
  COLS.forEach(c => { o[c[0].charAt(0).toLowerCase() + c[0].slice(1)] = cell(row, c); });
  return o;
}
// string-valued object keyed by sheet header (what the admin table uses)
function toAdminRow(row) {
  const o = {};
  COLS.forEach(c => { o[c[0]] = String(cell(row, c)); });
  return o;
}

function toDbValue(header, v) {
  const kind = BY_HEADER[header][2];
  if (kind === 'b') return v === true || v === 'YES' || v === 'yes' || v === 'true';
  if (kind === 'n') return Number(v) || 0;
  return v === null || v === undefined ? '' : String(v).replace(/[<>]/g, '');
}

async function all(client) {
  const r = await client.query('SELECT * FROM bookings ORDER BY seq');
  return r.rows;
}
const active = rows => rows.filter(r => ACTIVE.includes(r.status));

async function updateFields(client, bookingRef, fields) {
  const sets = []; const vals = [];
  Object.keys(fields).forEach(h => {
    if (!BY_HEADER[h] || h === 'Timestamp' || h === 'BookingRef') return;
    vals.push(toDbValue(h, fields[h]));
    sets.push(`${BY_HEADER[h][1]} = $${vals.length}`);
  });
  if (!sets.length) return;
  vals.push(bookingRef);
  await client.query(`UPDATE bookings SET ${sets.join(', ')} WHERE booking_ref = $${vals.length}`, vals);
}

module.exports = { COLS, HEADERS, EDITABLE, ACTIVE, toObj, toAdminRow, toDbValue, all, active, updateFields };
