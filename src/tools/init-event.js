'use strict';
// One-shot setup of a new instance: applies the database schema and stores the event details.
//   DATABASE_URL=postgres://... node src/tools/init-event.js '{"EVENT_NAME":"...","EVENT_SHORT":"...","ORGANIZER":"..."}'
//   echo '{...}' | node src/tools/init-event.js
// Used by the hosting platform (platform/) to pre-fill a new event before the app starts. The values go through the same
// validation as the Event setup page. Refuses to overwrite an existing event unless --force is given.
// Prints one JSON line ({"success":true} or {"success":false,"error":"..."}) and exits 0 on success, 1 otherwise.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const eventConfig = require('../eventConfig');

function readInput() {
  const arg = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (arg) return Promise.resolve(arg);
  return new Promise((resolve, reject) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { s += c; });
    process.stdin.on('end', () => resolve(s));
    process.stdin.on('error', reject);
  });
}

(async () => {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    let input;
    try { input = JSON.parse(await readInput()); } catch (_) { throw new Error('The event details must be given as a JSON object'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The event details must be given as a JSON object');
    await db.query(fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8'));
    const already = await eventConfig.load();
    if (already && !process.argv.includes('--force')) throw new Error('This instance already has an event (use --force to overwrite it)');
    const r = await eventConfig.save(Object.assign({}, eventConfig.current(), input));
    if (!r.success) throw new Error(r.error);
    console.log(JSON.stringify({ success: true }));
    process.exit(0);
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: e.message }));
    process.exit(1);
  }
})();
