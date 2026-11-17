'use strict';
// Periodic job: warn before the event ends, suspend after it, erase data after the retention period.
const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');

async function tick(prov, now = new Date()) {
  const warnBefore = new Date(now.getTime() + config.warnDays * 86400000);
  const warn = await db.query(`SELECT t.slug, o.contact_email, o.event_name, t.erase_after FROM tenants t JOIN orders o ON o.id=t.order_id
    WHERE t.state IN ('active','suspended') AND t.warned_at IS NULL AND t.erase_after IS NOT NULL AND t.erase_after <= $1`, [warnBefore]);
  for (const r of warn.rows) {
    await mailer.send(r.contact_email, `Your event data will be erased soon: ${r.event_name}`,
      `The data of ${r.event_name} (${r.slug}) will be permanently erased on ${r.erase_after.toISOString().slice(0, 10)}. Download any reports you need before that.\n`);
    await db.query('UPDATE tenants SET warned_at=$2 WHERE slug=$1', [r.slug, now]);
  }
  const susp = await db.query("SELECT slug FROM tenants WHERE state='active' AND expires_at IS NOT NULL AND expires_at < $1", [now]);
  for (const r of susp.rows) await prov.suspend(r.slug);
  const del = await db.query("SELECT slug FROM tenants WHERE state<>'erased' AND erase_after IS NOT NULL AND erase_after < $1", [now]);
  for (const r of del.rows) await prov.erase(r.slug);
  return { warned: warn.rowCount, suspended: susp.rowCount, erased: del.rowCount };
}
function start(prov) {
  const run = () => tick(prov).catch(e => console.error('lifecycle:', e.message)); setInterval(run, 3600000); setTimeout(run, 30000);
  // own domains waiting for DNS/certificate: check every 10 minutes
  if (prov.pollDomains) setInterval(() => prov.pollDomains().catch(e => console.error('domains:', e.message)), 600000);
}
module.exports = { tick, start };
