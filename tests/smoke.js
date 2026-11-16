'use strict';
// End-to-end smoke test against a running instance.
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... node tests/smoke.js
// WARNING: creates test bookings (callsigns starting with TEST) in the target database.
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PW = process.env.ADMIN_PASSWORD || '';
let cookie = '';
let failures = 0;

const check = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra)));
  if (!cond) failures++;
};
async function rpc(method, ...args) {
  const r = await fetch(`${BASE}/api/rpc/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ args }),
  });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json() };
}
const booking = (o) => ({ name: 'Test Person', email: 'test@example.com', country: 'FI', ...o });

(async () => {
  check('login for setup', (await rpc('checkAdminPassword', PW)).body.result === true, null);
  const ec = (await rpc('getEventConfig')).body.result;
  check('event config fields served', ec.success && ec.fields.length > 10, ec);
  let sv = (await rpc('saveEventConfig', { EVENT_NAME: '', EVENT_SHORT: 'X', ORGANIZER: 'Y' })).body.result;
  check('event config requires a name', !sv.success, sv);
  sv = (await rpc('saveEventConfig', { ...ec.values, EVENT_NAME: 'Smoke Test Event 2027', EVENT_SHORT: 'SmokeEvt', ORGANIZER: 'Smoke Club', ACCENT_COLOR: '#123456' })).body.result;
  check('event config saved', sv.success, sv);
  for (const [p, needle] of [['/', 'Smoke Test Event 2027'], ['/?public=1', 'Who'], ['/?admin=1', 'admin']]) {
    const r = await fetch(BASE + p); const t = await r.text();
    check(`GET ${p}`, r.status === 200 && t.toLowerCase().includes(needle.toLowerCase()), r.status);
  }
  const av = (await rpc('getAvailability')).body.result;
  check('availability has no admin password', !JSON.stringify(av).toLowerCase().includes('password'), null);

  let r = (await rpc('submitBooking', booking({ callsign: 'TEST1', type: 'room', roomId: '2S', fullBoard: true, thuExtraNight: true }))).body.result;
  check('room booking succeeds', r.success && r.price.total > 0, r);
  const ref = r.bookingRef;
  r = (await rpc('submitBooking', booking({ callsign: 'TEST1', type: 'tent' }))).body.result;
  check('duplicate callsign rejected', !r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TEST2', type: 'room', joinExisting: true, roomRef: ref }))).body.result;
  check('joiner can join room', r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TEST3', type: 'room', joinExisting: true, roomRef: ref }))).body.result;
  check('third person rejected from a double room', !r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: '', type: 'room' }))).body.result;
  check('empty callsign gives a proper validation error', !r.success && r.error === 'Invalid callsign', r);
  r = (await rpc('submitBooking', booking({ callsign: '<svg onload=1>', type: 'room', roomId: '2S' }))).body.result;
  check('markup in callsign rejected', !r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TEST4', type: 'dayvisitor', dayVisitorDays: 'both', fullBoard: true }))).body.result;
  check('day visitor price = 85', r.success && r.price.total === 85, r);

  // concurrency: the single seven-person room must only be bookable once
  const burst = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    rpc('submitBooking', booking({ callsign: 'TESTC' + i, type: 'room', roomId: '7S' }))));
  const wins = burst.filter(x => x.body.result && x.body.result.success).length;
  check('8 concurrent bookings of a 1-room type -> exactly 1 success', wins === 1, wins);

  // admin
  cookie = '';
  check('admin API without login -> 401', (await rpc('getAdminData')).status === 401, null);
  check('wrong password rejected', (await rpc('checkAdminPassword', 'definitely-wrong')).body.result === false, null);
  check('correct password accepted', (await rpc('checkAdminPassword', PW)).body.result === true, null);
  const ad = (await rpc('getAdminData', '')).body.result;
  check('admin data lists bookings', ad.success && ad.rows.length >= 4 && ad.headers.includes('BookingRef'), ad.rows && ad.rows.length);
  r = (await rpc('updateBooking', '', ref, { RoomNumber: '101', OrgComment: 'smoke test' }, false)).body.result;
  check('update room number', r.success, r);
  const ad2 = (await rpc('getAdminData', '')).body.result;
  const rooms = ad2.rows.filter(x => x.RoomRef === ref).map(x => x.RoomNumber);
  check('room number propagated to roommate', rooms.length === 2 && rooms.every(x => x === '101'), rooms);
  r = (await rpc('saveAdminSettings', '', { ANNOUNCEMENT: 'hello', MEETING_FEE_WEEKEND: 12 })).body.result;
  check('save settings', r.success, r);
  r = (await rpc('recalcAllPrices', '')).body.result;
  check('recalc all prices', r.success && r.updated >= 4, r);
  r = (await rpc('updateBooking', '', ref, { Status: 'CANCELLED' }, false)).body.result;
  check('cancelling primary flags roommate', r.success && r.cascadedCount === 1, r);
  r = (await rpc('saveAdminSettings', '', { ANNOUNCEMENT: '', MEETING_FEE_WEEKEND: 10 })).body.result;


  // report & check-in tool
  const noAuth = await fetch(BASE + '/report?view=summary');
  check('report without login shows login page', (await noAuth.text()).includes('Kirjaudu'), noAuth.status);
  for (const v of ['hotel', 'checkin', 'summary']) {
    const r2 = await fetch(`${BASE}/report?view=${v}`, { headers: { cookie } });
    const t = await r2.text();
    check(`report view ${v} renders`, r2.status === 200 && t.includes('Smoke Test Event 2027') && !t.includes('undefined'), r2.status);
  }
  const csv = await fetch(`${BASE}/report?fmt=csv`, { headers: { cookie } });
  const csvText = await csv.text();
  check('csv export works', csv.status === 200 && csvText.includes('Callsign;Name'), csv.status);
  const ci = await fetch(`${BASE}/report/checkin`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'TEST4-3' }) });
  check('check-in works', (await ci.json()).ok === true, null);
  const pr = await fetch(`${BASE}/report?view=print&ref=TEST4-3`, { headers: { cookie } });
  check('print slip renders', pr.status === 200 && (await pr.text()).includes('TEST4'), pr.status);

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
