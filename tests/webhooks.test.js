'use strict';
// Unit tests for the webhook safety rules (no database needed): address checks, private networks, signatures.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused:unused@localhost:1/unused';
delete process.env.API_WEBHOOK_ALLOW_PRIVATE;
const crypto = require('crypto');
const wh = require('../src/webhooks');
let failures = 0;
const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); if (!cond) failures++; };

for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.5', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1'])
  check('private address detected: ' + ip, wh.privateIp(ip) === true, ip);
for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.255.255', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
  check('public address allowed: ' + ip, wh.privateIp(ip) === false, ip);

check('https address accepted', !!wh.checkUrl('https://example.com/hook').url, wh.checkUrl('https://example.com/hook'));
for (const bad of ['http://example.com/hook', 'ftp://example.com/', 'example.com', '', 'https://user:pw@example.com/', 'https://127.0.0.1/hook', 'https://[::1]/hook', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.5/'])
  check('address refused: ' + (bad || '(empty)'), !!wh.checkUrl(bad).error, wh.checkUrl(bad));

const secret = 'whsec_test';
check('signature is HMAC-SHA256 of "timestamp.body"', wh.sign(secret, '123', '{"a":1}') === crypto.createHmac('sha256', secret).update('123.{"a":1}').digest('hex'), null);
check('signature changes with the body', wh.sign(secret, '123', 'a') !== wh.sign(secret, '123', 'b'), null);
check('signature changes with the timestamp', wh.sign(secret, '123', 'a') !== wh.sign(secret, '124', 'a'), null);

(async () => {
  // A name that resolves to a private address is refused when connecting, not only when typed in
  const r = await wh.post('https://localhost:9/hook', {}, '{}', 3000);
  check('connecting to a name that resolves to a private address is refused', !!r.error && /private network/.test(r.error), r);
  const r2 = await wh.post('http://localhost:9/hook', {}, '{}', 3000);
  check('plain http to localhost is refused too', !!r2.error && /private network/.test(r2.error), r2);
  console.log(failures ? failures + ' webhook test(s) FAILED' : 'webhook tests passed');
  process.exit(failures ? 1 : 0);
})();
