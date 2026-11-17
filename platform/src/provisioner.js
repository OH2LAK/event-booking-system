'use strict';
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');

const rand = n => crypto.randomBytes(n).toString('base64url');
const containerName = slug => `ebs-${slug}`;
const hostOf = slug => `${slug}.${config.baseDomain}`;

function create(deps) {
  const runner = deps.runner, tenantDb = deps.tenantDb;

  // Provisions an instance for a paid (or free) order. Safe to retry: it cleans up a half-built tenant first.
  async function provision(order) {
    const slug = order.slug, name = containerName(slug);
    await db.log(order.id, `provisioning ${slug}`);
    try {
      await runner.remove(name); await tenantDb.drop(slug);       // clean any partial earlier attempt
      const dbPass = rand(24);
      const databaseUrl = await tenantDb.create(slug, dbPass);
      const adminPw = rand(12), setupPw = rand(12);
      const env = { DATABASE_URL: databaseUrl, PUBLIC_URL: `https://${hostOf(slug)}`, ADMIN_PASSWORD: adminPw, SETUP_PASSWORD: setupPw, SESSION_SECRET: rand(32), NODE_ENV: 'production' };
      if (process.env.SMTP_HOST) Object.assign(env, { SMTP_HOST: process.env.SMTP_HOST, SMTP_PORT: process.env.SMTP_PORT, SMTP_USER: process.env.SMTP_USER, SMTP_PASS: process.env.SMTP_PASS, SMTP_FROM: process.env.SMTP_FROM });
      await runner.pull();
      const out = await runner.initEvent(name, env, JSON.stringify({ EVENT_NAME: order.event_name, EVENT_SHORT: order.event_short, ORGANIZER: order.organizer }));
      if (!/"success":\s*true/.test(out)) throw new Error('init failed: ' + out);
      const r = `ebs-${slug}`;
      await runner.start(name, env, {
        'traefik.enable': 'true',
        [`traefik.http.routers.${r}.rule`]: `Host(\`${hostOf(slug)}\`)`,
        [`traefik.http.routers.${r}.entrypoints`]: 'web',
        [`traefik.http.services.${r}.loadbalancer.server.port`]: '3000'
      });
      const end = order.event_end ? new Date(order.event_end) : null;
      const eraseAfter = end ? new Date(end.getTime() + config.retentionDays * 86400000) : null;
      await db.query(`INSERT INTO tenants (order_id, slug, expires_at, erase_after) VALUES ($1,$2,$3,$4)
                      ON CONFLICT (slug) DO UPDATE SET state='active', expires_at=$3, erase_after=$4, warned_at=NULL`, [order.id, slug, end, eraseAfter]);
      await db.query("UPDATE orders SET status='active' WHERE id=$1", [order.id]);
      await mailer.send(order.contact_email, `Your event system is ready: ${order.event_name}`,
        `Hello ${order.contact_name},\n\nYour booking system is ready at https://${hostOf(slug)}\n\n` +
        `Setup page (event details, prices, rooms): https://${hostOf(slug)}/?setup=1\nSetup password: ${setupPw}\n\n` +
        `Booking admin page: https://${hostOf(slug)}/?admin=1\nAdmin password: ${adminPw}\n\n` +
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
    await runner.remove(containerName(slug)); await tenantDb.drop(slug);
    await db.query("UPDATE tenants SET state='erased' WHERE slug=$1", [slug]);
    await db.query("UPDATE orders SET status='cancelled' WHERE slug=$1 AND status='active'", [slug]);
    await db.log(null, `erased ${slug}`);
  }
  return { provision, suspend, resume, erase };
}
module.exports = { create, hostOf, containerName };
