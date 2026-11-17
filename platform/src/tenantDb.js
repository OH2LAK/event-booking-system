'use strict';
// Creates and drops one database + login role per tenant on the shared Postgres.
const { Client } = require('pg');
const config = require('./config');

const SLUG = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const ident = slug => { if (!SLUG.test(slug)) throw new Error('Bad slug'); return 'ebs_' + slug.replace(/-/g, '_'); };
const lit = s => "'" + String(s).replace(/'/g, "''") + "'";

async function admin(fn) {
  const c = new Client({ connectionString: config.pgAdminUrl });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
module.exports = {
  ident,
  async create(slug, password) {
    const n = ident(slug);
    await admin(async c => {
      await c.query(`CREATE ROLE ${n} LOGIN PASSWORD ${lit(password)} CONNECTION LIMIT 10`);
      await c.query(`CREATE DATABASE ${n} OWNER ${n}`);
      await c.query(`REVOKE ALL ON DATABASE ${n} FROM PUBLIC`);
    });
    return `postgres://${n}:${encodeURIComponent(password)}@${config.tenantDbHost}:5432/${n}`;
  },
  async drop(slug) {
    const n = ident(slug);
    await admin(async c => {
      await c.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
      await c.query(`DROP ROLE IF EXISTS ${n}`);
    });
  },
  SLUG
};
