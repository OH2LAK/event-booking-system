'use strict';
// Unit tests for src/currency.js (no database or server needed): node tests/currency.test.js
const path = require('path');
const queries = [];
require.cache[require.resolve('../src/db')] = { id: 'db', filename: 'db', loaded: true, exports: { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } } };
const { CONFIG } = require('../src/config');
const cur = require('../src/currency');

let failed = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + JSON.stringify(info))); if (!ok) failed++; };
const NB = ' ';

(async () => {
  // EUR (default): euro sign output
  check('EUR is the default native currency', cur.native() === 'EUR');
  check('EUR amounts keep the euro sign', cur.fmt(120) === '€120' && cur.fmt(12.5) === '€12.50' && cur.fmtSigned(-5) === '−€5' && cur.fmtSigned(5) === '+€5');
  check('catalog text is unchanged for EUR', cur.localizeText('€{price} / room · {pp} €') === '€{price} / room · {pp} €');

  // another native currency
  CONFIG.CURRENCY = 'SEK'; CONFIG.CURRENCIES = 'usd, eur ,SEK,bad1';
  check('native currency from config', cur.native() === 'SEK');
  check('extra currencies are normalised, de-duplicated and exclude the native one', JSON.stringify(cur.extras()) === '["USD","EUR"]', cur.extras());
  check('non-EUR amounts use the ISO code', cur.fmt(1200) === '1200' + NB + 'SEK' && cur.fmtSigned(-30) === '−30' + NB + 'SEK');
  check('euro sign in texts is replaced (prefix and suffix forms)', cur.localizeText('€{price} / room · {pp} € · €') === '{price}' + NB + 'SEK / room · {pp}' + NB + 'SEK · SEK', cur.localizeText('€{price} / room · {pp} € · €'));
  check('zero-decimal currencies', cur.digits('ISK') === 0 && cur.digits('JPY') === 0 && cur.digits('USD') === 2);

  // rates: stored per native currency; a rate saved for another native currency is not used
  check('no rate yet: nothing offered to guests', cur.usable().length === 0 && cur.convert(100, 'USD') === null && cur.pickDisplay('USD').code === '');
  let r = await cur.saveRates([{ code: 'USD', rate: '0,0935', manual: true }]);
  check('save rate (comma decimal)', r.success && r.rates.find(x => x.code === 'USD'), r);
  const ins = queries.filter(q => /INSERT INTO currency_rates/.test(q.sql)).pop();
  check('rate row written with the native currency as base', ins && ins.params[0] === 'USD' && ins.params[1] === 0.0935 && ins.params[3] === 'SEK', ins);
  r = await cur.saveRates([{ code: 'GBP', rate: '1' }]);
  check('rate for a currency that is not enabled is rejected', !r.success, r);
  r = await cur.saveRates([{ code: 'USD', rate: 'abc' }]);
  check('invalid rate is rejected', !r.success, r);
  r = await cur.saveRates([{ code: 'USD', rate: '-1' }]);
  check('negative rate is rejected', !r.success, r);

  // pickDisplay / convert need loaded rates: load them from a stubbed table
  require('../src/db').query = async () => ({ rows: [{ code: 'USD', rate: '0.0935', manual: true, base: 'SEK', updated_at: new Date() }, { code: 'EUR', rate: '0.087', manual: false, base: 'EUR', updated_at: new Date() }] });
  await cur.load();
  check('rate usable for current native currency', cur.rateFor('USD') === 0.0935);
  check('rate saved for another native currency is ignored', cur.rateFor('EUR') === null);
  check('usable() lists only currencies with a current rate', JSON.stringify(cur.usable()) === '["USD"]', cur.usable());
  check('guest display currency: valid', cur.pickDisplay('usd').code === 'USD' && cur.pickDisplay('usd').rate === 0.0935);
  check('guest display currency: unknown, native and empty are ignored', ['GBP', 'SEK', '', null, 'x'].every(c => cur.pickDisplay(c).code === ''));
  check('approximate amount', cur.fmtApprox(1000, 'USD') === '93.5' + NB + 'USD', cur.fmtApprox(1000, 'USD'));
  check('approximate amount with a stored rate', cur.fmtApproxWith(2000, 0.0935, 'USD') === '187' + NB + 'USD', cur.fmtApproxWith(2000, 0.0935, 'USD'));
  check('public info for the booking page', cur.publicInfo().native === 'SEK' && cur.publicInfo().extras.length === 1 && cur.publicInfo().extras[0].code === 'USD');

  // ECB
  const xml = `<gesmes:Envelope><Cube><Cube time='2026-11-16'><Cube currency='USD' rate='1.0800'/><Cube currency='SEK' rate='11.5000'/><Cube currency='ISK' rate='150.0'/></Cube></Cube></gesmes:Envelope>`;
  const p = cur.parseEcb(xml);
  check('ECB xml is parsed', p.date === '2026-11-16' && p.rates.USD === 1.08 && p.rates.EUR === 1, p);
  const x = cur.crossRates(p.rates, 'SEK', ['USD', 'EUR', 'XXX']);
  check('cross rates are computed against the native currency', Math.abs(x.USD - 1.08 / 11.5) < 1e-9 && Math.abs(x.EUR - 1 / 11.5) < 1e-9 && x.XXX === undefined, x);

  queries.length = 0;
  require('../src/db').query = async (sql, params) => { queries.push({ sql, params }); return { rows: [{ code: 'USD', rate: '0.0935', manual: true, base: 'SEK', updated_at: new Date() }] }; };
  await cur.load();
  r = await cur.fetchEcb(async () => ({ ok: true, text: async () => xml }));
  check('ECB fetch updates non-manual rates, keeps manual ones, reports unpublished', r.success && r.updated.join() === 'EUR' && r.keptManual.join() === 'USD' && r.ecbDate === '2026-11-16', r);
  const w = queries.filter(q => /INSERT INTO currency_rates/.test(q.sql));
  check('only the non-manual rate was written', w.length === 1 && w[0].params[0] === 'EUR' && Math.abs(w[0].params[1] - 1 / 11.5) < 1e-9, w);
  r = await cur.fetchEcb(async () => { throw new Error('offline'); });
  check('ECB failure is reported, not thrown', !r.success && /offline/.test(r.error), r);
  CONFIG.CURRENCY = 'XXX';
  r = await cur.fetchEcb(async () => ({ ok: true, text: async () => xml }));
  check('native currency the ECB does not publish gives a clear error', !r.success && /XXX/.test(r.error), r);

  console.log(failed ? failed + ' FAILED' : 'All checks passed');
  process.exit(failed ? 1 : 0);
})();
