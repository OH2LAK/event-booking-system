'use strict';
// End-to-end test of event profiles/modules and vendor spaces against a running instance.
//   BASE_URL=http://localhost:3000 SETUP_PASSWORD=... node tests/vendors.js
// WARNING: changes the event setup and creates test bookings (callsigns starting with TESTV) in the target database.
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const { signIn } = require('./adminSession');
let cookie = '';
let failures = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra)));
  if (!cond) failures++;
};
async function rpc(method, ...args) {
  const r = await fetch(`${BASE}/api/rpc/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ args }) });
  return { status: r.status, body: await r.json() };
}
async function api(method, path, key, body) {
  const r = await fetch(BASE + '/api/v1' + path, { method, headers: Object.assign({ Authorization: 'Bearer ' + key }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
  return { status: r.status, json, text };
}
const person = o => Object.assign({ name: 'Vendor Person', email: 'vendor@example.com', country: 'FI', privacyAck: true }, o);
const book = async o => (await rpc('submitBooking', person(o))).body.result;

(async () => {
  cookie = await signIn(BASE, 'setup');
  check('setup login', !!cookie, null);
  const ec = (await rpc('getEventConfig')).body.result;
  check('profiles are offered to the admin UI', ec.profiles && ec.profiles.hamfest && ec.profiles.hamfest.modules.VENDORS === 'yes', ec.profiles);
  const base = Object.assign({}, ec.values, { EVENT_NAME: 'Vendor Test Fair', EVENT_SHORT: 'VendFair', ORGANIZER: 'Vendor Club', EVENT_END_DATE: '2099-01-02', RETENTION_HOLD: '', API_ENABLED: 'yes' });
  await rpc('saveAdminSettings', '', { REGISTRATION_OPEN: true });

  // ---- profile / modules ----
  const HAM = { EVENT_PROFILE: 'hamfest', MOD_ROOMS: 'no', MOD_CAMPING: 'no', MOD_DAYVISITOR: 'yes', MOD_VENDORS: 'yes' };
  let r = (await rpc('saveEventConfig', Object.assign({}, base, HAM))).body.result;
  check('hamfest profile saved', r && r.success, r);
  const days = (await rpc('getAddons')).body.result.days;
  check('structure has event days', days.length >= 1, days);
  const d1 = days[0].key;

  // ---- vendor space catalog ----
  const space = o => Object.assign({ kind: 'vendor', id: 'table', name: 'Flea market table', description: 'Table 1.8 m', price: 20, max_qty: 4, capacity: 3, enabled: true, space_type: 'table', day_key: d1, starts: '09:00', ends: '15:00', size: '1.8 x 0.8 m', power: '230 V', location: 'Hall B', pricing: 'item', unit: 'table', prompt: 'What will you sell?', prompt_required: true }, o);
  let list = [space(), space({ id: 'booth', name: 'Demo booth', price: 10, pricing: 'metre', unit: 'metre', max_qty: 10, capacity: 0, day_key: '', prompt_required: false, starts: '', ends: '' }), space({ id: 'trunk', name: 'Trunk sale', price: 15, pricing: 'day', day_key: '', space_type: 'trunk', capacity: 0, prompt: '', prompt_required: false, starts: '', ends: '' })];
  r = (await rpc('saveAddons', list, 'vendor')).body.result;
  check('vendor spaces saved', r && r.success, r);
  r = (await rpc('saveAddons', [space({ starts: '25:00' })], 'vendor')).body.result;
  check('bad time rejected', r && !r.success, r);
  r = (await rpc('saveAddons', [space({ starts: '15:00', ends: '09:00' })], 'vendor')).body.result;
  check('end before start rejected', r && !r.success, r);
  r = (await rpc('saveAddons', [space({ prompt: '', prompt_required: true })], 'vendor')).body.result;
  check('a required question needs its text', r && !r.success, r);
  r = (await rpc('saveAddons', [space({ day_key: 'nope' })], 'vendor')).body.result;
  check('unknown day rejected', r && !r.success, r);
  r = (await rpc('saveAddons', [{ id: 'meal', name: 'Lunch', price: 8, max_qty: 2, capacity: 0, enabled: true, kind: 'extra' }], 'extra')).body.result;
  check('extras saved separately', r && r.success, r);
  const cat = (await rpc('getAddons')).body.result.addons;
  check('saving extras keeps the vendor spaces', cat.filter(a => a.kind === 'vendor').length === 3 && cat.some(a => a.id === 'meal'), cat.map(a => a.id));
  r = (await rpc('saveAddons', [{ id: 'table', name: 'Clash', price: 1, enabled: true, kind: 'extra' }], 'extra')).body.result;
  check('an id used by the other kind is refused', r && !r.success, r);
  r = (await rpc('saveAddons', [space({ id: 'x1' })], 'extra')).body.result;
  check('wrong kind for the list is refused', r && !r.success, r);

  // ---- booking page ----
  const home = await (await fetch(BASE + '/')).text();
  check('booking page offers vendor registration and hides accommodation', home.includes('id="card-vendor"') && !/id="card-vendor"[^>]*display:none/.test(home) && /id="card-new"[^>]*display:none/.test(home), home.length);
  const scripts = [...home.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let parsed = 0; for (const s of scripts) { try { new Function(s); parsed++; } catch (e) { console.log(e.message); } }
  check('booking page scripts parse', scripts.length > 0 && parsed === scripts.length, [parsed, scripts.length]);
  const av = (await rpc('getAvailability')).body.result;
  const pub = av.addons.filter(a => a.kind === 'vendor');
  check('availability lists the vendor spaces with details', pub.length === 3 && pub.find(a => a.id === 'table').location === 'Hall B' && pub.find(a => a.id === 'table').left === 3, pub);
  check('per-day pricing is multiplied by the event days', pub.find(a => a.id === 'trunk').unitPrice === 15 * days.length, pub.find(a => a.id === 'trunk'));

  // ---- vendor-only bookings ----
  r = await book({ type: 'vendor', callsign: '', addons: [{ id: 'table', qty: 2, note: 'Radio parts and cables' }], tickets: ['Anna Example', 'Bob Example', 'anna example', ' '] });
  check('vendor-only booking without callsign works', r.success && /^V\d+-\d+$/.test(r.bookingRef), r);
  const ref1 = r.bookingRef;
  check('vendor price is the spaces only (no meeting fee)', r.price && r.price.total === 40, r.price);
  r = await book({ type: 'vendor', callsign: 'TESTV2', addons: [{ id: 'table', qty: 1, note: '' }] });
  check('a required answer is enforced', !r.success && r.code === 'err.addonNote', r);
  r = await book({ type: 'vendor', callsign: 'TESTV3', addons: [] });
  check('a vendor booking needs a space', !r.success && r.code === 'err.vendorSpace', r);
  r = await book({ type: 'vendor', callsign: 'TESTV4', addons: [{ id: 'meal', qty: 1 }] });
  check('an extra alone is not a vendor space', !r.success && r.code === 'err.vendorSpace', r);
  r = await book({ type: 'vendor', callsign: 'TESTV5', addons: [{ id: 'table', qty: 2, note: 'x1' }] });
  check('capacity is enforced (3 tables, 2 taken)', !r.success && r.code === 'err.addonFull', r);
  r = await book({ type: 'vendor', callsign: 'TESTV6', addons: [{ id: 'table', qty: 1, note: 'Kits' }, { id: 'booth', qty: 3, note: 'Demo' }, { id: 'trunk', qty: 1 }, { id: 'meal', qty: 2 }], tickets: ['Cecilia Helper'] });
  check('several spaces and an extra in one vendor booking', r.success && r.price.total === 20 + 30 + 15 * days.length + 16, r);
  const ref6 = r.bookingRef;
  r = await book({ type: 'vendor', callsign: 'TESTV7', addons: [{ id: 'booth', qty: 1 }], tickets: Array.from({ length: 21 }, (_, i) => 'Person Number ' + (i + 1)) });
  check('too many ticket names are refused', !r.success && r.code === 'err.tickets', r);
  r = await book({ type: 'room', callsign: 'TESTV8', roomId: '2S' });
  check('rooms are off: room booking refused', !r.success, r);
  r = await book({ type: 'tent', callsign: 'TESTV9' });
  check('camping is off: tent booking refused', !r.success, r);
  r = await book({ type: 'vendor', callsign: 'TESTV6', addons: [{ id: 'booth', qty: 1 }] });
  check('a callsign can only book once', !r.success && r.code === 'err.exists', r);

  // ---- hybrid: day attendance plus a vendor space ----
  r = await book({ type: 'dayvisitor', callsign: 'TESTV10', visitorDays: [d1], addons: [{ id: 'booth', qty: 2, note: 'Antennas' }], tickets: ['Dora Helper'] });
  check('day attendance can include a vendor space and tickets', r.success, r);
  const ref10 = r.bookingRef;
  r = await book({ type: 'dayvisitor', callsign: 'TESTV11', visitorDays: [d1], tickets: ['Nobody Needs This'] });
  const ref11 = r.bookingRef;

  // ---- admin data ----
  const admin2 = (await rpc('getAdminData')).body.result;
  const rw = ref => admin2.rows.find(x => x.BookingRef === ref);
  check('admin row has type vendor, notes and ticket names', rw(ref1) && rw(ref1).Type === 'vendor' && /Radio parts/.test(rw(ref1).AddonsJson) && JSON.parse(rw(ref1).TicketsJson).join('|') === 'Anna Example|Bob Example', rw(ref1));
  check('ticket names are not kept without a vendor space', rw(ref11) && JSON.parse(rw(ref11).TicketsJson).length === 0, rw(ref11) && rw(ref11).TicketsJson);
  check('hybrid booking keeps its note', rw(ref10) && /Antennas/.test(rw(ref10).AddonsJson), rw(ref10));

  // ---- admin edit: change tickets and a note ----
  r = (await rpc('updateBooking', '', ref1, { Tickets: ['Anna Example', 'Eero Extra'], Addons: [{ id: 'table', qty: 2, note: 'Updated note' }] }, false)).body.result;
  check('admin can edit tickets and notes', r && r.success, r);
  const after = (await rpc('getAdminData')).body.result.rows.find(x => x.BookingRef === ref1);
  check('edit is stored and the price keeps the snapshot', JSON.parse(after.TicketsJson).join('|') === 'Anna Example|Eero Extra' && /Updated note/.test(after.AddonsJson) && Number(after.TotalPrice) === 40, after);

  // ---- API ----
  const key = (await rpc('createApiKey', 'vendor-test', ['stats', 'bookings:read', 'bookings:write'])).body.result;
  check('api key created', key && key.success, key);
  const k = key.key;
  let a = await api('GET', '/event', k);
  check('API event info shows profile and modules', a.json && a.json.profile === 'hamfest' && a.json.modules.vendors === true && a.json.modules.rooms === false && a.json.mode === 'day', a.text);
  a = await api('GET', '/extras', k);
  const t = a.json && a.json.data && a.json.data.find(x => x.id === 'table');
  check('API extras catalog describes vendor spaces', t && t.kind === 'vendor' && t.vendorSpace.location === 'Hall B' && t.vendorSpace.questionRequired === true && t.left === 0, t);
  a = await api('GET', '/bookings/' + ref1, k);
  check('API booking shows notes and tickets', a.json && a.json.tickets.join('|') === 'Anna Example|Eero Extra' && a.json.extras[0].note === 'Updated note', a.text);
  a = await api('POST', '/bookings', k, person({ type: 'vendor', callsign: '', extras: [{ id: 'booth', qty: 1, note: 'API sale' }], tickets: ['Api Helper'] }));
  check('API can create a vendor booking', a.status === 201 && a.json.type === 'vendor' && a.json.tickets[0] === 'Api Helper', a.text);
  a = await api('PATCH', '/bookings/' + ref6, k, { tickets: ['Cecilia Helper', 'Dan Helper'] });
  check('API can change ticket names', a.status === 200 && a.json.tickets.length === 2, a.text);
  const csv = await fetch(BASE + '/api/v1/export/bookings.csv', { headers: { Authorization: 'Bearer ' + k } });
  check('CSV export still works', csv.status === 200, csv.status);
  const oa = await (await fetch(BASE + '/api/v1/openapi.json')).json();
  check('OpenAPI documents vendor type, tickets and notes', oa.components.schemas.NewBooking.properties.tickets && oa.components.schemas.Booking.properties.tickets && JSON.stringify(oa.components.schemas.Booking.properties.type.enum).includes('vendor'), null);

  // ---- GDPR export includes the ticket names ----
  const ex = (await rpc('exportBooking', ref1)).body.result;
  check('personal-data export includes ticket names', ex && ex.success && JSON.stringify(ex.data).includes('Eero Extra'), ex && Object.keys(ex.data || {}));

  // ---- report and admin pages ----
  const rep = await (await fetch(BASE + '/report?view=hotel', { headers: { cookie } })).text();
  check('report lists vendors with spaces, notes and ticket names', rep.includes('Myyjät ja myyntipaikat') && rep.includes('Updated note') && rep.includes('Eero Extra'), rep.length);
  const csvR = await (await fetch(BASE + '/report?view=hotel&fmt=csv', { headers: { cookie } })).text();
  check('report CSV has the entry tickets column', csvR.includes('EntryTickets') && csvR.includes('Anna Example + Eero Extra'), csvR.slice(0, 200));
  const panel = (await rpc('getAdminPanelHtml', '', 'setup')).body.result;
  const html = typeof panel === 'string' ? panel : (panel && (panel.html || panel.data)) || '';
  const shell = await (await fetch(BASE + '/?setup=1', { headers: { cookie } })).text();
  check('setup panel has the vendor card and the page loads its script', html.includes('id="vendors-card"') && shell.includes('admin-vendors.js'), html.length);
  const pScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let pParsed = 0; for (const x of pScripts) { try { new Function(x); pParsed++; } catch (e) { console.log(e.message); } }
  check('setup panel scripts parse', pParsed === pScripts.length, [pParsed, pScripts.length]);

  // ---- module off: spaces vanish, old bookings stay ----
  r = (await rpc('saveEventConfig', Object.assign({}, base, { EVENT_PROFILE: 'day', MOD_ROOMS: 'no', MOD_CAMPING: 'no', MOD_DAYVISITOR: 'yes', MOD_VENDORS: 'no' }))).body.result;
  check('vendors module switched off', r && r.success, r);
  r = await book({ type: 'vendor', callsign: 'TESTV12', addons: [{ id: 'booth', qty: 1 }] });
  check('vendor bookings are refused when the module is off', !r.success && r.code === 'err.type', r);
  r = await book({ type: 'dayvisitor', callsign: 'TESTV13', visitorDays: [d1], addons: [{ id: 'booth', qty: 1 }] });
  check('vendor spaces cannot be added when the module is off', !r.success && r.code === 'err.addon', r);
  check('existing vendor bookings remain', (await rpc('getAdminData')).body.result.rows.some(x => x.BookingRef === ref1), null);

  // restore a normal overnight event
  await rpc('saveEventConfig', Object.assign({}, base, { EVENT_PROFILE: 'overnight', MOD_ROOMS: 'yes', MOD_CAMPING: 'yes', MOD_DAYVISITOR: 'yes', MOD_VENDORS: 'no', API_ENABLED: 'no' }));

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
