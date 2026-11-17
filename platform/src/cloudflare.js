'use strict';
// Cloudflare for SaaS (custom hostnames) over the REST API, no SDK. Lets a customer's own subdomain point at their instance:
// the customer adds a CNAME to config.customDomainTarget, Cloudflare validates the hostname and issues the certificate.
const config = require('./config');
const API = 'https://api.cloudflare.com/client/v4';

const enabled = () => !!(config.cfApiToken && config.cfZoneId);

async function call(method, path, body, fetchImpl = fetch) {
  if (!enabled()) throw new Error('Cloudflare is not configured (CF_API_TOKEN, CF_ZONE_ID)');
  const res = await fetchImpl(`${API}/zones/${config.cfZoneId}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.cfApiToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  let json = {};
  try { json = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok || json.success === false) {
    const e = new Error('Cloudflare: ' + ((json.errors && json.errors[0] && json.errors[0].message) || res.status));
    e.status = res.status; e.code = json.errors && json.errors[0] && json.errors[0].code;
    throw e;
  }
  return json.result;
}

// Reduces the API object to what the platform needs.
function normalize(r) {
  const ssl = r.ssl || {};
  const errors = [].concat(r.verification_errors || [], (ssl.validation_errors || []).map(e => e.message || String(e)));
  const timedOut = /timed_out/.test(ssl.status || '');
  const dead = ['blocked', 'deleted', 'pending_deletion', 'moved'].includes(r.status);
  return {
    id: r.id, hostname: r.hostname, status: r.status, sslStatus: ssl.status,
    active: r.status === 'active' && ssl.status === 'active',
    failed: timedOut || dead,
    ownership: r.ownership_verification && r.ownership_verification.name ? { name: r.ownership_verification.name, value: r.ownership_verification.value } : null,
    errors
  };
}

// HTTP validation: once the customer's CNAME points at us, Cloudflare answers the certificate challenge itself.
async function createCustomHostname(hostname, fetchImpl) {
  try {
    return normalize(await call('POST', '/custom_hostnames', { hostname, ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } }, fetchImpl));
  } catch (e) {
    if (e.code !== 1406) throw e;       // 1406 = hostname already exists (for example a retry): reuse it
    const list = await call('GET', `/custom_hostnames?hostname=${encodeURIComponent(hostname)}`, null, fetchImpl);
    if (!list || !list.length) throw e;
    return normalize(list[0]);
  }
}
async function getCustomHostname(id, fetchImpl) { return normalize(await call('GET', `/custom_hostnames/${encodeURIComponent(id)}`, null, fetchImpl)); }
async function deleteCustomHostname(id, fetchImpl) {
  try { await call('DELETE', `/custom_hostnames/${encodeURIComponent(id)}`, null, fetchImpl); }
  catch (e) { if (e.status !== 404) throw e; }            // already gone is fine
}

module.exports = { enabled, createCustomHostname, getCustomHostname, deleteCustomHostname, normalize };
