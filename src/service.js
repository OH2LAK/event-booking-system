'use strict';
// Booking logic ported from the Apps Script version. Differences are marked "FIX:".
const { CONFIG } = require('./config');
const db = require('./db');
const repo = require('./repo');
const emails = require('./emails');
const { getSettings, saveSettings } = require('./settings');
const { calculatePrice } = require('./pricing');
const i18n = require('./i18n');

const TYPES = ['room', 'camper', 'tent', 'singlebed', 'dayvisitor'];
const STATUSES = ['CONFIRMED', 'CHECKED_IN', 'NEEDS_ATTENTION', 'CANCELLED'];

// Angle brackets are stripped from all guest-supplied text: several pages render these values via innerHTML.
const str = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[<>]/g, '').trim().slice(0, max);
const roomCfgOf = id => CONFIG.ROOMS.find(r => r.id === id);
const S = require('./structure');

// Price inputs derived from a sheet-style booking object.
// FIX: camper joiners are no longer charged the camper spot again when prices are recalculated.
function priceInput(o) {
  return {
    type: o.type,
    roomId: o.roomId,
    isPrimaryBooker: o.isPrimaryBooker === 'YES',
    extraNights: o.extraNights || '',
    nights: o.nights || '',
    fullBoard: o.fullBoard === 'YES',
    soloRoom: o.soloRoom === 'YES',
    visitorDays: o.visitorDays || '',
    joinExisting: o.type === 'camper' && o.isPrimaryBooker !== 'YES',
  };
}

