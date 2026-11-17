'use strict';
// Integration test: real Postgres (DATABASE_URL, or embedded-postgres if installed), fake Docker runner, fake tenant-DB admin, fake Stripe.
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
process.env.OPERATOR_PASSWORD = 'op-pw'; process.env.SESSION_SECRET = 'sess'; process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
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
  const provisioner = require('../src/provisioner').create({ runner, tenantDb });
  const lifecycle = require('../src/lifecycle');
  const fakeStripe = { verifyWebhook: stripe.verifyWebhook, async createCheckoutSession(o) { return { id: 'cs_' + o.id, url: 'https://stripe.test/pay/' + o.id }; } };
  await db.init();
  const app = require('../src/app').build({ provisioner, stripe: fakeStripe });
  const srv = http.createServer(app); await new Promise(r => srv.listen(0, r));
  const base = 'http://localhost:' + srv.address().port;
  const j = (path, opt = {}) => fetch(base + path, { redirect: 'manual', ...opt });
  const body = { slug: 'oh-camp', event_name: 'OH Camp 2027', event_short: 'OHC27', organizer: 'OH Club', contact_name: 'Matti', contact_email: 'matti@example.com', event_end: '2027-07-04' };
  let ipn = 0;
  const postJson = (b, ip) => j('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || '10.0.0.' + (++ipn) }, body: JSON.stringify(b) });

  // order validation
  assert.strictEqual((await postJson({ ...body, slug: 'Bad Slug' })).status, 400);
  assert.strictEqual((await postJson({ ...body, slug: 'admin' })).status, 400);
  assert.strictEqual((await postJson({ ...body, contact_email: 'x' })).status, 400);
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
  assert.strictEqual(o.status, 'approved'); assert.strictEqual(o.price_cents, 5000);
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
  const ready = mailer.outbox.find(m => m.subject.startsWith('Your event system is ready'));
  assert.ok(ready.text.includes(start.args[1].SETUP_PASSWORD));

  // lifecycle: warn -> suspend -> erase
  const day = 86400000, end = new Date('2027-07-04').getTime();
  let r = await lifecycle.tick(provisioner, new Date(end + 24 * day)); assert.deepStrictEqual(r, { warned: 1, suspended: 0 + 1, erased: 0 });
  assert.strictEqual((await db.query("SELECT state FROM tenants WHERE slug='oh-camp'")).rows[0].state, 'suspended');
  r = await lifecycle.tick(provisioner, new Date(end + 31 * day)); assert.strictEqual(r.erased, 1);
  assert.strictEqual((await db.query("SELECT state FROM tenants WHERE slug='oh-camp'")).rows[0].state, 'erased');
  assert.ok(dropped.includes('oh-camp'));
  assert.strictEqual((await postJson(body)).status, 200);                                  // slug is free again after erase

  // provisioning failure marks order failed
  const bad = require('../src/provisioner').create({ runner: { ...runner, initEvent: async () => '{"success":false}' }, tenantDb });
  const nid = (await db.query("INSERT INTO orders (slug,event_name,event_short,organizer,contact_name,contact_email,status) VALUES ('fail-one','F','F','F','F','f@example.com','paid') RETURNING *")).rows[0];
  await assert.rejects(bad.provision(nid));
  assert.strictEqual((await db.query('SELECT status FROM orders WHERE id=$1', [nid.id])).rows[0].status, 'failed');

  // per-IP rate limit
  const codes = []; for (let i = 0; i < 7; i++) codes.push((await postJson({ ...body, slug: 'rl-' + i + 'x' }, '9.9.9.9')).status);
  assert.deepStrictEqual(codes, [200, 200, 200, 200, 200, 429, 429]);

  console.log('platform tests passed');
  srv.close(); await db.close(); if (pg) await pg.stop(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
