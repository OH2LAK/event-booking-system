'use strict';
// Fill an EMPTY database with a fictional demo event and fake bookings (for screenshots / demos).
//   DATABASE_URL=postgres://... node src/tools/seed-demo.js [--force]
// All names are fictional, callsigns start with DEMO, emails use example.com, and no email is sent.
process.env.SMTP_HOST = '';
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { seed } = require('../demoData');

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }
  await db.query(fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8'));
  const n = (await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n;
  if (n > 0 && !process.argv.includes('--force')) {
    console.error(`Database already has ${n} booking(s). Refusing to seed (use --force to add demo rows anyway).`);
    process.exit(1);
  }
  await seed();
  console.log('Demo event and bookings created. Booking admin: /?admin=1, event setup: /?setup=1');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
