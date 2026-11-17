'use strict';
// The fictional demo event and its fake bookings, used by `npm run seed-demo` and by the public demo mode (src/demo.js).
// Needs an empty database with the schema applied. All names are fictional, callsigns start with DEMO, emails use
// example.com, and no email is sent.
const eventConfig = require('./eventConfig');
const structure = require('./structure');
const currency = require('./currency');
const service = require('./service');
const addons = require('./addons');

const person = (n, call, country) => ({ callsign: call, name: n, email: call.toLowerCase() + '@example.com', country, phone: '' });

async function seed() {
  // The retention clock needs a date in the future, so a long-running demo never shows an overdue warning.
  const endDate = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
  const smtp = process.env.SMTP_HOST;
  process.env.SMTP_HOST = '';
  try {
    const cfg = await eventConfig.save({
      EVENT_NAME: 'Example Radio Meeting 2027', EVENT_SHORT: 'ExampleMeet', ORGANIZER: 'Example Radio Club', ORGANIZER_SHORT: 'ERC',
      LOCATION: 'Example Hotel, Sampletown', LOCATION_SHORT: 'Sampletown', DATES_TEXT: '13-16 May 2027',
      CHECKIN_TIME: 'Check-in from 15:00 on Thursday or Friday', CHECKOUT_TIME: 'Check-out by 12:00 on Sunday',
      REPLY_TO_EMAIL: 'organizer@example.com', EMAIL_SENDER_NAME: 'Example Radio Club', ACCENT_COLOR: '#0f766e',
      HOME_URL: 'https://example.com', HOME_LABEL: 'example.com',
      CONTROLLER_NAME: 'Example Radio Club', PRIVACY_CONTACT_EMAIL: 'privacy@example.com', EVENT_END_DATE: endDate, RETENTION_DAYS: '30',
      LANGUAGES: 'en,fi,sv,no,da,is,et,lv,lt,pl,de', DEFAULT_LANGUAGE: 'en', CURRENCY: 'EUR', CURRENCIES: 'USD,SEK,NOK,DKK,GBP',
    });
    if (!cfg.success) throw new Error(cfg.error);
    await currency.load();
    await structure.load();
    const st = await structure.save({
      days: [{ label: 'Friday 14 May', short: 'Fri 14.5.' }, { label: 'Saturday 15 May', short: 'Sat 15.5.' }],
      coreNights: 2,
      extraNights: [{ label: 'Thursday night (13 May)', includes: 'Includes Friday breakfast' }],
      package: { enabled: true, sub: 'Dinner Fri, lunch + dinner Sat', includes: 'Friday: dinner\nSaturday: lunch + dinner' },
    });
    if (!st.success) throw new Error(st.error);
    const ad = await addons.save([
      { id: 'banquet', name: 'Saturday banquet dinner', description: 'Three-course dinner with the other guests', price: 45, max_qty: 2, capacity: 60, closes: '', enabled: true },
      { id: 'tour', name: 'Sunday guided tour', description: 'Visit to the local radio museum, 2 hours', price: 15, max_qty: 4, capacity: 30, closes: '', enabled: true },
    ]);
    if (!ad.success) throw new Error(ad.error);
    // fixed example rates (manual, so the demo never needs a network connection)
    const cr = await currency.saveRates([{ code: 'USD', rate: 1.10 }, { code: 'SEK', rate: 11.1 }, { code: 'NOK', rate: 10.6 }, { code: 'DKK', rate: 7.46 }, { code: 'GBP', rate: 0.83 }]);
    if (cr && cr.success === false) throw new Error(cr.error);
    const [FRI, SAT] = ['d1', 'd2'];

    const book = async (p, extra) => {
      const r = await service.submitBooking({ privacyAck: true, publishConsent: true, ...p, ...extra });
      if (!r.success) throw new Error(`${p.callsign}: ${r.error}`);
      return r;
    };
    const d1 = await book(person('Alice Example', 'DEMO01', 'FI'), { type: 'room', roomId: '2S', fullBoard: true, addons: [{ id: 'banquet', qty: 2 }] });
    await book(person('Bob Sample', 'DEMO02', 'SE'), { type: 'room', joinExisting: true, roomRef: d1.bookingRef, fullBoard: true });
    const d2 = await book(person('Carol Test', 'DEMO03', 'NO'), { type: 'room', roomId: '3S', extraNights: ['x1'] });
    await book(person('Dan Demo', 'DEMO04', 'DK'), { type: 'room', joinExisting: true, roomRef: d2.bookingRef });
    await book(person('Eve Mock', 'DEMO05', 'FI'), { type: 'room', roomId: '1S-W', fullBoard: true });
    await book(person('Frank Fake', 'DEMO06', 'EE'), { type: 'room', roomId: '4S' });
    await book(person('Grace Placeholder', 'DEMO07', 'FI'), { type: 'camper' });
    await book(person('Heidi Sample', 'DEMO08', 'SE'), { type: 'tent', addons: [{ id: 'tour', qty: 1 }] });
    await book(person('Ivan Example', 'DEMO09', 'LV'), { type: 'dayvisitor', visitorDays: [FRI] });
    await book(person('Judy Demo', 'DEMO10', 'FI'), { type: 'dayvisitor', visitorDays: [FRI, SAT], fullBoard: true });
    const k = await book(person('Karl Mock', 'DEMO11', 'DE'), { type: 'room', roomId: '2S' });
    await service.updateBooking(d1.bookingRef, { RoomNumber: '101', Status: 'CHECKED_IN' }, false);
    await service.updateBooking(d2.bookingRef, { RoomNumber: '102' }, false);
    await service.updateBooking(k.bookingRef, { Status: 'CANCELLED' }, false);
  } finally {
    if (smtp === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = smtp;
  }
}

module.exports = { seed };
