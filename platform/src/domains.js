'use strict';
// Customer's own domain for an instance: validation of the name, registering it with Cloudflare, status polling, removal.
const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');

const LABEL = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_RE = new RegExp(`^(${LABEL}\\.){2,}([a-z]{2,63}|xn--[a-z0-9-]{1,59})$`);

// Lowercases and strips what people paste (protocol, path, trailing dot). Returns '' for empty input.
function normalize(input) {
  return String(input || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[\/?#].*$/, '').replace(/\.$/, '');
}
// Subdomains only (at least three labels, e.g. ilmo.yourclub.fi): a CNAME cannot be set on a bare domain.
function validate(domain) {
  if (domain.length > 253 || !DOMAIN_RE.test(domain)) return 'Enter your own subdomain such as ilmo.yourclub.fi (not a bare domain, no http://).';
  if (domain === config.baseDomain || domain.endsWith('.' + config.baseDomain)) return `Use a domain that is not under ${config.baseDomain}.`;
  return null;
}

// What the customer has to do at their DNS provider.
function instructions(domain, h) {
  const first = domain.split('.')[0];
  let t = `Add this record at your DNS provider (where your domain ${domain.split('.').slice(1).join('.')} is managed):\n\n` +
    `  Type:   CNAME\n  Name:   ${domain}   (some providers want only "${first}")\n  Target: ${config.customDomainTarget}\n\n` +
    `If a record with that name already exists, replace it. If your DNS is on Cloudflare, set the record to "DNS only". ` +
    `The certificate is issued automatically a few minutes after the record is visible; we email you when the address works.\n`;
  if (h && h.ownership) t += `\nIf it still is not active after an hour, also add this TXT record:\n  Name:  ${h.ownership.name}\n  Value: ${h.ownership.value}\n`;
  return t;
}
const note = h => h.active ? 'active' : [h.status, h.sslStatus].filter(Boolean).join(' / ') + (h.errors.length ? ': ' + h.errors.join('; ') : '');

// Registers the hostname for an instance. Never throws: the instance works at its normal address even if this fails.
// Returns { status, text } where text is the DNS instruction block for the customer email ('' if no domain was ordered).
async function attach(order, cf) {
  if (!order.custom_domain) return { status: 'none', text: '' };
  try {
    if (!cf.enabled()) throw new Error('Cloudflare is not configured on the platform');
    const h = await cf.createCustomHostname(order.custom_domain);
    const status = h.active ? 'active' : h.failed ? 'failed' : 'pending';
    await db.query(`UPDATE tenants SET custom_domain=$2, cf_hostname_id=$3, domain_status=$4, domain_note=$5, domain_checked_at=now() WHERE slug=$1`,
      [order.slug, order.custom_domain, h.id, status, note(h)]);
    await db.log(order.id, `custom domain ${order.custom_domain}: ${status}`);
    return { status, text: instructions(order.custom_domain, h) };
  } catch (e) {
    await db.query(`UPDATE tenants SET custom_domain=$2, domain_status='failed', domain_note=$3, domain_checked_at=now() WHERE slug=$1`, [order.slug, order.custom_domain, e.message.slice(0, 300)]);
    await db.log(order.id, `custom domain ${order.custom_domain} failed: ${e.message}`);
    if (config.operatorEmail) await mailer.send(config.operatorEmail, `Custom domain failed: ${order.slug}`, `${order.custom_domain}\n${e.message}\nRetry from ${config.publicUrl}/operator`).catch(() => {});
    return { status: 'failed', text: `Your own domain ${order.custom_domain} could not be set up automatically. We will contact you. Your system works at its normal address meanwhile.\n` };
  }
}

async function checkOne(row, cf) {
  const h = await cf.getCustomHostname(row.cf_hostname_id);
  const status = h.active ? 'active' : h.failed ? 'failed' : 'pending';
  await db.query('UPDATE tenants SET domain_status=$2, domain_note=$3, domain_checked_at=now() WHERE slug=$1', [row.slug, status, note(h)]);
  if (status !== row.domain_status) {
    await db.log(row.order_id, `custom domain ${row.custom_domain}: ${status}`);
    if (status === 'active') await mailer.send(row.contact_email, `Your own address is working: ${row.custom_domain}`,
      `Hello ${row.contact_name},\n\nYour booking system now answers at https://${row.custom_domain}\n\nThe setup page is https://${row.custom_domain}/?setup=1 and the booking admin page https://${row.custom_domain}/?admin=1. Your earlier address keeps working too.\n`).catch(() => {});
    if (status === 'failed' && config.operatorEmail) await mailer.send(config.operatorEmail, `Custom domain failed: ${row.slug}`, `${row.custom_domain}\n${note(h)}\nCheck it in ${config.publicUrl}/operator`).catch(() => {});
  }
  return status;
}

// Checks every domain still waiting for DNS/certificate. Called every few minutes.
async function poll(cf) {
  if (!cf.enabled()) return 0;
  const rows = (await db.query(`SELECT t.slug, t.custom_domain, t.cf_hostname_id, t.domain_status, o.id AS order_id, o.contact_email, o.contact_name
    FROM tenants t JOIN orders o ON o.id=t.order_id WHERE t.domain_status='pending' AND t.cf_hostname_id IS NOT NULL AND t.state<>'erased'`)).rows;
  for (const r of rows) await checkOne(r, cf).catch(e => db.log(r.order_id, `domain check failed: ${e.message}`));
  return rows.length;
}
async function pollOne(slug, cf) {
  const r = (await db.query(`SELECT t.slug, t.custom_domain, t.cf_hostname_id, t.domain_status, o.id AS order_id, o.contact_email, o.contact_name
    FROM tenants t JOIN orders o ON o.id=t.order_id WHERE t.slug=$1 AND t.cf_hostname_id IS NOT NULL`, [slug])).rows[0];
  return r && cf.enabled() ? checkOne(r, cf) : null;
}

// Removes the hostname from Cloudflare (it counts against the quota until deleted).
async function detach(slug, cf) {
  const r = (await db.query('SELECT cf_hostname_id FROM tenants WHERE slug=$1', [slug])).rows[0];
  if (r && r.cf_hostname_id && cf.enabled()) await cf.deleteCustomHostname(r.cf_hostname_id);
  await db.query("UPDATE tenants SET cf_hostname_id=NULL, domain_status='none' WHERE slug=$1", [slug]);
}

module.exports = { normalize, validate, instructions, attach, poll, pollOne, detach, DOMAIN_RE };