async function safeEmail(label, fn) {
  try { await fn(); } catch (e) { await db.logEvent('WARN', 'email_failed', label, e.message); }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------
async function getAvailability() {
  const settings = await getSettings();
  const bookings = repo.active(await repo.all(db)).map(repo.toObj);

  const roomAvail = {};
  CONFIG.ROOMS.forEach(r => {
    const count = settings.ROOM_COUNTS[r.id];
    const booked = bookings.filter(b => b.roomId === r.id && b.isPrimaryBooker === 'YES').length;
    const spotsUsed = bookings.filter(b => b.roomId === r.id).length;
    // Free rooms per night (core nights and extra nights). In per-night mode a room type counts as
    // available when at least one core night is still free.
    const occ = S.occupancy(bookings, r.id);
    const perNight = {}; S.allNightKeys().forEach(k => { perNight[k] = count - occ[k]; });
    const available = S.mode() === 'per_night' ? Math.max(0, ...S.coreNightKeys().map(k => perNight[k])) : count - booked;
    roomAvail[r.id] = {
      total: count, booked, available, perNight, spotsUsed,
      capacity: r.persons * count, price_eur: settings.ROOM_PRICES[r.id],
    };
  });

  const camperBooked = bookings.filter(b => b.type === 'camper' && b.isPrimaryBooker === 'YES').length;
  const tentBooked = bookings.filter(b => b.type === 'tent').length;
  const singleBedBooked = bookings.filter(b => b.type === 'singlebed').length;

  let freeSingleBeds = 0;
  CONFIG.ROOMS.filter(r => r.persons > 1).forEach(roomCfg => {
    const primaries = bookings.filter(b => b.roomId === roomCfg.id && b.isPrimaryBooker === 'YES' && b.soloRoom !== 'YES');
    primaries.forEach(b => {
      const occupants = bookings.filter(bb => bb.roomRef === b.bookingRef).length;
      const free = roomCfg.persons - occupants;
      if (free > 0) freeSingleBeds += free;
    });
    const unbooked = settings.ROOM_COUNTS[roomCfg.id] - primaries.length;
    if (unbooked > 0) freeSingleBeds += unbooked * roomCfg.persons;
  });

  const allSinglesFull = CONFIG.ROOMS.filter(r => r.persons === 1).every(cfg => {
    const booked = bookings.filter(b => b.roomId === cfg.id && b.isPrimaryBooker === 'YES').length;
    return booked >= settings.ROOM_COUNTS[cfg.id];
  });
  const singleBedSlots = settings.SINGLE_BED_SLOTS || 0;
  const singleBedVisible = allSinglesFull && freeSingleBeds > 0 && singleBedSlots > 0 && singleBedBooked < singleBedSlots;

  const openRooms = bookings
    .filter(b => b.type === 'room' && b.isPrimaryBooker === 'YES' && b.soloRoom !== 'YES')
    .map(b => {
      const roomCfg = roomCfgOf(b.roomId);
      if (!roomCfg) return null;
      const occupants = bookings.filter(bb => bb.roomRef === b.bookingRef && bb.isPrimaryBooker !== 'YES').length + 1;
      const livePrice = settings.ROOM_PRICES[roomCfg.id];
      return {
        ref: b.bookingRef, callsign: b.callsign, roomType: roomCfg.note_en, roomId: roomCfg.id,
        roomPersons: roomCfg.persons, spotsLeft: roomCfg.persons - occupants,
        pricePerPerson: Math.round(livePrice / roomCfg.persons), roomPrice: livePrice,
        extraNights: S.pickExtras(b.extraNights),
        nights: S.pickNights(b.nights),
      };
    }).filter(Boolean);

  const openCampers = bookings
    .filter(b => b.type === 'camper' && b.isPrimaryBooker === 'YES')
    .map(b => ({
      ref: b.bookingRef, callsign: b.callsign,
      occupants: bookings.filter(bb => bb.roomRef === b.bookingRef && bb.isPrimaryBooker !== 'YES').length + 1,
    }));

  return {
    rooms: roomAvail,
    camperSpotsLeft: settings.CAMPER_VAN_SPOTS - camperBooked,
    tentSpotsLeft: settings.TENT_SPOTS - tentBooked,
    singleBedsLeft: freeSingleBeds,
    singleBedBooked,
    singleBedVisible,
    openRooms,
    openCampers,
    tentEnabled: settings.TENT_ENABLED,
    config: CONFIG, // contains no secrets in the Node version
    prices: {
      fullBoard: settings.FULL_BOARD_PRICE, camperPerNight: settings.CAMPER_VAN_PRICE_PER_NIGHT,
      tentWeekend: settings.TENT_PRICE_WEEKEND, singleBed: settings.SINGLE_BED_PRICE,
      meetingFeeWeekend: settings.MEETING_FEE_WEEKEND, meetingFeeDay: settings.MEETING_FEE_DAY,
      rooms: settings.ROOM_PRICES,
    },
  };
}

async function getPublicGuestList() {
  const rows = repo.active(await repo.all(db)).map(repo.toObj);
  return rows
    .filter(b => b.publishConsent !== 'NO')
    .map(b => ({
      callsign: b.callsign || '',
      firstName: (b.name || '').split(' ')[0],
      type: b.type || 'room',
      isPrimaryBooker: b.isPrimaryBooker === 'YES',
      isOrganizer: b.isOrganizer === 'YES',
    }));
}

async function submitBooking(input) {
  input = input || {};
  const lang = i18n.pickCode(input.language);
  // reject(key, vars, callsign): the log gets English text, the guest gets text in their language.
  // vars may be a function of the language code (for texts that contain localized names).
  const reject = (key, vars, callsign) => {
    const v = l => (typeof vars === 'function' ? vars(l) : vars);
    db.logEvent('WARN', 'booking_rejected', callsign || '', i18n.t('en', key, v('en')));
    return { success: false, error: i18n.t(lang, key, v(lang)) };
  };

  // --- validate and normalize input (FIX: reject is defined before use; lengths are capped) ---
  const callsign = str(input.callsign, 20).toUpperCase();
  if (!/^[A-Z0-9\/-]{3,20}$/.test(callsign)) return reject('err.callsign', null);
  const name = str(input.name, 100);
  if (name.length < 2) return reject('err.name', null, callsign);
  const email = str(input.email, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reject('err.email', null, callsign);
  if (!TYPES.includes(input.type)) return reject('err.type', null, callsign);
  if (input.privacyAck !== true) return reject('err.privacy', null, callsign);

  const data = {
    callsign, name, email,
    phone: str(input.phone, 40), country: str(input.country, 60),
    type: input.type,
    roomId: str(input.roomId, 20), roomRef: str(input.roomRef, 60),
    joinExisting: !!input.joinExisting,
    extraNights: S.pickExtras(Array.isArray(input.extraNights) ? input.extraNights : S.keys(input.extraNights)),
    nights: S.pickNights(Array.isArray(input.nights) ? input.nights : S.keys(input.nights)),
    fullBoard: !!input.fullBoard && CONFIG.STRUCTURE.package.enabled,
    dietary: str(input.dietary, 300), shirtSize: str(input.shirtSize, 10),
    publishConsent: input.publishConsent === true, soloDouble: !!input.soloDouble,
    visitorDays: S.pickDays(Array.isArray(input.visitorDays) ? input.visitorDays : S.keys(input.visitorDays)), freeText: str(input.freeText, 1000),
    meals: input.meals && typeof input.meals === 'object' ? input.meals : null,
    bypassToken: str(input.bypassToken, 100),
    language: lang,
  };

  const outcome = await db.withBookingLock(async client => {
    const settings = await getSettings(client);
    const rows = await repo.all(client);
    const bookings = repo.active(rows).map(repo.toObj);

    // Registration window. FIX: joining an existing room/camper only bypasses a closed
    // registration for room and camper bookings, not for any type.
    const joinBypass = data.joinExisting && (data.type === 'room' || data.type === 'camper');
    const tokenBypass = settings.BYPASS_TOKEN && data.bypassToken && data.bypassToken === settings.BYPASS_TOKEN;
    if (!settings.REGISTRATION_OPEN && !joinBypass && !tokenBypass) {
      const closedByDate = settings.REGISTRATION_CLOSES && new Date() > new Date(settings.REGISTRATION_CLOSES + 'T23:59:59');
      return closedByDate ? reject('err.closedOn', { date: settings.REGISTRATION_CLOSES }, callsign) : reject('err.closed', null, callsign);
    }

    const existing = bookings.find(b => b.callsign === callsign);
    if (existing) return reject('err.exists', { cs: callsign, ref: existing.bookingRef }, callsign);

    const seq = rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
    const bookingRef = `${callsign}-${seq}`;
    let isPrimary = false; let roomId = ''; let roomRef = bookingRef; let soloRoom = false;
    let primaryRow = null;

    // Per-night mode: room and single-bed bookings choose their core nights (joiners inherit the room's nights)
    const joiningRoom = data.type === 'room' && data.joinExisting && data.roomRef;
    if ((data.type !== 'room' && data.type !== 'singlebed') || S.mode() !== 'per_night') data.nights = [];
    else if (!joiningRoom) {
      if (!data.nights.length) return reject('err.nights', null, callsign);
      if (data.nights.length === S.coreNightKeys().length) data.nights = [];
    }

    if (data.type === 'room') {
      if (data.joinExisting && data.roomRef) {
        const primary = bookings.find(b => b.bookingRef === data.roomRef && b.isPrimaryBooker === 'YES' && b.type === 'room');
        if (!primary) return reject('err.refNotFound', { ref: data.roomRef }, callsign);
        if (primary.soloRoom === 'YES') return reject('err.soloBooked', null, callsign);
        const roomCfg = roomCfgOf(primary.roomId);
        const occupants = bookings.filter(b => b.roomRef === data.roomRef && b.isPrimaryBooker !== 'YES').length + 1;
        if (occupants >= roomCfg.persons) return reject('err.roomFullRef', { ref: data.roomRef, n: roomCfg.persons }, callsign);
        roomId = primary.roomId; roomRef = data.roomRef; primaryRow = primary;
        data.nights = S.mode() === 'per_night' ? S.pickNights(primary.nights) : [];
      } else {
        const roomCfg = roomCfgOf(data.roomId);
        if (!roomCfg) return reject('err.roomType', null, callsign);
        const occ = S.occupancy(bookings, data.roomId);
        const full = S.nightsOf({ nights: data.nights, extraNights: data.extraNights }).find(k => occ[k] >= settings.ROOM_COUNTS[roomCfg.id]);
        if (full) return reject(S.mode() === 'per_night' ? 'err.noRoomsNight' : 'err.noRooms', l => ({ room: i18n.roomNote(l, roomCfg.id), night: i18n.nightLabel(l, full) }), callsign);
        // FIX: solo occupancy is only allowed when enabled and for multi-person rooms
        if (data.soloDouble) {
          if (!settings.ALLOW_SOLO_DOUBLE || roomCfg.persons < 2) return reject('err.soloNA', null, callsign);
          soloRoom = true;
        }
        isPrimary = true; roomId = data.roomId;
      }
    } else if (data.type === 'camper') {
      if (data.joinExisting && data.roomRef) {
        const primary = bookings.find(b => b.bookingRef === data.roomRef && b.isPrimaryBooker === 'YES' && b.type === 'camper');
        if (!primary) return reject('err.camperRef', { ref: data.roomRef }, callsign);
        roomRef = data.roomRef; primaryRow = primary;
      } else {
        const camperBooked = bookings.filter(b => b.type === 'camper' && b.isPrimaryBooker === 'YES').length;
        if (camperBooked >= settings.CAMPER_VAN_SPOTS) return reject('err.noCamper', null, callsign);
        isPrimary = true;
      }
    } else if (data.type === 'tent') {
      // FIX: the admin switch for tent bookings is enforced server-side as well
      if (!settings.TENT_ENABLED) return reject('err.tentNA', null, callsign);
      if (bookings.filter(b => b.type === 'tent').length >= settings.TENT_SPOTS) return reject('err.noTent', null, callsign);
      isPrimary = true;
    } else if (data.type === 'singlebed') {
      // FIX: single-bed bookings must be enabled in settings and within the slot limit
      const singleBedBooked = bookings.filter(b => b.type === 'singlebed').length;
      if (!settings.ALLOW_SINGLE_BED_BOOKING || singleBedBooked >= (settings.SINGLE_BED_SLOTS || 0)) return reject('err.noSingle', null, callsign);
      let free = 0;
      bookings.filter(b => b.type === 'room' && b.isPrimaryBooker === 'YES' && b.soloRoom !== 'YES').forEach(b => {
        const cfg = roomCfgOf(b.roomId);
        if (!cfg) return;
        const f = cfg.persons - bookings.filter(bb => bb.roomRef === b.bookingRef).length;
        if (f > 0) free += f;
      });
      if (free <= 0) return reject('err.noSingle', null, callsign);
      isPrimary = true; roomId = 'singlebed';
    }

    if (data.extraNights.length && data.type !== 'room' && data.type !== 'singlebed')
      return reject('err.extraOnly', null, callsign);
    // Joiners always get exactly the extra nights of the room they join (never trust the client for this)
    if (data.type === 'room' && primaryRow) data.extraNights = S.pickExtras(primaryRow.extraNights);
    if (data.type === 'dayvisitor' && !data.visitorDays.length)
      return reject('err.days', null, callsign);

    const priceInput_ = {
      type: data.type, roomId, isPrimaryBooker: isPrimary, extraNights: data.extraNights, nights: data.nights,
      fullBoard: data.fullBoard, soloRoom, visitorDays: data.visitorDays,
      joinExisting: data.type === 'camper' && !isPrimary,
    };
    const price = calculatePrice(priceInput_, settings); // stored in the event's default language
    const priceGuest = calculatePrice(priceInput_, settings, lang); // shown to the guest in their language

    const meals = data.meals ? Object.entries(data.meals).filter(([, v]) => v).map(([k]) => k).join(',') : '';
    await client.query(
      `INSERT INTO bookings (seq, booking_ref, callsign, name, email, phone, country, type, room_id, room_ref,
         is_primary, extra_nights, nights, full_board, dietary, shirt_size, total_price, price_breakdown, status,
         publish_consent, solo_room, visitor_days, meals, free_text, privacy_ack_at, language)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$23,$13,$14,$15,$16,$17,'CONFIRMED',$18,$19,$20,$21,$22,now(),$24)`,
      [seq, bookingRef, callsign, name, email, data.phone, data.country, data.type, roomId, roomRef,
        isPrimary, data.extraNights.join(','), data.fullBoard, data.dietary, data.shirtSize, price.total, price.breakdown,
        data.publishConsent, soloRoom, data.visitorDays.join(','), meals, data.freeText, data.nights.join(','), lang]
    );

    const existingJoiners = data.joinExisting && primaryRow
      ? bookings.filter(b => b.roomRef === data.roomRef && b.isPrimaryBooker !== 'YES') : [];
    return { success: true, bookingRef, price, priceGuest, settings, primaryRow, existingJoiners, isPrimary, roomId };
  });

  if (!outcome.success) return outcome;

  // --- notifications (after commit; failures never undo the booking) ---
  const { bookingRef, price, priceGuest, settings, primaryRow, existingJoiners } = outcome;
  const mailData = Object.assign({}, data, {
    roomId: outcome.roomId, isPrimaryBooker: outcome.isPrimary,
    roomRef: data.joinExisting && primaryRow ? data.roomRef : bookingRef,
  });
  await safeEmail(callsign, () => emails.sendConfirmationEmail(mailData, bookingRef, priceGuest, CONFIG.FRIENDLY_URL, settings, primaryRow));

  if (data.joinExisting && primaryRow && primaryRow.email) {
    await safeEmail(callsign, () => emails.sendRoomJoinNotification(primaryRow, data, bookingRef, settings));
    const roomCfg = roomCfgOf(primaryRow.roomId);
    if (roomCfg && data.type === 'room' && existingJoiners.length + 2 >= roomCfg.persons) {
      const all = [primaryRow].concat(existingJoiners).concat([{ callsign, name, isPrimaryBooker: 'NO', bookingRef }]);
      await safeEmail(callsign, () => emails.sendRoomFullNotification(primaryRow, roomCfg, all, settings));
    }
  }
  await safeEmail(callsign, () => emails.sendOrganizerNotification(mailData, bookingRef, price, settings));

  db.logEvent('OK', 'booking_confirmed', callsign, `ref=${bookingRef} type=${data.type} price=€${price.total}`);
  return { success: true, bookingRef, price: priceGuest };
}

// ----------------------------------------------------------------------------
// Admin API (authentication is enforced by the HTTP layer)
// ----------------------------------------------------------------------------
async function getAdminData() {
  const rows = await repo.all(db);
  const settings = await getSettings();
  const confirmed = repo.active(rows).map(repo.toObj);
  const bookedByType = {};
  CONFIG.ROOMS.forEach(r => {
    bookedByType[r.id] = confirmed.filter(b => b.roomId === r.id && b.isPrimaryBooker === 'YES').length;
  });
  return {
    success: true, rows: rows.map(repo.toAdminRow), headers: repo.HEADERS,
    rooms: CONFIG.ROOMS, roomPrices: settings.ROOM_PRICES, bookedByType,
  };
}

async function getAdminSettings() { return { success: true, settings: await getSettings() }; }
async function saveAdminSettings(settings) {
  try { await saveSettings(settings || {}); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
}

async function recalcAllPrices() {
  return db.withBookingLock(async client => {
    const settings = await getSettings(client);
    const rows = repo.active(await repo.all(client));
    for (const r of rows) {
      const p = calculatePrice(priceInput(repo.toObj(r)), settings);
      await client.query('UPDATE bookings SET total_price=$1, price_breakdown=$2 WHERE id=$3', [p.total, p.breakdown, r.id]);
    }
    return { success: true, updated: rows.length };
  });
}

async function updateBooking(bookingRef, fields, sendEmail) {
  fields = fields || {};
  const result = await db.withBookingLock(async client => {
    const settings = await getSettings(client);
    const rows = await repo.all(client);
    const row = rows.find(r => r.booking_ref === bookingRef);
    if (!row) return { success: false, error: 'Booking not found: ' + bookingRef };

    const clean = {};
    repo.EDITABLE.forEach(f => { if (Object.prototype.hasOwnProperty.call(fields, f)) clean[f] = fields[f]; });
    if (clean.ExtraNights !== undefined) clean.ExtraNights = S.pickExtras(S.keys(clean.ExtraNights)).join(',');
    if (clean.Nights !== undefined) { const n = S.pickNights(S.keys(clean.Nights)); clean.Nights = (S.mode() === 'per_night' && n.length < S.coreNightKeys().length) ? n.join(',') : ''; }
    if (clean.VisitorDays !== undefined) clean.VisitorDays = S.pickDays(S.keys(clean.VisitorDays)).join(',');
    if (clean.Status !== undefined && !STATUSES.includes(clean.Status)) return { success: false, error: 'Invalid status' };
    if (clean.Type !== undefined && !TYPES.includes(clean.Type)) return { success: false, error: 'Invalid type' };
    if (clean.Callsign !== undefined) clean.Callsign = String(clean.Callsign).trim().toUpperCase();

    try { await repo.updateFields(client, bookingRef, clean); }
    catch (e) { return { success: false, error: e.code === '23505' ? 'Callsign already has an active booking' : e.message }; }

    // Room number is shared by everyone in the same room
    if (Object.prototype.hasOwnProperty.call(clean, 'RoomNumber')) {
      const canonical = row.is_primary ? bookingRef : row.room_ref;
      await client.query(
        `UPDATE bookings SET room_number = $1 WHERE booking_ref <> $2 AND (booking_ref = $3 OR (room_ref = $3 AND is_primary = false))`,
        [String(clean.RoomNumber), bookingRef, canonical]
      );
    }

    const fresh = (await repo.all(client)).find(r => r.booking_ref === bookingRef);
    const obj = repo.toObj(fresh);
    const priceFields = ['FullBoard', 'ExtraNights', 'Nights', 'VisitorDays', 'Type', 'RoomId', 'IsPrimaryBooker', 'SoloRoom'];
    const needsRecalc = priceFields.some(f => Object.prototype.hasOwnProperty.call(clean, f));
    let price = { total: obj.totalPrice, breakdown: obj.priceBreakdown };
    if (needsRecalc) {
      price = calculatePrice(priceInput(obj), settings);
      await client.query('UPDATE bookings SET total_price=$1, price_breakdown=$2 WHERE booking_ref=$3', [price.total, price.breakdown, bookingRef]);
    }

    // Cascade: cancelling a primary room booker flags the roommates
    let roommates = [];
    if (clean.Status === 'CANCELLED' && row.is_primary && row.type === 'room') {
      roommates = repo.active(await repo.all(client)).filter(r => r.room_ref === bookingRef && !r.is_primary);
      for (const rm of roommates) {
        await client.query(
          `UPDATE bookings SET status='NEEDS_ATTENTION', org_comment=$1 WHERE id=$2`,
          [`Primary booker ${bookingRef} was cancelled — needs reassignment`, rm.id]
        );
      }
    }
    return { success: true, cascadedCount: roommates.length, obj, price, roommates };
  });

  if (!result.success) return result;
  const { obj, price, roommates } = result;
  if (sendEmail && obj.email) {
    const changed = Object.keys(fields).filter(k => k !== 'OrgComment' && k !== 'RoomNumber' && k !== 'FreeText');
    const m = emails.bookingUpdatedMail(obj, bookingRef, changed, price);
    await safeEmail(obj.callsign, () => emails.sendMail(obj.email, m.subject, m.body, { name: CONFIG.EMAIL_SENDER_NAME, replyTo: CONFIG.REPLY_TO_EMAIL, lang: m.lang }));
  }
  for (const rm of roommates) {
    if (!rm.email) continue;
    const m = emails.roommateCancelledMail(rm, bookingRef);
    await safeEmail(rm.callsign, () => emails.sendMail(rm.email, m.subject, m.body, { name: CONFIG.EMAIL_SENDER_NAME, replyTo: CONFIG.REPLY_TO_EMAIL, lang: m.lang }));
  }
  return { success: true, cascadedCount: result.cascadedCount };
}

async function changeAccommodation(bookingRef, params) {
  params = params || {};
  const result = await db.withBookingLock(async client => {
    const settings = await getSettings(client);
    const rows = await repo.all(client);
    const activeRows = rows.filter(r => r.status !== 'CANCELLED');
    const row = activeRows.find(r => r.booking_ref === bookingRef);
    if (!row) return { success: false, error: 'Booking not found: ' + bookingRef };
    const booking = repo.toObj(row);
    const bookings = activeRows.map(repo.toObj);

    const newType = params.newType;
    const newRoomId = params.newRoomId || '';
    if (!TYPES.includes(newType)) return { success: false, error: 'Invalid type: ' + newType };
    let newRoomCfg = null;
    if (newType === 'room') {
      newRoomCfg = roomCfgOf(newRoomId);
      if (!newRoomCfg) return { success: false, error: 'Invalid room type: ' + newRoomId };
      const occ = S.occupancy(bookings.filter(b => b.bookingRef !== bookingRef), newRoomId);
      if (S.nightsOf(booking).some(k => occ[k] >= settings.ROOM_COUNTS[newRoomId])) return { success: false, error: 'No ' + newRoomCfg.note_en + ' rooms available.' };
      if (booking.isPrimaryBooker === 'YES') {
        const joiners = bookings.filter(b => b.roomRef === bookingRef && b.isPrimaryBooker !== 'YES' && b.bookingRef !== bookingRef);
        if (joiners.length + 1 > newRoomCfg.persons)
          return { success: false, error: `Room has ${joiners.length} joiner(s) — new room type only fits ${newRoomCfg.persons} person(s) total.` };
      }
    }
    const oldRoomCfg = booking.roomId ? roomCfgOf(booking.roomId) : null;
    const oldPrice = calculatePrice(priceInput(booking), settings);
    const updated = Object.assign({}, booking, { type: newType, roomId: newRoomId });
    const newPrice = calculatePrice(priceInput(updated), settings);

    const sets = { Type: newType, RoomId: newRoomId };
    if (newType !== 'room' && newType !== 'singlebed') { sets.RoomRef = bookingRef; sets.SoloRoom = 'NO'; }
    await repo.updateFields(client, bookingRef, sets);
    await client.query('UPDATE bookings SET total_price=$1, price_breakdown=$2 WHERE booking_ref=$3', [newPrice.total, newPrice.breakdown, bookingRef]);
    return { success: true, booking, oldRoomCfg, newRoomCfg, oldPrice, newPrice, newType, settings };
  });
  if (!result.success) return result;
  const { booking, oldRoomCfg, newRoomCfg, oldPrice, newPrice, newType, settings } = result;
  db.logEvent('OK', 'accommodation_changed', booking.callsign,
    `ref=${bookingRef} ${booking.type}/${booking.roomId} → ${newType}/${params.newRoomId || ''} price €${oldPrice.total}→€${newPrice.total}`);
  if (params.sendEmail && booking.email) {
    try {
      await emails.sendAccommodationChangeEmail_(booking, booking.type, oldRoomCfg, newType, newRoomCfg, oldPrice, newPrice, settings);
    } catch (e) { return { success: true, warning: 'Saved but email failed: ' + e.message }; }
  }
  return { success: true, oldPrice: oldPrice.total, newPrice: newPrice.total };
}

async function changeRole(bookingRef, params) {
  params = params || {};
  return db.withBookingLock(async client => {
    const settings = await getSettings(client);
    const rows = await repo.all(client);
    const row = rows.find(r => r.booking_ref === bookingRef);
    if (!row) return { success: false, error: 'Booking not found: ' + bookingRef };
    if (row.type !== 'room' && row.type !== 'singlebed') return { success: false, error: 'Role change only applies to room/singlebed bookings.' };
    const callsign = row.callsign;
    const isActive = r => repo.ACTIVE.includes(r.status);

    if (params.newRole === 'primary') {
      if (row.is_primary) return { success: false, error: 'Already a primary booker.' };
      const targetRoomId = params.targetRoomId;
      if (!targetRoomId) return { success: false, error: 'No room type selected.' };
      const roomCfg = roomCfgOf(targetRoomId);
      if (!roomCfg) return { success: false, error: 'Invalid room type.' };
      const limit = settings.ROOM_COUNTS[targetRoomId];
      const occ = S.occupancy(rows.filter(r => isActive(r) && r.booking_ref !== bookingRef).map(repo.toObj), targetRoomId);
      const busy = S.nightsOf(repo.toObj(row)).find(k => occ[k] >= limit);
      if (busy) return { success: false, error: `No ${roomCfg.note_en} rooms available (${occ[busy]}/${limit} booked for ${S.nightLabel(busy)}).` };
      await repo.updateFields(client, bookingRef, { IsPrimaryBooker: 'YES', RoomRef: bookingRef, RoomId: targetRoomId, Type: 'room' });
      const p = calculatePrice({ type: 'room', roomId: targetRoomId, fullBoard: row.full_board, extraNights: row.extra_nights, nights: row.nights }, settings);
      await client.query('UPDATE bookings SET total_price=$1, price_breakdown=$2 WHERE booking_ref=$3', [p.total, p.breakdown, bookingRef]);
      db.logEvent('OK', 'role_changed', callsign, `ref=${bookingRef} joiner→primary roomId=${targetRoomId}`);
      return { success: true, message: `${callsign} promoted to primary booker in a ${roomCfg.note_en} room.` };
    }

    if (params.newRole === 'joiner') {
      if (!row.is_primary) return { success: false, error: 'Not a primary booker.' };
      const targetRoomRef = params.targetRoomRef;
      if (!targetRoomRef) return { success: false, error: 'No target room selected.' };
      if (targetRoomRef === bookingRef) return { success: false, error: 'Cannot join own room.' };
      const target = rows.find(r => r.booking_ref === targetRoomRef && r.is_primary && isActive(r));
      if (!target) return { success: false, error: 'Target room not found or not a primary booking.' };
      const targetCfg = roomCfgOf(target.room_id);
      if (!targetCfg) return { success: false, error: 'Target room config not found.' };
      const occupants = rows.filter(r => (r.booking_ref === targetRoomRef || r.room_ref === targetRoomRef) && isActive(r)).length;
      if (occupants >= targetCfg.persons) return { success: false, error: `Target room is full (${occupants}/${targetCfg.persons}).` };

      const oldJoiners = rows.filter(r => r.room_ref === bookingRef && !r.is_primary && isActive(r));
      const comment = `Primary booker ${callsign} (${bookingRef}) was moved to another room by admin. Please reassign or contact these guests.`;
      for (const j of oldJoiners) {
        await client.query(`UPDATE bookings SET status='NEEDS_ATTENTION', org_comment=$1 WHERE id=$2`, [comment, j.id]);
      }
      await repo.updateFields(client, bookingRef, { IsPrimaryBooker: 'NO', RoomRef: targetRoomRef, RoomId: target.room_id });
      const p = calculatePrice({ type: 'room', roomId: target.room_id, fullBoard: row.full_board, extraNights: row.extra_nights, nights: row.nights }, settings);
      await client.query('UPDATE bookings SET total_price=$1, price_breakdown=$2 WHERE booking_ref=$3', [p.total, p.breakdown, bookingRef]);
      db.logEvent('OK', 'role_changed', callsign, `ref=${bookingRef} primary→joiner targetRoom=${targetRoomRef} oldJoinersFlagged=${oldJoiners.length}`);
      const extra = oldJoiners.length > 0 ? ` ${oldJoiners.length} previous joiner(s) flagged as NEEDS_ATTENTION.` : '';
      return { success: true, message: `${callsign} is now a joiner in room ${targetRoomRef}.${extra}`, flaggedCount: oldJoiners.length };
    }
    return { success: false, error: 'Unknown newRole: ' + params.newRole };
  });
}

module.exports = {
  getAvailability, getPublicGuestList, submitBooking,
  getAdminData, getAdminSettings, saveAdminSettings, recalcAllPrices, updateBooking, changeAccommodation, changeRole,
};
