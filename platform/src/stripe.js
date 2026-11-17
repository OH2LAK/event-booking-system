'use strict';
// Minimal Stripe client using the REST API directly (no SDK dependency).
const crypto = require('crypto');
const config = require('./config');

function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out;
}

// Creates a one-time Checkout Session for an approved order and returns { id, url }.
async function createCheckoutSession(order, fetchImpl = fetch) {
  const body = {
    mode: 'payment',
    client_reference_id: String(order.id),
    customer_email: order.contact_email,
    success_url: `${config.publicUrl}/paid?order=${order.id}`,
    cancel_url: `${config.publicUrl}/cancelled?order=${order.id}`,
    metadata: { order_id: order.id, slug: order.slug },
    line_items: { 0: { quantity: 1, price_data: {
      currency: order.currency, unit_amount: order.price_cents,
      product_data: { name: `${config.productName}: ${order.event_name}`, description: `${order.slug}.${config.baseDomain}` }
    } } },
    invoice_creation: { enabled: true },
    automatic_tax: config.stripeAutomaticTax ? { enabled: true } : undefined
  };
  const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `order-${order.id}-${order.price_cents}` },
    body: form(body).join('&')
  });
  const json = await res.json();
  if (!res.ok) throw new Error('Stripe: ' + ((json.error && json.error.message) || res.status));
  return { id: json.id, url: json.url };
}

// Verifies the Stripe-Signature header against the raw request body. Throws if invalid.
function verifyWebhook(rawBody, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!secret) throw new Error('Webhook secret not configured');
  const parts = {};
  String(header || '').split(',').forEach(p => { const i = p.indexOf('='); if (i > 0) (parts[p.slice(0, i)] = parts[p.slice(0, i)] || []).push(p.slice(i + 1)); });
  const t = parts.t && parts.t[0];
  if (!t || !parts.v1) throw new Error('Malformed signature header');
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) throw new Error('Signature timestamp outside tolerance');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const ok = parts.v1.some(sig => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
  if (!ok) throw new Error('Signature mismatch');
  return JSON.parse(rawBody);
}
module.exports = { createCheckoutSession, verifyWebhook, form };
