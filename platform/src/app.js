'use strict';
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const db = require('./db');
const stripe = require('./stripe');
const mailer = require('./mailer');
const { SLUG } = require('./tenantDb');
const domains = require('./domains');

const RESERVED = new Set(['www', 'platform', 'api', 'admin', 'mail', 'demo', 'app', 'static', 'status', 'smtp', 'ftp', 'ns1', 'ns2', 'traefik', 'setup', 'staging', 'test']);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function build(deps) {
  const prov = deps.provisioner, stripeApi = deps.stripe || stripe, cf = deps.cloudflare || require('./cloudflare');
  const app = express();
  app.disable('x-powered-by');

  // Stripe webhook needs the raw body, so it is registered before the JSON parsers.
  app.post('/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    let ev;
    try { ev = stripeApi.verifyWebhook(req.body.toString('utf8'), req.get('Stripe-Signature'), config.stripeWebhookSecret); }
    catch (e) { return res.status(400).send('bad signature'); }
    try {
      const fresh = await db.query('INSERT INTO stripe_events (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id', [ev.id]);
      if (!fresh.rowCount) return res.send('duplicate');
      if (ev.type === 'checkout.session.completed' && ev.data.object.payment_status === 'paid') {
        const s = ev.data.object;
        const r = await db.query("UPDATE orders SET status='paid', paid_at=now() WHERE stripe_session_id=$1 AND status='approved' RETURNING *", [s.id]);
        if (r.rowCount) { await db.log(r.rows[0].id, 'payment received'); await prov.provision(r.rows[0]).catch(() => {}); }
      }
      res.send('ok');
    } catch (e) { console.error('webhook:', e.message); await db.query('DELETE FROM stripe_events WHERE id=$1', [ev.id]).catch(() => {}); res.status(500).send('error'); }
  });

  app.use(express.json({ limit: '20kb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));

  // ---- public order request ----
  const hits = new Map();
  app.use('/api', (req, res, next) => {
    const o = req.get('Origin');
    if (o && config.allowedOrigins.includes(o)) { res.set('Access-Control-Allow-Origin', o); res.set('Vary', 'Origin'); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.set('Access-Control-Allow-Methods', 'POST'); }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.post('/api/order', async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });                      // honeypot: pretend success
    const ip = req.get('CF-Connecting-IP') || req.ip, now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < 3600000);
    if (recent.length >= 5) return res.status(429).json({ ok: false, error: 'Too many requests, try again later.' });
    recent.push(now); hits.set(ip, recent);
    const t = k => String(b[k] || '').trim();
    const slug = t('slug').toLowerCase();
    const domain = domains.normalize(b.custom_domain);
    const err = !SLUG.test(slug) ? 'Address must be 3-32 characters: letters, digits, hyphens.' : RESERVED.has(slug) ? 'That address is reserved.'
      : !t('event_name') || !t('event_short') || !t('organizer') || !t('contact_name') ? 'Please fill in all required fields.'
      : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t('contact_email')) ? 'Invalid email address.'
      : t('event_end') && !/^\d{4}-\d{2}-\d{2}$/.test(t('event_end')) ? 'Invalid event end date.'
      : t('event_mode') && !['overnight', 'day', 'hamfest'].includes(t('event_mode')) ? 'Invalid event type.'
      : domain && !cf.enabled() ? 'Own domains are not available yet. Leave the domain field empty or contact us.'
      : domain && domains.validate(domain) ? domains.validate(domain)
      : t('event_name').length > 120 || t('notes').length > 2000 ? 'Text too long.' : null;
    if (err) return res.status(400).json({ ok: false, error: err });
    try {
      const r = await db.query(`INSERT INTO orders (slug,event_name,event_short,organizer,contact_name,contact_email,event_end,notes,event_mode,custom_domain)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [slug, t('event_name'), t('event_short').slice(0, 20), t('organizer'), t('contact_name'), t('contact_email'), t('event_end') || null, t('notes') || null, t('event_mode') || 'overnight', domain || null]);
      await db.log(r.rows[0].id, `order requested: ${slug}`);
      if (config.operatorEmail) await mailer.send(config.operatorEmail, `New hosting order: ${slug}`, `${t('event_name')} by ${t('organizer')}\n${t('contact_email')}${domain ? '\nOwn domain: ' + domain : ''}\n${config.publicUrl}/operator`).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ ok: false, error: e.constraint === 'orders_live_domain' ? 'That domain is already in use.' : 'That address is already taken.' });
      console.error('order:', e.message); res.status(500).json({ ok: false, error: 'Server error.' });
    }
  });
  app.get('/paid', (req, res) => res.send('<!doctype html><meta charset=utf-8><title>Thank you</title><p>Thank you! Your system is being set up; login details arrive by email within a few minutes.'));
  app.get('/cancelled', (req, res) => res.send('<!doctype html><meta charset=utf-8><title>Cancelled</title><p>Payment cancelled. You can use the payment link in your email again.'));
  app.get('/healthz', (req, res) => res.send('ok'));

  // ---- operator UI ----
  const sign = exp => exp + '.' + crypto.createHmac('sha256', config.sessionSecret).update('op.' + exp).digest('hex');
  const authed = req => { const m = /(?:^|;\s*)op=([^;]+)/.exec(req.get('Cookie') || ''); if (!m) return false; const [exp, mac] = decodeURIComponent(m[1]).split('.'); return Number(exp) > Date.now() && eq(sign(exp), exp + '.' + mac); };
  const guard = (req, res, next) => authed(req) ? next() : res.redirect('/operator/login');
  const csrf = req => (req.get('Origin') || req.get('Referer') || '').startsWith(config.publicUrl);
  const post = (path, fn) => app.post(path, guard, (req, res, next) => csrf(req) ? Promise.resolve(fn(req, res)).catch(next) : res.status(403).send('bad origin'));
  const page = body => `<!doctype html><meta charset=utf-8><meta name=robots content=noindex><title>Operator</title><style>body{font:15px system-ui;margin:2rem;max-width:1000px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.4rem;text-align:left;vertical-align:top}form{display:inline}</style>${body}`;

  app.get('/operator/login', (req, res) => res.send(page('<h1>Operator login</h1><form method=post action=/operator/login><input type=password name=password autofocus> <button>Log in</button></form>')));
  app.post('/operator/login', (req, res) => {
    if (!config.operatorPassword || !eq(req.body.password || '', config.operatorPassword)) return res.status(401).send(page('<p>Wrong password. <a href=/operator/login>Back</a>'));
    const exp = Date.now() + 8 * 3600000;
    res.set('Set-Cookie', `op=${encodeURIComponent(sign(exp))}; HttpOnly; Secure; SameSite=Strict; Path=/operator; Max-Age=28800`);
    res.redirect('/operator');
  });
  app.get('/operator', guard, async (req, res) => {
    const o = (await db.query('SELECT o.*, t.state AS tenant_state, t.erase_after, t.domain_status, t.domain_note FROM orders o LEFT JOIN tenants t ON t.order_id=o.id ORDER BY o.id DESC LIMIT 200')).rows;
    const btn = (path, id, label, extra = '') => `<form method=post action=${path}><input type=hidden name=id value=${id}>${extra}<button>${label}</button></form>`;
    const rows = o.map(r => `<tr><td>${r.id}</td><td>${esc(r.status)}${r.tenant_state ? ' / ' + esc(r.tenant_state) : ''}</td><td><b>${esc(r.slug)}</b><br>${esc(r.event_name)}<br>${esc(r.organizer)}${r.custom_domain ? `<br>own domain: <b>${esc(r.custom_domain)}</b>${r.domain_status && r.domain_status !== 'none' ? ' (' + esc(r.domain_status) + (r.domain_note && r.domain_status !== 'active' ? ': ' + esc(r.domain_note) : '') + ')' : ''}` : ''}</td>
      <td>${esc(r.contact_name)}<br>${esc(r.contact_email)}<br>${r.event_mode === 'day' ? 'one-day event, ' : r.event_mode === 'hamfest' ? 'hamfest / fair, ' : ''}ends ${r.event_end ? esc(new Date(r.event_end).toISOString().slice(0, 10)) : '?'}</td><td>${esc(r.notes)}</td>
      <td>${r.status === 'requested' ? btn('/operator/approve', r.id, 'Approve', `<input name=price type=number step=0.01 min=0 placeholder="price ${config.priceCents / 100}" style="width:7em"> ` + (r.custom_domain ? `<input name=domain_fee type=number step=0.01 min=0 placeholder="domain fee ${config.customDomainFeeCents / 100}" style="width:8em"> ` : '')) + btn('/operator/reject', r.id, 'Reject') : ''}
      ${r.status === 'active' ? btn('/operator/suspend', r.id, 'Suspend') + btn('/operator/resume', r.id, 'Resume') + btn('/operator/erase', r.id, 'Erase now') + (r.custom_domain ? btn('/operator/domain-check', r.id, 'Check domain') + btn('/operator/domain-retry', r.id, 'Retry domain') : '') : ''}
      ${r.status === 'failed' ? btn('/operator/retry', r.id, 'Retry') : ''}</td></tr>`).join('');
    res.send(page(`<h1>Hosting orders</h1><table><tr><th>#</th><th>Status</th><th>Event</th><th>Contact</th><th>Notes</th><th>Actions</th></tr>${rows}</table>`));
  });
  const byId = async req => (await db.query('SELECT * FROM orders WHERE id=$1', [parseInt(req.body.id, 10)])).rows[0];
  post('/operator/approve', async (req, res) => {
    const o = await byId(req); if (!o || o.status !== 'requested') return res.redirect('/operator');
    const base = req.body.price !== '' && req.body.price !== undefined ? Math.round(parseFloat(req.body.price) * 100) : config.priceCents;
    // the own-domain fee is added to the hosting fee and shown as its own line in Stripe
    const fee = !o.custom_domain ? 0 : req.body.domain_fee !== '' && req.body.domain_fee !== undefined ? Math.round(parseFloat(req.body.domain_fee) * 100) : config.customDomainFeeCents;
    if (!(base >= 0) || !(fee >= 0)) return res.status(400).send('bad price');
    const cents = base + fee;
    await db.query("UPDATE orders SET status='approved', price_cents=$2, domain_fee_cents=$3, decided_at=now() WHERE id=$1", [o.id, cents, fee]);
    const a = { ...o, price_cents: cents, domain_fee_cents: fee, currency: config.currency };
    if (cents === 0) { await db.log(o.id, 'approved (free)'); await prov.provision(a).catch(() => {}); return res.redirect('/operator'); }
    const s = await stripeApi.createCheckoutSession(a);
    await db.query('UPDATE orders SET stripe_session_id=$2, checkout_url=$3 WHERE id=$1', [o.id, s.id, s.url]);
    await db.log(o.id, `approved, price ${cents / 100} ${config.currency}${fee ? ` incl. domain ${fee / 100}` : ''}`);
    await mailer.send(o.contact_email, `Your hosting order was approved: ${o.event_name}`, `Hello ${o.contact_name},\n\nYour order for ${o.slug}.${config.baseDomain} was approved. Price: ${(cents / 100).toFixed(2)} ${config.currency.toUpperCase()}${fee > 0 ? ` (of which ${(fee / 100).toFixed(2)} for your own domain ${o.custom_domain})` : ''}.\nPay here: ${s.url}\n\nYour system is created automatically after payment.\n`);
    res.redirect('/operator');
  });
  post('/operator/reject', async (req, res) => {
    const o = await byId(req); if (o && o.status === 'requested') { await db.query("UPDATE orders SET status='rejected', decided_at=now() WHERE id=$1", [o.id]); await mailer.send(o.contact_email, `About your hosting order: ${o.event_name}`, `Hello ${o.contact_name},\n\nUnfortunately we could not accept this order. Reply to this email for details.\n`); }
    res.redirect('/operator');
  });
  post('/operator/suspend', async (req, res) => { const o = await byId(req); if (o) await prov.suspend(o.slug); res.redirect('/operator'); });
  post('/operator/resume', async (req, res) => { const o = await byId(req); if (o) await prov.resume(o.slug); res.redirect('/operator'); });
  post('/operator/erase', async (req, res) => { const o = await byId(req); if (o) await prov.erase(o.slug); res.redirect('/operator'); });
  post('/operator/domain-check', async (req, res) => { const o = await byId(req); if (o) await prov.checkDomain(o.slug).catch(() => {}); res.redirect('/operator'); });
  post('/operator/domain-retry', async (req, res) => { const o = await byId(req); if (o) await prov.retryDomain(o.slug).catch(() => {}); res.redirect('/operator'); });
  post('/operator/retry', async (req, res) => { const o = await byId(req); if (o && o.status === 'failed') { await db.query("UPDATE orders SET status='paid' WHERE id=$1", [o.id]); await prov.provision(o).catch(() => {}); } res.redirect('/operator'); });

  app.use((err, req, res, next) => { console.error(err.message); res.status(500).send('Server error'); });
  return app;
}
module.exports = { build, RESERVED };
