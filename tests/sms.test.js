'use strict';
const assert = require('assert');
const db = require('../src/db');
const log = []; let sent = 0;
db.query = async () => ({ rows: [{ n: sent }] });
db.logEvent = async (...a) => { log.push(a); };
const sms = require('../src/sms');
const reset = () => { for (const k of ['SMS_GATEWAY_URL', 'SMS_API_TOKEN', 'SMS_SENDER_ID', 'DEMO_MODE', 'SMS_MAX_PER_INSTANCE']) delete process.env[k]; log.length = 0; sent = 0; };

(async () => {
  assert.strictEqual(sms.normalizeNumber('040 123 4567'), '358401234567');
  assert.strictEqual(sms.normalizeNumber('+358 40 123 4567'), '358401234567');
  assert.strictEqual(sms.normalizeNumber('0046 70-123 45 67'), '46701234567');
  assert.strictEqual(sms.normalizeNumber('401234567'), null);        // no prefix: never guess
  assert.strictEqual(sms.normalizeNumber('+12'), null);
  assert.strictEqual(sms.normalizeNumber(''), null);
  assert.ok(sms.validSender('HamEvents')); assert.ok(sms.validSender('Ham Events'));
  assert.ok(!sms.validSender('Hamradio-events')); assert.ok(!sms.validSender('123456')); assert.ok(!sms.validSender(''));

  reset(); assert.strictEqual(sms.enabled(), false);
  assert.deepStrictEqual(await sms.send('+358401234567', 'x'), { ok: false, skipped: 'disabled' });
  process.env.SMS_GATEWAY_URL = 'https://gw.test/sms'; process.env.SMS_API_TOKEN = 'secret-token'; process.env.SMS_SENDER_ID = 'Hamradio-events';
  assert.strictEqual(sms.enabled(), false);                          // invalid sender id keeps it off
  process.env.SMS_SENDER_ID = 'HamEvents'; assert.strictEqual(sms.enabled(), true);
  process.env.DEMO_MODE = '1'; assert.strictEqual(sms.enabled(), false); delete process.env.DEMO_MODE;

  let req;
  const okFetch = async (url, o) => { req = { url, o }; return { ok: true, status: 200 }; };
  assert.deepStrictEqual(await sms.send('040 123 4567', 'Hello', { fetch: okFetch, externalId: 'REF1', label: 'OH2XYZ' }), { ok: true, status: 200 });
  assert.strictEqual(req.url, 'https://gw.test/sms'); assert.strictEqual(req.o.headers.token, 'secret-token');
  assert.deepStrictEqual(JSON.parse(req.o.body), { to: '358401234567', from: 'HamEvents', content: 'Hello', external_id: 'REF1' });
  assert.ok(log.some(l => l[1] === 'sms_sent'));
  assert.ok(!JSON.stringify(log).includes('secret-token') && !JSON.stringify(log).includes('358401234567'));

  assert.strictEqual((await sms.send('bad', 'x', { fetch: okFetch })).skipped, 'bad-number');
  assert.strictEqual((await sms.send('+358401234567', 'x', { fetch: async () => ({ ok: false, status: 401 }) })).status, 401);
  assert.ok((await sms.send('+358401234567', 'x', { fetch: async () => { throw new Error('boom'); } })).error === 'boom');
  sent = 300; assert.strictEqual((await sms.send('+358401234567', 'x', { fetch: okFetch })).skipped, 'limit');

  console.log('sms tests passed'); reset(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
