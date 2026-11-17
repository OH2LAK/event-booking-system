'use strict';
// Fill an EMPTY database with a fictional demo event and fake bookings (for screenshots / demos).
//   DATABASE_URL=postgres://... node src/tools/seed-demo.js [--force]
// All names are fictional, callsigns start with DEMO, emails use example.com, and no email is sent.
process.env.SMTP_HOST = '';
const fs = require('fs');
const path = require('path');
const db = require('../db');
const eventConfig = require('../eventConfig');
const structure = require('../structure');
const service = require('../service');

const person = (n, call, country) => ({ callsign: call, name: n, email: call.toLowerCase() + '@example.com', country, phone: '' });

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }
  await db.query(fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8'));
  const n = (await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n;
  if (n > 0 && !process.argv.includes('--force')) {
    console.error(`Database already has ${n} booking(s). Refusing to seed (use --force to add demo rows anyway).`);
    process.exit(1);
  }
  const cfg = await eventConfig.save({
    EVENT_NAME: 'Example Radio Meeting 2027', EVENT_SHORT: 'ExampleMeet', ORGANIZER: 'Example Radio Club', ORGANIZER_SHORT: 'ERC',
    LOCATION: 'Example Hotel, Sampletown', LOCATION_SHORT: 'Sampletown', DATES_TEXT: '13-16 May 2027',
    CHECKIN_TIME: 'Check-in from 15:00 on Thursday or Friday', CHECKOUT_TIME: 'Check-out by 12:00 on Sunday',
    REPLY_TO_EMAIL: 'organizer@example.com', EMAIL_SENDER_NAME: 'Example Radio Club', ACCENT_COLOR: '#0f766e',
    HOME_URL: 'https://example.com', HOME_LABEL: 'example.com',
    CONTROLLER_NAME: 'Example Radio Club', PRIVACY_CONTACT_EMAIL: 'privacy@example.com', EVENT_END_DATE: '2027-05-16', RETENTION_DAYS: '30',
  });
  if (!cfg.success) throw new Error(cfg.error);
  await structure.load();
  const st = await structure.save({
    days: [{ label: 'Friday 14 May', short: 'Fri 14.5.' }, { label: 'Saturday 15 May', short: 'Sat 15.5.' }],
    coreNights: 2,
    extraNights: [{ label: 'Thursday night (13 May)', includes: 'Includes Friday breakfast' }],
    package: { enabled: true, sub: 'Dinner Fri, lunch + dinner Sat', includes: 'Friday: dinner\nSaturday: lunch + dinner' },
  });
  if (!st.success) throw new Error(st.error);
  const [FRI, SAT] = ['d1', 'd2'];

  const book = async (p, extra) => {
    const r = await service.submitBooking({ privacyAck: true, publishConsent: true, ...p, ...extra });
    if (!r.success) throw new Error(`${p.callsign}: ${r.error}`);
    return r;
  };
  const d1 = await book(person('Alice Example', 'DEMO01', 'FI'), { type: 'room', roomId: '2S', fullBoard: true });
  await book(person('Bob Sample', 'DEMO02', 'SE'), { type: 'room', joinExisting: true, roomRef: d1.bookingRef, fullBoard: true });
  const d2 = await book(person('Carol Test', 'DEMO03', 'NO'), { type: 'room', roomId: '3S', extraNights: ['x1'] });
  await book(person('Dan Demo', 'DEMO04', 'DK'), { type: 'room', joinExisting: true, roomRef: d2.bookingRef });
  await book(person('Eve Mock', 'DEMO05', 'FI'), { type: 'room', roomId: '1S-W', fullBoard: true });
  await book(person('Frank Fake', 'DEMO06', 'EE'), { type: 'room', roomId: '4S' });
  await book(person('Grace Placeholder', 'DEMO07', 'FI'), { type: 'camper' });
  await book(person('Heidi Sample', 'DEMO08', 'SE'), { type: 'tent' });
  await book(person('Ivan Example', 'DEMO09', 'LV'), { type: 'dayvisitor', visitorDays: [FRI] });
  await book(person('Judy Demo', 'DEMO10', 'FI'), { type: 'dayvisitor', visitorDays: [FRI, SAT], fullBoard: true });
  const k = await book(person('Karl Mock', 'DEMO11', 'DE'), { type: 'room', roomId: '2S' });
  await service.updateBooking(d1.bookingRef, { RoomNumber: '101', Status: 'CHECKED_IN' }, false);
  await service.updateBooking(d2.bookingRef, { RoomNumber: '102' }, false);
  await service.updateBooking(k.bookingRef, { Status: 'CANCELLED' }, false);
  console.log('Demo event and bookings created. Booking admin: /?admin=1, event setup: /?setup=1');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
