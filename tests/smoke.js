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
const booking = (o) => ({ name: 'Test Person', email: 'test@example.com', country: 'FI', privacyAck: true, ...o });

(async () => {
  check('login for setup', (await rpc('checkAdminPassword', PW)).body.result === true, null);
  const ec = (await rpc('getEventConfig')).body.result;
  check('event config fields served', ec.success && ec.fields.length > 10, ec);
  let sv = (await rpc('saveEventConfig', { EVENT_NAME: '', EVENT_SHORT: 'X', ORGANIZER: 'Y' })).body.result;
  check('event config requires a name', !sv.success, sv);
  sv = (await rpc('saveEventConfig', { ...ec.values, EVENT_NAME: 'Smoke Test Event 2027', EVENT_SHORT: 'SmokeEvt', ORGANIZER: 'Smoke Club', ACCENT_COLOR: '#123456' })).body.result;
  check('event config saved', sv.success, sv);
  // --- event structure: 2 days, 1 extra night ---
  let stv = (await rpc('saveStructure', { days: [], coreNights: 2, extraNights: [], package: {} })).body.result;
  check('structure needs at least one day', !stv.success, stv);
  stv = (await rpc('saveStructure', {
    days: [{ label: 'Friday', short: 'Fri' }, { label: 'Saturday', short: 'Sat' }], coreNights: 2,
    extraNights: [{ label: 'Thursday night', includes: 'Includes Friday breakfast' }],
    package: { enabled: true, sub: 'Meals', includes: 'Friday: dinner\nSaturday: lunch + dinner' },
  })).body.result;
  check('structure saved', stv.success, stv);
  const gs = (await rpc('getStructure')).body.result.structure;
  check('structure keys generated', gs.days.map(d => d.key).join() === 'd1,d2' && gs.extraNights[0].key === 'x1', gs);
  for (const [p, needle] of [['/', 'Smoke Test Event 2027'], ['/?public=1', 'Who'], ['/?admin=1', 'admin']]) {
    const r = await fetch(BASE + p); const t = await r.text();
    check(`GET ${p}`, r.status === 200 && t.toLowerCase().includes(needle.toLowerCase()), r.status);
  }
  // every inline <script> of the served pages must be valid JavaScript
  const vm = require('vm');
  const scriptsOk = (html) => {
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m; let n = 0;
    while ((m = re.exec(html))) { new vm.Script(m[1]); n++; }
    return n;
  };
  for (const p of ['/', '/?admin=1', '/?public=1']) {
    let ok = true; let n = 0;
    try { n = scriptsOk(await (await fetch(BASE + p)).text()); } catch (e) { ok = false; console.log(e.message); }
    check(`inline scripts of ${p} parse`, ok && n > 0, n);
  }
  {
    const panel = (await rpc('getAdminPanelHtml', '')).body.result;
    check('admin panel has the setup containers', ['event-setup', 'event-structure', 'room-catalog'].every(id => panel.includes('id="' + id + '"')), panel.slice(0, 200));
  }
  const av = (await rpc('getAvailability')).body.result;
  check('availability has no admin password', !JSON.stringify(av).toLowerCase().includes('password'), null);

  let r = (await rpc('submitBooking', booking({ callsign: 'TEST1', type: 'room', roomId: '2S', fullBoard: true, extraNights: ['x1'] }))).body.result;
  check('room booking succeeds', r.success && r.price.total === 135 + 68 + 75 + 10, r);
  check('extra night in breakdown', r.price.breakdown.includes('Extra night: Thursday night'), r.price);
  const ref = r.bookingRef;
  r = (await rpc('submitBooking', booking({ callsign: 'TEST1', type: 'tent' }))).body.result;
  check('duplicate callsign rejected', !r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TEST2', type: 'room', joinExisting: true, roomRef: ref }))).body.result;
  check('joiner can join room', r.success, r);
  check('joiner inherits the extra night', r.price.breakdown.includes('Extra night'), r.price);
  r = (await rpc('submitBooking', booking({ callsign: 'TEST3', type: 'room', joinExisting: true, roomRef: ref }))).body.result;
  check('third person rejected from a double room', !r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: '', type: 'room' }))).body.result;
  check('empty callsign gives a proper validation error', !r.success && r.error === 'Invalid callsign', r);
  r = (await rpc('submitBooking', booking({ callsign: '<svg onload=1>', type: 'room', roomId: '2S' }))).body.result;
  check('markup in callsign rejected', !r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TEST4', type: 'dayvisitor', visitorDays: ['d1', 'd2'], fullBoard: true }))).body.result;
  check('day visitor price = 85', r.success && r.price.total === 85, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTV2', type: 'dayvisitor', visitorDays: ['d2'] }))).body.result;
  check('single day visitor pays the day fee', r.success && r.price.total === 5, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTV3', type: 'dayvisitor', visitorDays: ['nope'] }))).body.result;
  check('day visitor with unknown day rejected', !r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTX1', type: 'tent', extraNights: ['x1'] }))).body.result;
  check('extra night rejected for tents', !r.success, r);

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

  // --- room catalog ---
  const cat = (await rpc('getRoomCatalog')).body.result;
  r = (await rpc('saveStructure', { days: [{ label: 'Only day' }], coreNights: 1, extraNights: [], package: { enabled: false } })).body.result;
  check('cannot remove day/extra night in use', !r.success, r);
  check('room catalog served', cat.success && cat.rooms.length === 7, cat);
  const base = cat.rooms.map(x => ({ ...x }));
  r = (await rpc('saveRoomCatalog', [...base, { id: '5S', note_en: 'Five-bed room', persons: 5, count: 2, price_eur: 500 }])).body.result;
  check('add room type', r.success, r);
  let a2 = (await rpc('getAvailability')).body.result;
  check('new room type in availability', a2.rooms['5S'] && a2.rooms['5S'].total === 2, a2.rooms && a2.rooms['5S']);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTR1', type: 'room', roomId: '5S' }))).body.result;
  check('book a custom room type', r.success && r.price.total > 0, r);
  r = (await rpc('saveRoomCatalog', base)).body.result;
  check('cannot delete room type with bookings', !r.success, r);
  r = (await rpc('saveRoomCatalog', [...base, { id: '5S', note_en: 'Five-bed room', persons: 4, count: 2, price_eur: 500 }])).body.result;
  check('cannot change capacity with bookings', !r.success, r);
  r = (await rpc('saveRoomCatalog', [...base, { id: 'bad id!', note_en: 'x', persons: 1, count: 1, price_eur: 1 }])).body.result;
  check('invalid room id rejected', !r.success, r);
  r = (await rpc('saveRoomCatalog', [...base, { id: '9S', note_en: 'Temp', persons: 9, count: 1, price_eur: 1 }, { id: '5S', note_en: 'Five-bed room', persons: 5, count: 2, price_eur: 520 }])).body.result;
  check('edit price and add another', r.success, r);
  r = (await rpc('saveRoomCatalog', [...base, { id: '5S', note_en: 'Five-bed room', persons: 5, count: 2, price_eur: 520 }])).body.result;
  check('delete unused room type', r.success, r);
  const setg = (await rpc('getAdminSettings', '')).body.result;
  check('room price follows catalog', setg.settings.ROOM_PRICES['5S'] === 520, setg.settings.ROOM_PRICES);


  // --- per-night accommodation mode ---
  const cur = (await rpc('getStructure')).body.result.structure;
  r = (await rpc('saveStructure', { ...cur, accommodation: 'per_night' })).body.result;
  check('switch to per-night mode', r.success, r);
  const sPN = (await rpc('getStructure')).body.result.structure;
  check('per-night mode forces nights = days', sPN.accommodation === 'per_night' && sPN.coreNights === sPN.days.length, sPN);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTN0', type: 'room', roomId: '4S', nights: [] }))).body.result;
  check('per-night room needs at least one night', !r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTN1', type: 'room', roomId: '4S', nights: ['d1'] }))).body.result;
  check('book one night only', r.success && r.price.breakdown.includes('1 of 2 nights') && r.price.total === 200 / 4 + 10, r);
  const refN1 = r.bookingRef;
  r = (await rpc('submitBooking', booking({ callsign: 'TESTN2', type: 'room', roomId: '4S', nights: ['d1'] }))).body.result;
  check('second room, same night', r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTN3', type: 'room', roomId: '4S', nights: ['d1'] }))).body.result;
  check('night fully booked is rejected', !r.success && /Night of/.test(r.error), r);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTN4', type: 'room', roomId: '4S', nights: ['d2'] }))).body.result;
  check('same room type is free on the other night', r.success, r);
  const avN = (await rpc('getAvailability')).body.result;
  check('availability per night', avN.rooms['4S'].perNight.d1 === 0 && avN.rooms['4S'].perNight.d2 === 1 && avN.rooms['4S'].available === 1, avN.rooms['4S']);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTN5', type: 'room', joinExisting: true, roomRef: refN1 }))).body.result;
  check('joiner inherits the nights', r.success && r.price.breakdown.includes('1 of 2 nights'), r);
  r = (await rpc('updateBooking', '', refN1, { Nights: 'd1,d2' }, false)).body.result;
  const adN = (await rpc('getAdminData', '')).body.result;
  const rowN1 = adN.rows.find(x => x.BookingRef === refN1);
  check('all nights ticked = whole stay, price recalculated', r.success && rowN1.Nights === '' && Number(rowN1.TotalPrice) === 110, rowN1);
  r = (await rpc('saveStructure', { ...cur, accommodation: 'period' })).body.result;
  check('cannot go back to whole-event mode with per-night bookings', !r.success, r);

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

  // ---- GDPR: privacy notice, consent, export, erase, shutdown ----
  r = (await rpc('submitBooking', booking({ callsign: 'TESTG0', type: 'dayvisitor', visitorDays: ['d1'], privacyAck: false }))).body.result;
  check('booking without privacy acknowledgement is rejected', !r.success && /privacy/i.test(r.error), r);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTG1', type: 'dayvisitor', visitorDays: ['d1'], name: 'Gina Public', publishConsent: true }))).body.result;
  const refG1 = r.bookingRef;
  r = (await rpc('submitBooking', booking({ callsign: 'TESTG2', type: 'dayvisitor', visitorDays: ['d1'], name: 'Hank Private' }))).body.result;
  const refG2 = r.bookingRef;
  const guests = (await rpc('getPublicGuestList')).body.result;
  check('public list: opt-in only (consent given = listed)', guests.some(g => g.callsign === 'TESTG1'), guests.length);
  check('public list: default (no consent) = not listed', !guests.some(g => g.callsign === 'TESTG2'), guests.length);
  check('public list exposes no email/phone', guests.every(g => !('email' in g) && !('phone' in g) && !('name' in g)), guests[0]);

  const pv = await rpc('saveEventConfig', { ...ec.values, EVENT_NAME: 'Smoke Test Event 2027', EVENT_SHORT: 'SmokeEvt', ORGANIZER: 'Smoke Club', ACCENT_COLOR: '#123456',
    CONTROLLER_NAME: 'Smoke Club ry', PRIVACY_CONTACT_EMAIL: 'privacy@example.com', EVENT_END_DATE: '2020-01-02', RETENTION_DAYS: '30' });
  check('privacy fields saved', pv.body.result.success, pv.body.result);
  r = (await rpc('saveEventConfig', { ...ec.values, EVENT_NAME: 'X', EVENT_SHORT: 'X', ORGANIZER: 'Y', EVENT_END_DATE: '2027-13-45' })).body.result;
  check('invalid end date is rejected', !r.success, r);
  r = (await rpc('saveEventConfig', { ...ec.values, EVENT_NAME: 'X', EVENT_SHORT: 'X', ORGANIZER: 'Y', RETENTION_DAYS: '9999' })).body.result;
  check('retention days above 365 are rejected', !r.success, r);
  await rpc('saveEventConfig', { ...ec.values, EVENT_NAME: 'Smoke Test Event 2027', EVENT_SHORT: 'SmokeEvt', ORGANIZER: 'Smoke Club', ACCENT_COLOR: '#123456',
    CONTROLLER_NAME: 'Smoke Club ry', PRIVACY_CONTACT_EMAIL: 'privacy@example.com', EVENT_END_DATE: '2020-01-02', RETENTION_DAYS: '30' });

  const pn = await fetch(BASE + '/privacy');
  const pnt = await pn.text();
  check('privacy notice page served without login', pn.status === 200 && pnt.includes('Smoke Club ry') && pnt.includes('2020-02-01') && pnt.includes('privacy@example.com'), pn.status);
  check('privacy notice states purpose limitation and rights', /only<\/strong> to register/.test(pnt) && /right to access/.test(pnt) && /complain/.test(pnt), null);
  const bp = await (await fetch(BASE + '/')).text();
  check('booking form carries notice, controller and required acknowledgement', bp.includes('id="privacy-ack"') && bp.includes('Smoke Club ry') && bp.includes('/privacy') && bp.includes('2020-02-01'), null);
  check('no-store header on pages', (await fetch(BASE + '/')).headers.get('cache-control') === 'no-store', null);
  const adminHdr = await fetch(BASE + '/?admin=1');
  check('admin page cannot be framed', adminHdr.headers.get('x-frame-options') === 'DENY', null);

  let ex = (await rpc('exportBooking', refG1)).body.result;
  check('export returns the booking and log entries as JSON', ex.success && ex.data.booking.callsign === 'TESTG1' && Array.isArray(ex.data.logEntries) && /\.json$/.test(ex.filename), ex);
  check('export of unknown booking fails cleanly', !(await rpc('exportBooking', 'NOPE-1')).body.result.success, null);
  check('admin-only: export needs login', (await fetch(`${BASE}/api/rpc/exportBooking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: [refG1] }) })).status === 401, null);
  check('admin-only: erase needs login', (await fetch(`${BASE}/api/rpc/eraseBooking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: [refG1] }) })).status === 401, null);

  // a primary booker with active roommates cannot be erased on its own
  r = (await rpc('submitBooking', booking({ callsign: 'TESTG3', type: 'camper', name: 'Ida Primary' }))).body.result;
  const refG3 = r.bookingRef;
  check('GDPR test fixture: primary booked', r.success, r);
  r = (await rpc('submitBooking', booking({ callsign: 'TESTG4', type: 'camper', joinExisting: true, roomRef: refG3, name: 'Jon Mate' }))).body.result;
  const refG4 = r.bookingRef;
  check('GDPR test fixture: roommate booked', r.success, r);
  r = (await rpc('eraseBooking', refG3, { sendNotice: false })).body.result;
  check('primary with active roommates cannot be erased alone', !r.success && r.error.includes(refG4), r);

  r = (await rpc('eraseBooking', refG4, { sendNotice: true })).body.result;
  check('erase joiner works; missing mail config reported, not fatal', r.success && r.notice.requested && !r.notice.sent && /not configured/i.test(r.notice.error), r);
  let rows = (await rpc('getAdminData', '')).body.result.rows;
  check('erased booking is gone from admin data', !rows.some(x => x.BookingRef === refG4 || x.Callsign === 'TESTG4'), null);
  r = (await rpc('eraseBooking', refG3, { sendNotice: false })).body.result;
  check('primary can be erased once roommates are gone', r.success, r);
  check('erase of the same booking twice fails cleanly', !(await rpc('eraseBooking', refG3, {})).body.result.success, null);
  // no trace of the erased person in the event log (checked through the export of another booking is not enough: query via report-free route)
  ex = (await rpc('exportBooking', refG1)).body.result;
  check('other people\'s log entries are untouched', ex.success && ex.data.logEntries.length >= 1, ex.data && ex.data.logEntries);

  // shutdown (destructive): only against a throwaway database
  if (process.env.SMOKE_ALLOW_SHUTDOWN === '1') {
    let pvw = (await rpc('getShutdownPreview')).body.result;
    check('shutdown preview shows retention overdue and counts', pvw.success && pvw.retention.state === 'overdue' && pvw.counts.bookings > 0 && pvw.confirmPhrase === 'ERASE ALL DATA', pvw);
    r = (await rpc('shutdownEvent', { confirm: 'yes please' })).body.result;
    check('shutdown needs the exact confirmation phrase', !r.success, r);
    await rpc('saveEventConfig', { ...ec.values, EVENT_NAME: 'Smoke Test Event 2027', EVENT_SHORT: 'SmokeEvt', ORGANIZER: 'Smoke Club', ACCENT_COLOR: '#123456',
      EVENT_END_DATE: '2020-01-02', RETENTION_DAYS: '30', RETENTION_HOLD: 'Open payment dispute' });
    pvw = (await rpc('getShutdownPreview')).body.result;
    check('retention hold is reported', pvw.retention.state === 'hold', pvw.retention);
    r = (await rpc('shutdownEvent', { confirm: 'ERASE ALL DATA' })).body.result;
    check('shutdown is blocked while a retention hold is active', !r.success && /hold/i.test(r.error), r);
    await rpc('saveEventConfig', { ...ec.values, EVENT_NAME: 'Smoke Test Event 2027', EVENT_SHORT: 'SmokeEvt', ORGANIZER: 'Smoke Club', ACCENT_COLOR: '#123456',
      EVENT_END_DATE: '2099-01-02', RETENTION_DAYS: '30', RETENTION_HOLD: '' });
    r = (await rpc('shutdownEvent', { confirm: 'ERASE ALL DATA' })).body.result;
    check('shutdown before the event ends needs extra acknowledgement', !r.success && r.needsAck, r);
    r = (await rpc('shutdownEvent', { confirm: 'ERASE ALL DATA', acknowledgeEarly: true, sendNotices: true })).body.result;
    check('shutdown erases everything and verifies it', r.success && r.verified && r.verification.every(v => v.ok) && r.erased.bookings > 0, r);
    pvw = (await rpc('getShutdownPreview')).body.result;
    check('after shutdown: nothing left, last shutdown recorded', pvw.counts.bookings === 0 && pvw.counts.logRows === 1 && pvw.last && pvw.last.verified, pvw);
    r = (await rpc('submitBooking', booking({ callsign: 'TESTG9', type: 'dayvisitor', visitorDays: ['d1'] }))).body.result;
    check('registration is closed after shutdown', !r.success, r);
  } else console.log('SKIP shutdown tests (set SMOKE_ALLOW_SHUTDOWN=1 on a throwaway database; it erases ALL data)');

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
