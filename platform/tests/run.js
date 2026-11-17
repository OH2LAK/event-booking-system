'use strict';
// Integration test: real Postgres (DATABASE_URL, or embedded-postgres if installed), fake Docker runner, fake tenant-DB admin, fake Stripe.
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
process.env.OPERATOR_PASSWORD = 'op-pw'; process.env.SESSION_SECRET = 'sess'; process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.CF_API_TOKEN = 'cf-token'; process.env.CF_ZONE_ID = 'zone1'; process.env.CUSTOM_DOMAIN_FEE_CENTS = '1500';
process.env.PLATFORM_PUBLIC_URL = 'https://platform.test'; process.env.EVENT_PRICE_CENTS = '5000'; process.env.RETENTION_DAYS = '30';

(async () => {
  let pg;
  if (!process.env.DATABASE_URL) {
    const EP = require('embedded-postgres'); const E = EP.default || EP;
    pg = new E({ databaseDir: require('os').tmpdir() + '/ebs-platform-test-' + process.pid, user: 'u', password: 'p', port: 54340, persistent: false });
    await pg.initialise(); await pg.start(); await pg.createDatabase('t');
    process.env.DATABASE_URL = 'postgres://u:p@localhost:54340/t';
  }
  const config = require('../src/config'); const db = require('../src/db');
  const stripe = require('../src/stripe'); const mailer = require('../src/mailer');
  const runner = require('../src/runners/fake');
  const dropped = [];
  const tenantDb = { async create(slug) { return 'postgres://x/' + slug; }, async drop(slug) { dropped.push(slug); } };
  // fake Cloudflare for SaaS: records calls; the hostname stays pending until cfActive is set
  const cfCalls = []; let cfActive = false;
  const fakeCf = { enabled: () => true,
    async createCustomHostname(h) { cfCalls.push(['create', h]); return { id: 'ch_1', hostname: h, status: 'pending', sslStatus: 'pending_validation', active: false, failed: false, ownership: { name: '_cf-custom-hostname.' + h, value: 'own-token-1' }, errors: [] }; },
    async getCustomHostname(id) { cfCalls.push(['get', id]); return { id, status: cfActive ? 'active' : 'pending', sslStatus: cfActive ? 'active' : 'pending_validation', active: cfActive, failed: false, ownership: null, errors: [] }; },
    async deleteCustomHostname(id) { cfCalls.push(['delete', id]); } };
  const provisioner = require('../src/provisioner').create({ runner, tenantDb, cloudflare: fakeCf });
  const lifecycle = require('../src/lifecycle');
  const fakeStripe = { verifyWebhook: stripe.verifyWebhook, async createCheckoutSession(o) { return { id: 'cs_' + o.id, url: 'https://stripe.test/pay/' + o.id }; } };
  await db.init();
  const app = require('../src/app').build({ provisioner, stripe: fakeStripe, cloudflare: fakeCf });
  const srv = http.createServer(app); await new Promise(r => srv.listen(0, r));
  const base = 'http://localhost:' + srv.address().port;
  const j = (path, opt = {}) => fetch(base + path, { redirect: 'manual', ...opt });
  const body = { slug: 'oh-camp', event_name: 'OH Camp 2027', event_short: 'OHC27', organizer: 'OH Club', contact_name: 'Matti', contact_email: 'matti@example.com', event_end: '2027-07-04', event_mode: 'day', custom_domain: 'Ilmo.OHCamp.fi' };
  let ipn = 0;
  const postJson = (b, ip) => j('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || '10.0.0.' + (++ipn) }, body: JSON.stringify(b) });

  // order validation
  assert.strictEqual((await postJson({ ...body, slug: 'Bad Slug' })).status, 400);
  assert.strictEqual((await postJson({ ...body, slug: 'admin' })).status, 400);
  assert.strictEqual((await postJson({ ...body, contact_email: 'x' })).status, 400);
  assert.strictEqual((await postJson({ ...body, event_mode: 'hotel' })).status, 400);   // unknown event type
  for (const bad of ['ohcamp.fi', 'x.hamradio-events.com', 'hamradio-events.com', 'a b.ohcamp.fi', 'ilmo.ohcamp']) assert.strictEqual((await postJson({ ...body, custom_domain: bad })).status, 400, bad);
  const srvOff = http.createServer(require('../src/app').build({ provisioner, stripe: fakeStripe, cloudflare: { enabled: () => false } })); await new Promise(r => srvOff.listen(0, r));
  assert.strictEqual((await fetch('http://localhost:' + srvOff.address().port + '/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 400);   // own domains off without Cloudflare
  srvOff.close();
  assert.strictEqual((await postJson({ ...body, website: 'spam' })).status, 200);       // honeypot
  assert.strictEqual((await db.query('SELECT count(*) FROM orders')).rows[0].count, '0');
  assert.strictEqual((await postJson(body)).status, 200);
  assert.strictEqual((await postJson(body)).status, 409);                                 // slug taken

  // operator auth + CSRF
  assert.strictEqual((await j('/operator')).status, 302);
  assert.strictEqual((await j('/operator/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=nope' })).status, 401);
  const login = await j('/operator/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=op-pw' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.ok((await (await j('/operator', { headers: { Cookie: cookie } })).text()).includes('oh-camp'));
  const adm = (path, extra = {}) => j(path, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', ...extra }, body: 'id=1' });
  assert.strictEqual((await adm('/operator/approve')).status, 403);                       // no Origin
  assert.strictEqual((await adm('/operator/approve', { Origin: 'https://evil.test' })).status, 403);

  // approve -> payment link emailed
  await adm('/operator/approve', { Origin: 'https://platform.test' });
  let o = (await db.query('SELECT * FROM orders WHERE id=1')).rows[0];
  assert.strictEqual(o.custom_domain, 'ilmo.ohcamp.fi');                                 // normalised
  assert.strictEqual(o.status, 'approved'); assert.strictEqual(o.price_cents, 6500); assert.strictEqual(o.domain_fee_cents, 1500);   // hosting 50 + own domain 15
  assert.ok(mailer.outbox.some(m => m.to === 'matti@example.com' && m.text.includes('stripe.test/pay/1')));

  // webhook: bad signature, then good, then replay
  const evt = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid' } } });
  const sig = (raw, secret = 'whsec_test', t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
  assert.strictEqual((await j('/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': sig(evt, 'wrong') }, body: evt })).status, 400);
  assert.strictEqual((await j('/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': sig(evt, 'whsec_test', 1000) }, body: evt })).status, 400);
  assert.strictEqual((await j('/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': sig(evt) }, body: evt })).status, 200);
  assert.strictEqual((await j('/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': sig(evt) }, body: evt })).status, 200);
  o = (await db.query('SELECT * FROM orders WHERE id=1')).rows[0];
  assert.strictEqual(o.status, 'active');
  assert.strictEqual(runner.calls.filter(c => c.op === 'start').length, 1);               // replay did not provision twice
  const start = runner.calls.find(c => c.op === 'start');
  assert.strictEqual(start.args[0], 'ebs-oh-camp'); assert.ok(start.args[2]['traefik.http.routers.ebs-oh-camp.rule'].includes('oh-camp.hamradio-events.com'));
  assert.ok(start.args[1].ADMIN_PASSWORD && start.args[1].SETUP_PASSWORD && start.args[1].ADMIN_PASSWORD !== start.args[1].SETUP_PASSWORD);
  const init = runner.calls.find(c => c.op === 'initEvent'); assert.strictEqual(JSON.parse(init.args[2]).EVENT_SHORT, 'OHC27');
  assert.strictEqual(JSON.parse(init.args[2]).EVENT_MODE, 'day');                         // event type reaches the new instance
  const ready = mailer.outbox.find(m => m.subject.startsWith('Your event system is ready'));
  assert.ok(ready.text.includes(start.args[1].SETUP_PASSWORD));

  // own domain: Traefik answers on both names, the instance's public URL is the own domain, Cloudflare hostname created, DNS instructions emailed
  assert.ok(start.args[2]['traefik.http.routers.ebs-oh-camp.rule'].includes('Host(`ilmo.ohcamp.fi`)'));
  assert.strictEqual(start.args[1].PUBLIC_URL, 'https://ilmo.ohcamp.fi');
  assert.deepStrictEqual(cfCalls.filter(c => c[0] === 'create'), [['create', 'ilmo.ohcamp.fi']]);
  let ten = (await db.query("SELECT * FROM tenants WHERE slug='oh-camp'")).rows[0];
  assert.strictEqual(ten.domain_status, 'pending'); assert.strictEqual(ten.cf_hostname_id, 'ch_1');
  assert.ok(ready.text.includes('CNAME') && ready.text.includes('custom.hamradio-events.com') && ready.text.includes('own-token-1'));
  assert.ok((await (await j('/operator', { headers: { Cookie: cookie } })).text()).includes('own domain: <b>ilmo.ohcamp.fi</b> (pending'));
  assert.strictEqual((await postJson({ ...body, slug: 'oh-camp-2' })).status, 409);       // the same domain cannot be ordered twice
  // polling: still pending, then active -> customer is told
  await provisioner.pollDomains();
  assert.strictEqual((await db.query("SELECT domain_status FROM tenants WHERE slug='oh-camp'")).rows[0].domain_status, 'pending');
  cfActive = true; await provisioner.pollDomains();
  assert.strictEqual((await db.query("SELECT domain_status FROM tenants WHERE slug='oh-camp'")).rows[0].domain_status, 'active');
  assert.ok(mailer.outbox.some(m => m.to === 'matti@example.com' && m.subject.includes('ilmo.ohcamp.fi') && m.text.includes('https://ilmo.ohcamp.fi')));
  const getsBefore = cfCalls.filter(c => c[0] === 'get').length; await provisioner.pollDomains();
  assert.strictEqual(cfCalls.filter(c => c[0] === 'get').length, getsBefore);              // active domains are not polled again
  // Stripe: own-domain fee is its own line, the lines add up to the order total
  const li = Object.values(stripe.lineItems({ ...o, price_cents: 6500, domain_fee_cents: 1500, currency: 'eur' }));
  assert.deepStrictEqual(li.map(x => x.price_data.unit_amount), [5000, 1500]);
  assert.strictEqual(Object.keys(stripe.lineItems({ ...o, custom_domain: null, price_cents: 5000, domain_fee_cents: 0, currency: 'eur' })).length, 1);

  // lifecycle: warn -> suspend -> erase
  const day = 86400000, end = new Date('2027-07-04').getTime();
  let r = await lifecycle.tick(provisioner, new Date(end + 24 * day)); assert.deepStrictEqual(r, { warned: 1, suspended: 0 + 1, erased: 0 });
  assert.strictEqual((await db.query("SELECT state FROM tenants WHERE slug='oh-camp'")).rows[0].state, 'suspended');
  r = await lifecycle.tick(provisioner, new Date(end + 31 * day)); assert.strictEqual(r.erased, 1);
  assert.strictEqual((await db.query("SELECT state FROM tenants WHERE slug='oh-camp'")).rows[0].state, 'erased');
  assert.ok(dropped.includes('oh-camp'));
  assert.ok(cfCalls.some(c => c[0] === 'delete' && c[1] === 'ch_1'));                      // hostname removed from Cloudflare when the instance is erased
  assert.strictEqual((await postJson(body)).status, 200);                                  // slug is free again after erase

  // provisioning failure marks order failed
  const bad = require('../src/provisioner').create({ runner: { ...runner, initEvent: async () => '{"success":false}' }, tenantDb });
  const nid = (await db.query("INSERT INTO orders (slug,event_name,event_short,organizer,contact_name,contact_email,status) VALUES ('fail-one','F','F','F','F','f@example.com','paid') RETURNING *")).rows[0];
  await assert.rejects(bad.provision(nid));
  assert.strictEqual((await db.query('SELECT status FROM orders WHERE id=$1', [nid.id])).rows[0].status, 'failed');

  // per-IP rate limit
  const codes = []; for (let i = 0; i < 7; i++) codes.push((await postJson({ ...body, custom_domain: '', slug: 'rl-' + i + 'x' }, '9.9.9.9')).status);
  assert.deepStrictEqual(codes, [200, 200, 200, 200, 200, 429, 429]);

  // Cloudflare client: request shape and the "already exists" fallback (fetch is stubbed)
  const cf = require('../src/cloudflare'); const sent = [];
  const stub = responses => async (url, opt) => { sent.push({ url, opt }); const r = responses.shift(); return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body }; };
  const host = { id: 'h1', hostname: 'a.b.fi', status: 'pending', ssl: { status: 'pending_validation' }, ownership_verification: { name: '_cf-custom-hostname.a.b.fi', value: 'v' } };
  let h = await cf.createCustomHostname('a.b.fi', stub([{ body: { success: true, result: host } }]));
  assert.ok(sent[0].url.endsWith('/zones/zone1/custom_hostnames') && sent[0].opt.method === 'POST' && sent[0].opt.headers.Authorization === 'Bearer cf-token');
  assert.deepStrictEqual(JSON.parse(sent[0].opt.body), { hostname: 'a.b.fi', ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } });
  assert.strictEqual(h.active, false); assert.strictEqual(h.ownership.value, 'v');
  h = await cf.createCustomHostname('a.b.fi', stub([{ ok: false, status: 409, body: { success: false, errors: [{ code: 1406, message: 'duplicate' }] } }, { body: { success: true, result: [{ ...host, status: 'active', ssl: { status: 'active' } }] } }]));
  assert.strictEqual(h.active, true); assert.ok(sent[sent.length - 1].url.includes('hostname=a.b.fi'));
  await assert.rejects(cf.createCustomHostname('a.b.fi', stub([{ ok: false, status: 400, body: { success: false, errors: [{ code: 1000, message: 'nope' }] } }])), /Cloudflare: nope/);
  await cf.deleteCustomHostname('gone', stub([{ ok: false, status: 404, body: { success: false, errors: [{ code: 1, message: 'not found' }] } }]));   // already deleted is fine
  assert.strictEqual(cf.normalize({ id: 'x', status: 'pending', ssl: { status: 'validation_timed_out' } }).failed, true);

  console.log('platform tests passed');
  srv.close(); await db.close(); if (pg) await pg.stop(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
