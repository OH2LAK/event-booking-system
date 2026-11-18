'use strict';
// Data subject tools and event shutdown: per-person export (Art. 15/20), per-person erasure (Art. 17) with a final
// notice email, and "Event shutdown" which erases all personal data and verifies that it is gone.
const db = require('./db');
const { CONFIG } = require('./config');
const emails = require('./emails');
const privacy = require('./privacy');
const { setKey } = require('./settings');
const webhooks = require('./webhooks');

const CONFIRM_PHRASE = 'ERASE ALL DATA';
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Regex that matches a callsign or booking reference as a whole token inside free-text log details
const tokenRe = v => '(^|[^A-Za-z0-9/-])' + escRe(v) + '([^A-Za-z0-9/-]|$)';

async function scrubLog(client, row) {
  const parts = [row.callsign, row.booking_ref, row.email].filter(Boolean);
  const res = await client.query(
    `DELETE FROM event_log WHERE upper(callsign) = upper($1) OR detail ~* ANY($2::text[]) OR callsign ~* ANY($2::text[])`,
    [row.callsign, parts.map(tokenRe)]
  );
  return res.rowCount;
}

async function vacuum(tables) {
  try { for (const t of tables) await db.query(`VACUUM FULL ${t}`); return true; }
  catch (e) { return false; }
}

// ---- Art. 15 / 20: everything we hold about one booking, as JSON ----
async function exportBooking(ref) {
  ref = String(ref || '');
  const r = await db.query('SELECT * FROM bookings WHERE booking_ref = $1', [ref]);
  if (!r.rows.length) return { success: false, error: 'Booking not found: ' + ref };
  const row = r.rows[0];
  const parts = [row.callsign, row.booking_ref, row.email].filter(Boolean);
  const log = await db.query(
    `SELECT created_at, level, event, callsign, detail FROM event_log
      WHERE upper(callsign) = upper($1) OR detail ~* ANY($2::text[]) OR callsign ~* ANY($2::text[]) ORDER BY id`,
    [row.callsign, parts.map(tokenRe)]
  );
  return {
    success: true,
    filename: `personal-data-${String(row.booking_ref).replace(/[^A-Za-z0-9_-]/g, '_')}.json`,
    data: {
      exportedAt: new Date().toISOString(),
      controller: privacy.controllerName(),
      event: CONFIG.EVENT_NAME,
      booking: row,
      extras: (await db.query('SELECT addon_id, name, qty, unit_price FROM booking_addons WHERE booking_id = $1 ORDER BY addon_id', [row.id])).rows,
      logEntries: log.rows,
    },
  };
}

// ---- Art. 17: erase one booking. The notice email is sent FIRST and its failure never blocks the erasure. ----
async function eraseBooking(ref, opts) {
  opts = opts || {};
  ref = String(ref || '');
  const first = await db.query('SELECT * FROM bookings WHERE booking_ref = $1', [ref]);
  if (!first.rows.length) return { success: false, error: 'Booking not found: ' + ref };
  const row = first.rows[0];

  const mates = await db.query(
    `SELECT booking_ref FROM bookings WHERE room_ref = $1 AND booking_ref <> $1 AND status <> 'CANCELLED'`, [ref]);
  if (row.is_primary && mates.rows.length) {
    return { success: false, error: `${ref} is the primary booker of a room or spot that ${mates.rows.length} other active booking(s) share (`
      + mates.rows.map(m => m.booking_ref).join(', ') + '). Move or erase those first.' };
  }

  const notice = { requested: opts.sendNotice !== false, sent: false, error: '' };
  if (notice.requested) {
    if (!emails.isEnabled()) notice.error = 'Email is not configured on this server, so no notice was sent.';
    else if (!row.email) notice.error = 'The booking has no email address.';
    else {
      try {
        const m = emails.erasureMail(row);
        await emails.sendMail(row.email, m.subject, m.body, { noFooter: true, lang: m.lang });
        notice.sent = true;
      } catch (e) { notice.error = 'The notice email could not be sent: ' + e.message; }
    }
  }

  const done = await db.withBookingLock(async client => {
    const cur = await client.query('SELECT * FROM bookings WHERE booking_ref = $1', [ref]);
    if (!cur.rows.length) return { success: false, error: 'Booking was already erased' };
    await client.query('DELETE FROM bookings WHERE booking_ref = $1', [ref]);
    const logRows = await scrubLog(client, cur.rows[0]);
    return { success: true, logRows };
  });
  if (!done.success) return done;

  await db.logEvent('OK', 'data_erased', '', `seq=${row.seq} notice=${notice.sent ? 'sent' : 'not sent'}`);
  // Other systems must forget this person too: drop queued notifications about the booking, then announce the erasure (reference only)
  await webhooks.purge(ref);
  await webhooks.emit('booking.erased', ref);
  await vacuum(['bookings', 'event_log']);
  return { success: true, ref, notice, logRowsRemoved: done.logRows };
}

