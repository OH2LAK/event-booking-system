'use strict';
// Import bookings from the old Google Sheet export (.xlsx, sheet "Bookings") into PostgreSQL.
//   DATABASE_URL=postgres://... node src/tools/import-xlsx.js path/to/bookings.xlsx
// Requires the dev dependency "exceljs" (npm install). Existing rows with the same BookingRef are skipped.
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const repo = require('../repo');

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') return v.text || v.result || (v.richText ? v.richText.map(t => t.text).join('') : '');
  return v;
}

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node src/tools/import-xlsx.js <bookings.xlsx>'); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Bookings');
  if (!ws) throw new Error('Sheet "Bookings" not found');
  const headers = [];
  ws.getRow(1).eachCell((c, i) => { headers[i] = String(cellText(c.value)).trim(); });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // The old sheet used fixed Thursday/Friday/Saturday keys: make sure the event structure matches them.
  const structure = require('../structure');
  await pool.query(require('fs').readFileSync(require('path').join(__dirname, '../../db/schema.sql'), 'utf8'));
  if (!(await pool.query('SELECT 1 FROM event_structure WHERE id = 1')).rows.length) {
    await pool.query('INSERT INTO event_structure (id, structure) VALUES (1, $1)', [JSON.stringify(structure.legacyStructure(null))]);
    console.log('Created the legacy event structure (days fri/sat, extra night thu). Adjust the labels in the admin panel.');
  }
  let imported = 0; let skipped = 0;
  for (let rn = 2; rn <= ws.rowCount; rn++) {
    const row = ws.getRow(rn);
    const get = h => { const i = headers.indexOf(h); return i === -1 ? '' : cellText(row.getCell(i).value); };
    const ref = String(get('BookingRef')).trim();
    if (!ref) continue;
    const seq = parseInt(ref.split('-').pop(), 10);
    const cols = ['seq']; const vals = [seq];
    // Old sheet columns -> structure keys (legacy structure keys: thu / fri / sat)
    const legacyDays = String(get('DayVisitorDays') || '').toLowerCase();
    const legacy = {
      ExtraNights: get('ExtraNights') || (String(get('ThuExtraNight')).toUpperCase() === 'YES' ? 'thu' : ''),
      VisitorDays: get('VisitorDays') || (legacyDays === 'both' ? 'fri,sat' : legacyDays),
    };
    repo.COLS.forEach(([h, col, kind]) => {
      let v = legacy[h] !== undefined ? legacy[h] : get(h);
      if (kind === 'ts') v = v instanceof Date ? v : new Date();
      else if (kind === 'b') v = String(v).toUpperCase() === 'YES';
      else if (kind === 'n') v = Number(v) || 0;
      else v = String(v === undefined || v === null ? '' : v);
      cols.push(col); vals.push(v);
    });
    const res = await pool.query(
      `INSERT INTO bookings (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT (booking_ref) DO NOTHING`,
      vals
    );
    if (res.rowCount) imported++; else skipped++;
  }
  console.log(`Imported ${imported} booking(s), skipped ${skipped} existing.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
