'use strict';
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');
const domains = require('./domains');

const rand = n => crypto.randomBytes(n).toString('base64url');
const containerName = slug => `ebs-${slug}`;
const hostOf = slug => `${slug}.${config.baseDomain}`;

function create(deps) {
  const runner = deps.runner, tenantDb = deps.tenantDb, cf = deps.cloudflare || require('./cloudflare');

  // Provisions an instance for a paid (or free) order. Safe to retry: it cleans up a half-built tenant first.
  async function provision(order) {
    const slug = order.slug, name = containerName(slug);
    await db.log(order.id, `provisioning ${slug}`);
    try {
      await runner.remove(name); await tenantDb.drop(slug);       // clean any partial earlier attempt
      const dbPass = rand(24);
      const databaseUrl = await tenantDb.create(slug, dbPass);
      const adminPw = rand(12), setupPw = rand(12);
      // With an own domain the instance's canonical address (join links in emails) is that domain; it also keeps answering at the normal one.
      const own = order.custom_domain && cf.enabled() ? order.custom_domain : null;
      const env = { DATABASE_URL: databaseUrl, PUBLIC_URL: `https://${own || hostOf(slug)}`, ADMIN_PASSWORD: adminPw, SETUP_PASSWORD: setupPw, SESSION_SECRET: rand(32), NODE_ENV: 'production' };
      if (process.env.SMTP_HOST) Object.assign(env, { SMTP_HOST: process.env.SMTP_HOST, SMTP_PORT: process.env.SMTP_PORT, SMTP_USER: process.env.SMTP_USER, SMTP_PASS: process.env.SMTP_PASS, SMTP_FROM: process.env.SMTP_FROM });
      await runner.pull();
      const out = await runner.initEvent(name, env, JSON.stringify({ EVENT_NAME: order.event_name, EVENT_SHORT: order.event_short, ORGANIZER: order.organizer, EVENT_MODE: order.event_mode === 'day' ? 'day' : 'overnight' }));
      if (!/"success":\s*true/.test(out)) throw new Error('init failed: ' + out);
      const r = `ebs-${slug}`;
      await runner.start(name, env, {
        'traefik.enable': 'true',
        [`traefik.http.routers.${r}.rule`]: own ? `Host(\`${hostOf(slug)}\`) || Host(\`${own}\`)` : `Host(\`${hostOf(slug)}\`)`,
        [`traefik.http.routers.${r}.entrypoints`]: 'web',
        [`traefik.http.services.${r}.loadbalancer.server.port`]: '3000'
      });
      const end = order.event_end ? new Date(order.event_end) : null;
      const eraseAfter = end ? new Date(end.getTime() + config.retentionDays * 86400000) : null;
      await db.query(`INSERT INTO tenants (order_id, slug, expires_at, erase_after, custom_domain) VALUES ($1,$2,$3,$4,$5)
                      ON CONFLICT (slug) DO UPDATE SET order_id=$1, state='active', expires_at=$3, erase_after=$4, warned_at=NULL, custom_domain=$5`, [order.id, slug, end, eraseAfter, own]);
      await db.query("UPDATE orders SET status='active' WHERE id=$1", [order.id]);
      const dom = await domains.attach(order, cf);     // never throws; the instance already works at its normal address
      await mailer.send(order.contact_email, `Your event system is ready: ${order.event_name}`,
        `Hello ${order.contact_name},\n\nYour booking system is ready at https://${hostOf(slug)}\n\n` +
        `Setup page (event details, prices, rooms): https://${hostOf(slug)}/?setup=1\nSetup password: ${setupPw}\n\n` +
        `Booking admin page: https://${hostOf(slug)}/?admin=1\nAdmin password: ${adminPw}\n\n` +
        (dom.text ? `Your own address: https://${order.custom_domain}\n\n${dom.text}\n` : '') +
        `Please change nothing about the passwords by email; keep this message safe. The system is kept until ${end ? end.toISOString().slice(0, 10) : 'the event ends'} and its data is erased ${config.retentionDays} days after the event.\n`);
      await db.log(order.id, `provisioned ${slug}`);
    } catch (e) {
      await db.query("UPDATE orders SET status='failed' WHERE id=$1", [order.id]);
      await db.log(order.id, `provisioning failed: ${e.message}`);
      if (config.operatorEmail) await mailer.send(config.operatorEmail, `Provisioning failed: ${slug}`, e.message);
      throw e;
    }
  }
  async function suspend(slug) { await runner.stop(containerName(slug)); await db.query("UPDATE tenants SET state='suspended' WHERE slug=$1", [slug]); await db.log(null, `suspended ${slug}`); }
  async function resume(slug) { await runner.resume(containerName(slug)); await db.query("UPDATE tenants SET state='active' WHERE slug=$1", [slug]); await db.log(null, `resumed ${slug}`); }
  async function erase(slug) {
    // The custom hostname counts against the Cloudflare quota until it is deleted
    await domains.detach(slug, cf).catch(async e => {
      await db.log(null, `could not remove custom hostname of ${slug}: ${e.message}`);
      if (config.operatorEmail) await mailer.send(config.operatorEmail, `Remove custom hostname by hand: ${slug}`, e.message).catch(() => {});
    });
    await runner.remove(containerName(slug)); await tenantDb.drop(slug);
    await db.query("UPDATE tenants SET state='erased' WHERE slug=$1", [slug]);
    await db.query("UPDATE orders SET status='cancelled' WHERE slug=$1 AND status='active'", [slug]);
    await db.log(null, `erased ${slug}`);
  }
  const pollDomains = () => domains.poll(cf);
  const checkDomain = slug => domains.pollOne(slug, cf);
  // Operator retry: forget the old hostname, register it again and send the customer the DNS instructions.
  async function retryDomain(slug) {
    const order = (await db.query("SELECT * FROM orders WHERE slug=$1 AND status='active' AND custom_domain IS NOT NULL", [slug])).rows[0];
    if (!order) return null;
    await domains.detach(slug, cf).catch(() => {});
    const dom = await domains.attach(order, cf);
    if (dom.status === 'pending') await mailer.send(order.contact_email, `DNS settings for your own address: ${order.custom_domain}`, `Hello ${order.contact_name},\n\n${dom.text}`).catch(() => {});
    return dom.status;
  }
  return { provision, suspend, resume, erase, pollDomains, checkDomain, retryDomain };
}
module.exports = { create, hostOf, containerName };
