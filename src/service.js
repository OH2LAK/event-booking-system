'use strict';
// Booking logic ported from the Apps Script version. Differences are marked "FIX:".
const { CONFIG } = require('./config');
const db = require('./db');
const repo = require('./repo');
const emails = require('./emails');
const { getSettings, saveSettings } = require('./settings');
const { calculatePrice } = require('./pricing');

const TYPES = ['room', 'camper', 'tent', 'singlebed', 'dayvisitor'];
const STATUSES = ['CONFIRMED', 'CHECKED_IN', 'NEEDS_ATTENTION', 'CANCELLED'];

// Angle brackets are stripped from all guest-supplied text: several pages render these values via innerHTML.
const str = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[<>]/g, '').trim().slice(0, max);
const roomCfgOf = id => CONFIG.ROOMS.find(r => r.id === id);

// Price inputs derived from a sheet-style booking object.
// FIX: camper joiners are no longer charged the camper spot again when prices are recalculated.
function priceInput(o) {
  return {
    type: o.type,
    roomId: o.roomId,
    isPrimaryBooker: o.isPrimaryBooker === 'YES',
    thuExtraNight: o.thuExtraNight === 'YES',
    fullBoard: o.fullBoard === 'YES',
    soloRoom: o.soloRoom === 'YES',
    dayVisitorDays: o.dayVisitorDays || '',
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
    roomAvail[r.id] = {
      total: count, booked, available: count - booked, spotsUsed,
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
        thuExtraNight: b.thuExtraNight === 'YES',
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
      mealFriBbq: settings.MEAL_FRI_BBQ, mealSatHamDinner: settings.MEAL_SAT_HAM_DINNER,
      mealLunch: settings.MEAL_LUNCH, rooms: settings.ROOM_PRICES,
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
  const reject = (msg, callsign) => {
    db.logEvent('WARN', 'booking_rejected', callsign || '', msg);
    return { success: false, error: msg };
  };

  // --- validate and normalize input (FIX: reject is defined before use; lengths are capped) ---
  const callsign = str(input.callsign, 20).toUpperCase();
  if (!/^[A-Z0-9\/-]{3,20}$/.test(callsign)) return reject('Invalid callsign');
  const name = str(input.name, 100);
  if (name.length < 2) return reject('Name required', callsign);
  const email = str(input.email, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reject('Valid email required', callsign);
  if (!TYPES.includes(input.type)) return reject('Invalid booking type', callsign);

  const data = {
    callsign, name, email,
    phone: str(input.phone, 40), country: str(input.country, 60),
    type: input.type,
    roomId: str(input.roomId, 20), roomRef: str(input.roomRef, 60),
    joinExisting: !!input.joinExisting,
    thuExtraNight: !!input.thuExtraNight, fullBoard: !!input.fullBoard,
    dietary: str(input.dietary, 300), shirtSize: str(input.shirtSize, 10),
    gdprNoPublish: !!input.gdprNoPublish, soloDouble: !!input.soloDouble,
    dayVisitorDays: str(input.dayVisitorDays, 10), freeText: str(input.freeText, 1000),
    meals: input.meals && typeof input.meals === 'object' ? input.meals : null,
    bypassToken: str(input.bypassToken, 100),
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
      return reject(closedByDate ? 'Registration closed on ' + settings.REGISTRATION_CLOSES + '.' : 'Registration is closed.', callsign);
    }

    const existing = bookings.find(b => b.callsign === callsign);
    if (existing) return reject(`Callsign ${callsign} already has booking ${existing.bookingRef}. Contact organizer to modify.`, callsign);

    const seq = rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
    const bookingRef = `${callsign}-${seq}`;
    let isPrimary = false; let roomId = ''; let roomRef = bookingRef; let soloRoom = false;
    let primaryRow = null;

    if (data.type === 'room') {
      if (data.joinExisting && data.roomRef) {
        const primary = bookings.find(b => b.bookingRef === data.roomRef && b.isPrimaryBooker === 'YES' && b.type === 'room');
        if (!primary) return reject('Room reference not found: ' + data.roomRef, callsign);
        if (primary.soloRoom === 'YES') return reject('This room is booked for sole occupancy and cannot be joined.', callsign);
        const roomCfg = roomCfgOf(primary.roomId);
        const occupants = bookings.filter(b => b.roomRef === data.roomRef && b.isPrimaryBooker !== 'YES').length + 1;
        if (occupants >= roomCfg.persons) return reject(`Room ${data.roomRef} is full (${roomCfg.persons} persons max).`, callsign);
        roomId = primary.roomId; roomRef = data.roomRef; primaryRow = primary;
      } else {
        const roomCfg = roomCfgOf(data.roomId);
        if (!roomCfg) return reject('Invalid room type', callsign);
        const booked = bookings.filter(b => b.roomId === data.roomId && b.isPrimaryBooker === 'YES').length;
        if (booked >= settings.ROOM_COUNTS[roomCfg.id]) return reject(`No ${roomCfg.note_en} rooms left.`, callsign);
        // FIX: solo occupancy is only allowed when enabled and for multi-person rooms
        if (data.soloDouble) {
          if (!settings.ALLOW_SOLO_DOUBLE || roomCfg.persons < 2) return reject('Solo occupancy is not available for this room.', callsign);
          soloRoom = true;
        }
        isPrimary = true; roomId = data.roomId;
      }
    } else if (data.type === 'camper') {
      if (data.joinExisting && data.roomRef) {
        const primary = bookings.find(b => b.bookingRef === data.roomRef && b.isPrimaryBooker === 'YES' && b.type === 'camper');
        if (!primary) return reject('Camper spot reference not found: ' + data.roomRef, callsign);
        roomRef = data.roomRef; primaryRow = primary;
      } else {
        const camperBooked = bookings.filter(b => b.type === 'camper' && b.isPrimaryBooker === 'YES').length;
        if (camperBooked >= settings.CAMPER_VAN_SPOTS) return reject('No camper van spots left.', callsign);
        isPrimary = true;
      }
    } else if (data.type === 'tent') {
      // FIX: the admin switch for tent bookings is enforced server-side as well
      if (!settings.TENT_ENABLED) return reject('Tent bookings are not available.', callsign);
      if (bookings.filter(b => b.type === 'tent').length >= settings.TENT_SPOTS) return reject('No tent spots left.', callsign);
      isPrimary = true;
    } else if (data.type === 'singlebed') {
      // FIX: single-bed bookings must be enabled in settings and within the slot limit
      const singleBedBooked = bookings.filter(b => b.type === 'singlebed').length;
      if (!settings.ALLOW_SINGLE_BED_BOOKING || singleBedBooked >= (settings.SINGLE_BED_SLOTS || 0)) return reject('No single bed spots available.', callsign);
      let free = 0;
      bookings.filter(b => b.type === 'room' && b.isPrimaryBooker === 'YES' && b.soloRoom !== 'YES').forEach(b => {
        const cfg = roomCfgOf(b.roomId);
        if (!cfg) return;
        const f = cfg.persons - bookings.filter(bb => bb.roomRef === b.bookingRef).length;
        if (f > 0) free += f;
      });
      if (free <= 0) return reject('No single bed spots available.', callsign);
      isPrimary = true; roomId = 'singlebed';
    }

    if (data.thuExtraNight && data.type !== 'room' && data.type !== 'singlebed')
      return reject('Thursday extra night is only available with room or single-bed bookings.', callsign);
    // Joiners inherit the Thursday night of the room (as in the original UI); never charge it if the room lacks it
    if (data.type === 'dayvisitor' && !['fri', 'sat', 'both'].includes(data.dayVisitorDays))
      return reject('Please select which day(s) you will attend.', callsign);

    const price = calculatePrice({
      type: data.type, roomId, isPrimaryBooker: isPrimary, thuExtraNight: data.thuExtraNight,
      fullBoard: data.fullBoard, soloRoom, dayVisitorDays: data.dayVisitorDays,
      joinExisting: data.type === 'camper' && !isPrimary,
    }, settings);

    const meals = data.meals ? Object.entries(data.meals).filter(([, v]) => v).map(([k]) => k).join(',') : '';
    await client.query(
      `INSERT INTO bookings (seq, booking_ref, callsign, name, email, phone, country, type, room_id, room_ref,
         is_primary, thu_extra_night, full_board, dietary, shirt_size, total_price, price_breakdown, status,
         publish_consent, solo_room, day_visitor_days, meals, free_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'CONFIRMED',$18,$19,$20,$21,$22)`,
      [seq, bookingRef, callsign, name, email, data.phone, data.country, data.type, roomId, roomRef,
        isPrimary, data.thuExtraNight, data.fullBoard, data.dietary, data.shirtSize, price.total, price.breakdown,
        !data.gdprNoPublish, soloRoom, data.dayVisitorDays, meals, data.freeText]
    );

    const existingJoiners = data.joinExisting && primaryRow
      ? bookings.filter(b => b.roomRef === data.roomRef && b.isPrimaryBooker !== 'YES') : [];
    return { success: true, bookingRef, price, settings, primaryRow, existingJoiners, isPrimary, roomId };
  });

  if (!outcome.success) return outcome;

  // --- notifications (after commit; failures never undo the booking) ---
  const { bookingRef, price, settings, primaryRow, existingJoiners } = outcome;
  const mailData = Object.assign({}, data, {
    roomId: outcome.roomId, isPrimaryBooker: outcome.isPrimary,
    roomRef: data.joinExisting && primaryRow ? data.roomRef : bookingRef,
  });
  await safeEmail(callsign, () => emails.sendConfirmationEmail(mailData, bookingRef, price, CONFIG.FRIENDLY_URL, settings, primaryRow));

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
  return { success: true, bookingRef, price };
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
    const priceFields = ['FullBoard', 'ThuExtraNight', 'Type', 'RoomId', 'IsPrimaryBooker', 'SoloRoom'];
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
    const subject = '[' + CONFIG.EVENT_SHORT + '] Booking updated — ' + bookingRef;
    const body = `Dear ${obj.name} (${obj.callsign}),\n\nYour booking has been updated by the organizer.\n\n`
      + `Booking reference: ${bookingRef}\nUpdated fields: ${changed.join(', ')}\n\n`
      + '─────────────────────────────────────────\nCURRENT SERVICES\n─────────────────────────────────────────\n'
      + String(price.breakdown || '').replace(/ \| /g, '\n') + `\n\nTOTAL: €${price.total}\n\n`
      + `─────────────────────────────────────────\nIf you have questions, please contact us: ${CONFIG.REPLY_TO_EMAIL}\n\n${CONFIG.ORGANIZER}`;
    await safeEmail(obj.callsign, () => emails.sendMail(obj.email, subject, body, { name: CONFIG.EMAIL_SENDER_NAME, replyTo: CONFIG.REPLY_TO_EMAIL }));
  }
  for (const rm of roommates) {
    if (!rm.email) continue;
    const body = `Dear ${rm.name} (${rm.callsign.toUpperCase()}),\n\nThe primary booker of your room (${bookingRef}) has had their booking cancelled.\n`
      + `Your booking (${rm.booking_ref}) has been flagged as NEEDS_ATTENTION.\n\n`
      + `Please contact the organizers at ${CONFIG.REPLY_TO_EMAIL} to arrange a new room or alternative.\n\n${CONFIG.EMAIL_SENDER_NAME}`;
    await safeEmail(rm.callsign, () => emails.sendMail(rm.email, CONFIG.EVENT_SHORT + ' — Your room booking needs attention', body, { name: CONFIG.EMAIL_SENDER_NAME, replyTo: CONFIG.REPLY_TO_EMAIL }));
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
      const already = bookings.filter(b => b.roomId === newRoomId && b.isPrimaryBooker === 'YES' && b.bookingRef !== bookingRef).length;
      if (already >= settings.ROOM_COUNTS[newRoomId]) return { success: false, error: 'No ' + newRoomCfg.note_en + ' rooms available.' };
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
      const booked = rows.filter(r => r.room_id === targetRoomId && r.is_primary && isActive(r)).length;
      const limit = settings.ROOM_COUNTS[targetRoomId];
      if (booked >= limit) return { success: false, error: `No ${roomCfg.note_en} rooms available (${booked}/${limit} booked).` };
      await repo.updateFields(client, bookingRef, { IsPrimaryBooker: 'YES', RoomRef: bookingRef, RoomId: targetRoomId, Type: 'room' });
      const p = calculatePrice({ type: 'room', roomId: targetRoomId, fullBoard: row.full_board, thuExtraNight: row.thu_extra_night }, settings);
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
      const p = calculatePrice({ type: 'room', roomId: target.room_id, fullBoard: row.full_board, thuExtraNight: row.thu_extra_night }, settings);
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
