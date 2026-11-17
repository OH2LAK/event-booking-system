'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

let pool;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: config.databaseUrl });
  return pool;
}
const query = (text, params) => getPool().query(text, params);
async function init() { await query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')); }
async function log(orderId, message) { await query('INSERT INTO event_log (order_id, message) VALUES ($1,$2)', [orderId || null, message]); }
async function close() { if (pool) { await pool.end(); pool = null; } }
module.exports = { query, init, log, close };