// ---- Event shutdown ----
async function counts(client) {
  const q = client || db;
  const b = await q.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status <> 'CANCELLED')::int AS active FROM bookings`);
  const l = await q.query('SELECT count(*)::int AS n FROM event_log');
  return { bookings: b.rows[0].total, activeBookings: b.rows[0].active, logRows: l.rows[0].n };
}

async function lastShutdown() {
  const r = await db.query(`SELECT value FROM settings WHERE key = 'LAST_SHUTDOWN'`);
  if (!r.rows.length) return null;
  try { return JSON.parse(r.rows[0].value); } catch (_) { return null; }
}

async function shutdownPreview() {
  return { success: true, retention: privacy.status(), counts: await counts(), last: await lastShutdown(), confirmPhrase: CONFIRM_PHRASE, emailEnabled: emails.isEnabled() };
}

async function shutdownErase(opts) {
  opts = opts || {};
  if (opts.confirm !== CONFIRM_PHRASE) return { success: false, error: `Type ${CONFIRM_PHRASE} to confirm.` };
  const st = privacy.status();
  if (st.hold) return { success: false, error: `A retention hold is active ("${st.hold}"). Clear it in Event setup once the matter is closed.` };
  if (!st.eventEnded && !opts.acknowledgeEarly) {
    return { success: false, needsAck: true, error: st.endDate
      ? `The event ends on ${st.endDate}. Tick the box to confirm that you want to erase everything before the event is over.`
      : 'No event end date is set. Tick the box to confirm that you want to erase everything.' };
  }

  const before = await counts();
  const notices = { requested: !!opts.sendNotices, sent: 0, failed: [], note: '' };
  if (notices.requested) {
    if (!emails.isEnabled()) notices.note = 'Email is not configured on this server, so no notices were sent.';
    else {
      const rows = (await db.query('SELECT callsign, name, email, booking_ref, language FROM bookings ORDER BY id')).rows;
      const seen = new Set();
      for (const r of rows) {
        const key = String(r.email || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        try { const m = emails.shutdownMail(r); await emails.sendMail(r.email, m.subject, m.body, { noFooter: true, lang: m.lang }); notices.sent++; }
        catch (e) { notices.failed.push({ callsign: r.callsign, email: r.email }); }
      }
    }
  }

  await db.withBookingLock(async client => {
    await client.query('DELETE FROM bookings');
    await client.query('DELETE FROM event_log');
    // Integrations end with the event: no queued personal data, no working keys, no active webhooks
    await client.query('DELETE FROM webhook_deliveries');
    await client.query('DELETE FROM api_idempotency');
    await client.query('UPDATE api_keys SET revoked_at = now() WHERE revoked_at IS NULL');
    await client.query('UPDATE webhooks SET enabled = false');
  });
  await setKey('REGISTRATION_OPEN', 'false');
  await setKey('BYPASS_TOKEN', '');
  const vacuumed = await vacuum(['bookings', 'event_log']);

  const after = await counts();
  const reg = await db.query(`SELECT value FROM settings WHERE key = 'REGISTRATION_OPEN'`);
  const verification = [
    { check: 'Bookings table is empty', expected: '0 rows', actual: after.bookings + ' rows', ok: after.bookings === 0 },
    { check: 'Event log is empty', expected: '0 rows', actual: after.logRows + ' rows', ok: after.logRows === 0 },
    { check: 'Registration is closed', expected: 'closed', actual: reg.rows[0] && reg.rows[0].value === 'false' ? 'closed' : 'open', ok: !!reg.rows[0] && reg.rows[0].value === 'false' },
    { check: 'Deleted rows physically removed (VACUUM FULL)', expected: 'done', actual: vacuumed ? 'done' : 'failed', ok: vacuumed },
  ];
  const verified = verification.every(v => v.ok);
  const record = { at: new Date().toISOString(), bookingsErased: before.bookings, noticesSent: notices.sent, noticesFailed: notices.failed.length, verified };
  await setKey('LAST_SHUTDOWN', JSON.stringify(record));
  await db.logEvent(verified ? 'OK' : 'ERROR', 'event_shutdown', '', `bookings=${before.bookings} verified=${verified}`);
  return { success: true, erased: before, notices, verification, verified, record };
}

module.exports = { exportBooking, eraseBooking, shutdownPreview, shutdownErase, CONFIRM_PHRASE };
