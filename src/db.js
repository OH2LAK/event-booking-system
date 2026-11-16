'use strict';
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const query = (text, params) => pool.query(text, params);

// Run fn(client) inside a transaction. Booking writes take a global advisory lock so that
// concurrent submissions cannot overbook rooms or generate duplicate booking references.
async function withBookingLock(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(2026051501)');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function logEvent(level, event, callsign, detail) {
  try {
    await pool.query(
      'INSERT INTO event_log (level, event, callsign, detail) VALUES ($1,$2,$3,$4)',
      [level, event, callsign || '', detail || '']
    );
  } catch (_) { /* never let logging break the main flow */ }
}

module.exports = { pool, query, withBookingLock, logEvent };
