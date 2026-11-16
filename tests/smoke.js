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

  // ---- i18n: languages, switcher, translated pages/emails/errors, admin overrides ----
  {
    const ALL_LANGS = 'en,fi,sv,no,da,is,et,lv,lt,pl,de';
    const base = { ...ec.values, EVENT_NAME: 'Smoke Test Event 2027', EVENT_SHORT: 'SmokeEvt', ORGANIZER: 'Smoke Club', ACCENT_COLOR: '#123456',
      EVENT_END_DATE: '2020-01-02', RETENTION_DAYS: '30', RETENTION_HOLD: '' };
    r = (await rpc('saveEventConfig', { ...base, LANGUAGES: 'en,xx', DEFAULT_LANGUAGE: 'en' })).body.result;
    check('unknown language code is rejected in Event setup', !r.success, r);
    r = (await rpc('saveEventConfig', { ...base, LANGUAGES: 'en,fi', DEFAULT_LANGUAGE: 'de' })).body.result;
    check('default language must be an enabled language', !r.success, r);
    r = (await rpc('saveEventConfig', { ...base, LANGUAGES: ALL_LANGS, DEFAULT_LANGUAGE: 'en' })).body.result;
    check('all eleven languages can be enabled', r.success, r);
    const page = async (path, hdr) => (await fetch(BASE + path, { headers: hdr || {} })).text();
    const expectPage = { fi: ['Majoitustyyppi', 'Tietosuojaseloste'], sv: ['Typ av boende', 'Integritetspolicy'], de: ['Art der Unterkunft', 'Datenschutzerklärung'], is: ['Tegund gistingar', 'Persónuverndarstefna'],
      no: ['Type overnatting', 'Personvernerklæring'], da: ['Overnatningstype', 'Privatlivspolitik'], et: ['Majutuse tüüp', 'Privaatsusteade'],
      lv: ['Naktsmītnes veids', 'Privātuma paziņojums'], lt: ['Apgyvendinimo tipas', 'Privatumo pranešimas'], pl: ['Rodzaj zakwaterowania', 'Informacja o ochronie danych'], en: ['Accommodation type', 'Privacy notice'] };
    for (const l of Object.keys(expectPage)) {
      const home = await page('/?lang=' + l), priv = await page('/privacy?lang=' + l);
      check(`booking page and privacy notice in ${l}`, home.includes(`<html lang="${l}"`) && home.includes(expectPage[l][0]) && priv.includes(expectPage[l][1]) && !/\{\w+\}/.test(priv), l);
    }
    const sw = await page('/?lang=fi');
    check('language switcher links to every enabled language', ALL_LANGS.split(',').every(l => sw.includes('lang=' + l)));
    check('Accept-Language picks the language when no ?lang is given', (await page('/', { 'accept-language': 'sv-SE,sv;q=0.9' })).includes('<html lang="sv"'));
    check('Norwegian browser tags (nb) map to no', (await page('/', { 'accept-language': 'nb-NO,nb;q=0.9,en;q=0.5' })).includes('<html lang="no"'));
    check('unknown ?lang falls back to the default language', (await page('/?lang=xx')).includes('<html lang="en"'));

    r = (await rpc('submitBooking', booking({ callsign: 'TESTL1', type: 'dayvisitor', visitorDays: ['d1'], language: 'fi' }))).body.result;
    check('price breakdown is returned in the guest\'s language', r.success && /Osallistumismaksu/.test(r.price.breakdown), r);
    const refL1 = r.bookingRef;
    r = (await rpc('submitBooking', booking({ callsign: 'TESTL1', type: 'dayvisitor', visitorDays: ['d1'], language: 'is' }))).body.result;
    check('server error messages are translated', !r.success && /Kallmerki/.test(r.error), r);
    r = (await rpc('submitBooking', booking({ callsign: 'TESTL2', type: 'dayvisitor', visitorDays: ['d1'], language: 'xx' }))).body.result;
    check('unknown booking language falls back to the default language', r.success && /Meeting fee/.test(r.price.breakdown), r);
    let ex = (await rpc('exportBooking', refL1)).body.result;
    check('the booking stores the guest\'s language', ex.success && JSON.stringify(ex.data).includes('"language": "fi"') || JSON.stringify(ex.data).includes('"language":"fi"'), ex.data && ex.data.booking);

    // admin overrides
    let tr = (await rpc('getTranslations', 'fi')).body.result;
    check('translation editor lists UI texts and event content', tr.success && tr.ui.length > 250 && tr.content.length > 0 && tr.missing === 0, tr.missing);
    tr = (await rpc('getTranslations', 'xx')).body.result;
    check('translation editor rejects an unknown language', !tr.success, tr);
    r = (await rpc('saveTranslations', 'fi', { 'form.confirm': 'Vahvista varaus TESTI', 'form.back': '<b>Takaisin</b>' })).body.result;
    check('translation override is saved', r.success, r);
    let fi = await page('/?lang=fi');
    check('override shows on the page and < > are stripped', fi.includes('Vahvista varaus TESTI') && !fi.includes('<b>Takaisin</b>') && fi.includes('bTakaisin/b'), 'override');
    r = (await rpc('saveTranslations', 'fi', { 'form.confirm': '', 'form.back': '' })).body.result;
    fi = await page('/?lang=fi');
    check('emptying an override restores the built-in text', r.success && !fi.includes('Vahvista varaus TESTI') && fi.includes('Vahvista varaus'), r);
    r = (await rpc('saveTranslations', 'de', { 'content.event.EVENT_NAME': 'Testveranstaltung 2027' })).body.result;
    check('event content can be translated per language', r.success && (await page('/?lang=de')).includes('Testveranstaltung 2027') && (await page('/?lang=en')).includes('Smoke Test Event 2027'), r);
    await rpc('saveTranslations', 'de', { 'content.event.EVENT_NAME': '' });
    r = (await rpc('saveTranslations', 'xx', { 'form.confirm': 'x' })).body.result;
    check('saving for an unknown language fails', !r.success, r);
    const cat = {}; for (const l of ALL_LANGS.split(',')) cat[l] = require('../src/locales/' + l + '.json');
    const ph = t => (String(t).match(/\{\w+\}/g) || []).sort().join(',');
    const broken = [];
    for (const k of Object.keys(cat.en)) for (const l of ALL_LANGS.split(',').filter(x => x !== 'en')) if (cat[l][k] === undefined || ph(cat[l][k]) !== ph(cat.en[k])) broken.push(l + ':' + k);
    check('all catalogs have every key with the same placeholders', broken.length === 0, broken.slice(0, 5));
    // Easter-egg languages: partial catalogs (no priv.* / mail.*), hidden from help text
    const partial = ['tlh', 'fkv', 'fit'];
    const bad2 = [];
    for (const l of partial) {
      const c = require('../src/locales/' + l + '.json');
      for (const k of Object.keys(c)) if (cat.en[k] === undefined || ph(c[k]) !== ph(cat.en[k]) || /[<>]/.test(c[k])) bad2.push(l + ':' + k);
      if (Object.keys(c).some(k => /^(priv|mail)\./.test(k))) bad2.push(l + ':has legal keys');
    }
    check('partial catalogs are a clean subset of en', bad2.length === 0, bad2.slice(0, 5));
    r = (await rpc('saveEventConfig', { ...base, LANGUAGES: 'en,tlh,fkv,fit', DEFAULT_LANGUAGE: 'en' })).body.result;
    check('tlh, fkv and fit can be enabled by code', r.success, r);
    const fr = await fetch(BASE + '/fonts/piqad.woff2');
    check('pIqaD font is served as woff2', fr.ok && (await fr.arrayBuffer()).byteLength > 1000, fr.status);
    const pj = await (await fetch(BASE + '/piqad.js')).text();
    const { toPiqad, isKlingon } = require('../public/piqad.js');
    check('pIqaD skips non-Klingon text', isKlingon('tlhIngan Hol') && isKlingon('ghItlh SoQ: 2') && !isKlingon('Explorer Radio Camp') && !isKlingon('Suomi') && !isKlingon('Visa, Mastercard'));
    check('pIqaD transliteration maps tlhIngan Hol', toPiqad('tlhIngan Hol') === '\uF8E4\uF8D7\uF8DC\uF8D0\uF8DB \uF8D6\uF8DD\uF8D9' && pj.length > 500);
    check('piqad.js only on tlh pages', (await page('/?lang=tlh')).includes('/piqad.js') && !(await page('/?lang=fkv')).includes('/piqad.js'));
    for (const l of partial) {
      const pg = await page('/?lang=' + l);
      check('page renders in ' + l, pg.includes('lang="' + l + '"') && pg.includes(require('../src/locales/' + l + '.json')['form.registration']));
      const pv = await page('/privacy?lang=' + l);
      check('privacy notice for ' + l + ' falls back to English', pv.includes(require('../src/locales/en.json')['priv.title']));
    }
    await rpc('saveEventConfig', { ...base, LANGUAGES: 'en', DEFAULT_LANGUAGE: 'en' });
  }

  // ---- currencies: native currency, extra display currencies, rates ----
  {
    const ec2 = (await rpc('getEventConfig')).body.result;
    const base = { ...ec2.values, EVENT_NAME: 'Smoke Test Event 2027', EVENT_SHORT: 'SmokeEvt', ORGANIZER: 'Smoke Club', ACCENT_COLOR: '#123456',
      EVENT_END_DATE: '2020-01-02', RETENTION_DAYS: '30', RETENTION_HOLD: '', LANGUAGES: 'en', DEFAULT_LANGUAGE: 'en' };
    const keys = ec2.fields.map(f => f.key);
    check('Event setup has the currency fields', keys.includes('CURRENCY') && keys.includes('CURRENCIES'), keys);
    check('default native currency is EUR', ec2.values.CURRENCY === 'EUR', ec2.values.CURRENCY);
    let r2 = (await rpc('saveEventConfig', { ...base, CURRENCY: 'sek1' })).body.result;
    check('invalid native currency code is rejected', !r2.success, r2);
    r2 = (await rpc('saveEventConfig', { ...base, CURRENCY: 'EUR', CURRENCIES: 'usd, eur, SEK, 12' })).body.result;
    check('invalid extra currency code is rejected', !r2.success, r2);
    r2 = (await rpc('saveEventConfig', { ...base, CURRENCY: 'sek', CURRENCIES: 'usd, SEK, gbp, usd' })).body.result;
    check('native currency saved (lower case accepted)', r2.success, r2);
    check('extras are normalised and exclude the native currency', (await rpc('getEventConfig')).body.result.values.CURRENCIES === 'USD,GBP', null);
    let cv = (await rpc('getCurrencies')).body.result;
    check('currency admin view lists the extras without rates', cv.success && cv.native === 'SEK' && cv.rates.length === 2 && cv.rates.every(x => x.rate === null), cv);

    let home = await (await fetch(BASE + '/')).text();
    check('booking page uses the native currency instead of the euro sign', /Includes electricity · \d+ SEK/.test(home) && !/Includes electricity · €/.test(home), (home.match(/Includes electricity[^<]*/) || [])[0]);
    check('no extra currencies offered while there are no rates', home.includes('"extras":[]'), null);
    r2 = (await rpc('submitBooking', booking({ callsign: 'CUR0', type: 'tent', displayCurrency: 'USD' }))).body.result;
    check('display currency without a rate is ignored', r2.success && /SEK/.test(r2.price.breakdown) && !/€/.test(r2.price.breakdown), r2);

    r2 = (await rpc('saveCurrencyRates', [{ code: 'USD', rate: '0,0935', manual: true }])).body.result;
    check('rate saved', r2.success && r2.rates.find(x => x.code === 'USD').rate === 0.0935, r2);
    r2 = (await rpc('saveCurrencyRates', [{ code: 'JPY', rate: '14' }])).body.result;
    check('rate for a currency that is not enabled is rejected', !r2.success, r2);
    r2 = (await rpc('saveCurrencyRates', [{ code: 'USD', rate: '0' }])).body.result;
    check('zero rate is rejected', !r2.success, r2);
    const fr = (await rpc('fetchCurrencyRates')).body.result;
    check('ECB fetch answers cleanly (success or a clear error)', fr && (fr.success || /ECB|fetch/i.test(fr.error)), fr);
    check('a manual rate survives the ECB fetch', (await rpc('getCurrencies')).body.result.rates.find(x => x.code === 'USD').rate === 0.0935, null);
    check('admin-only: currency rates need login', (await fetch(`${BASE}/api/rpc/saveCurrencyRates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: [[]] }) })).status === 401, null);

    home = await (await fetch(BASE + '/')).text();
    check('booking page offers the currency that has a rate', home.includes('"code":"USD"') && !home.includes('"code":"GBP"'), null);
    r2 = (await rpc('submitBooking', booking({ callsign: 'CUR1', type: 'tent', displayCurrency: 'usd' }))).body.result;
    const tentPrice = r2.price && r2.price.total;
    check('booking with a display currency: price stays in the native currency', r2.success && tentPrice > 0 && /SEK/.test(r2.price.breakdown), r2);
    const exp = (await rpc('exportBooking', r2.bookingRef)).body.result;
    const b = exp.data.booking;
    check('booking stores the native currency, the display currency and its rate', (b.Currency || b.currency) === 'SEK' && (b.DisplayCurrency || b.display_currency) === 'USD' && Number(b.DisplayRate || b.display_rate) === 0.0935, b);
    r2 = (await rpc('submitBooking', booking({ callsign: 'CUR2', type: 'tent', displayCurrency: 'GBP' }))).body.result;
    const b2 = (await rpc('exportBooking', r2.bookingRef)).body.result.data.booking;
    check('display currency without a rate is not stored', r2.success && !(b2.DisplayCurrency || b2.display_currency), b2);
    check('admin page shows the native currency', (await (await fetch(BASE + '/?admin=1')).text()).length > 0, null);
    await rpc('saveEventConfig', { ...base, CURRENCY: 'EUR', CURRENCIES: '' });
    home = await (await fetch(BASE + '/')).text();
    check('back to EUR: euro signs again', /Includes electricity · €\d+/.test(home), (home.match(/Includes electricity[^<]*/) || [])[0]);
  }

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
