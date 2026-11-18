'use strict';
// Booking logic.
const { CONFIG } = require('./config');
const db = require('./db');
const repo = require('./repo');
const emails = require('./emails');
const { getSettings, saveSettings } = require('./settings');
const { calculatePrice } = require('./pricing');
const i18n = require('./i18n');
const currency = require('./currency');
const sms = require('./sms');
const addons = require('./addons');
const webhooks = require('./webhooks');

const TYPES = ['room', 'camper', 'tent', 'singlebed', 'dayvisitor', 'vendor'];
const modules = require('./modules');
const STATUSES = ['CONFIRMED', 'CHECKED_IN', 'NEEDS_ATTENTION', 'CANCELLED'];

// Angle brackets are stripped from all guest-supplied text: several pages render these values via innerHTML.
const str = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[<>]/g, '').trim().slice(0, max);
const roomCfgOf = id => CONFIG.ROOMS.find(r => r.id === id);
const S = require('./structure');

// Price inputs derived from a booking object (see repo.js).
// Camper joiners are not charged the camper spot again when prices are recalculated.
function priceInput(o, addonItems) {
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
    addons: addonItems || [],
  };
}

const PAYMENT_STATUSES = ['UNPAID', 'PAID', 'WAIVED'];
// The add-ons a booking has chosen, looked up by booking reference (price calculations need them).
async function itemsByRef(client, ref) {
  const r = await client.query('SELECT id FROM bookings WHERE booking_ref = $1', [ref]);
  return r.rows.length ? addons.forBooking(client, r.rows[0].id) : [];
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
  const singleBedVisible = modules.on('ROOMS') && allSinglesFull && freeSingleBeds > 0 && singleBedSlots > 0 && singleBedBooked < singleBedSlots;

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
    addons: await addons.publicList(db),
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

// opts (used by the API): skipNotifications, paymentStatus, source
async function submitBooking(input, opts) {
  input = input || {}; opts = opts || {};
  const lang = i18n.pickCode(input.language);
  // reject(key, vars, callsign): the log gets English text, the guest gets text in their language.
  // vars may be a function of the language code (for texts that contain localized names).
  const reject = (key, vars, callsign) => {
    const v = l => (typeof vars === 'function' ? vars(l) : vars);
    db.logEvent('WARN', 'booking_rejected', callsign || '', i18n.t('en', key, v('en')));
    return { success: false, error: i18n.t(lang, key, v(lang)), code: key };
  };

  // --- validate and normalize input (lengths are capped) ---
  // Vendors need not be radio amateurs: without a callsign they get a generated handle (V<number>) inside the lock below
  let callsign = str(input.callsign, 20).toUpperCase();
  const vendorNoCall = input.type === 'vendor' && !callsign;
  if (!vendorNoCall && !/^[A-Z0-9\/-]{3,20}$/.test(callsign)) return reject('err.callsign', null);
  const name = str(input.name, 100);
  if (name.length < 2) return reject('err.name', null, callsign);
  const email = str(input.email, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reject('err.email', null, callsign);
  const dayMode = CONFIG.EVENT_MODE === 'day';
  // Only the booking types of the switched-on event modules are accepted (see modules.js)
  if (!TYPES.includes(input.type) || !modules.typeAllowed(input.type)) return reject('err.type', null, callsign);
  if (input.privacyAck !== true) return reject('err.privacy', null, callsign);

  const data = {
    callsign, name, email,
    phone: str(input.phone, 40), country: str(input.country, 60),
    type: input.type,
    roomId: str(input.roomId, 20), roomRef: str(input.roomRef, 60),
    joinExisting: !dayMode && !!input.joinExisting,
    extraNights: S.pickExtras(Array.isArray(input.extraNights) ? input.extraNights : S.keys(input.extraNights)),
    nights: S.pickNights(Array.isArray(input.nights) ? input.nights : S.keys(input.nights)),
    fullBoard: !!input.fullBoard && CONFIG.STRUCTURE.package.enabled,
    dietary: str(input.dietary, 300), shirtSize: str(input.shirtSize, 10),
    publishConsent: input.publishConsent === true, soloDouble: !!input.soloDouble,
    visitorDays: dayMode ? CONFIG.STRUCTURE.days.map(d => d.key) : S.pickDays(Array.isArray(input.visitorDays) ? input.visitorDays : S.keys(input.visitorDays)), freeText: str(input.freeText, 1000),
    bypassToken: str(input.bypassToken, 100),
    language: lang,
  };
  const disp = currency.pickDisplay(input.displayCurrency); // indicative display currency only; payment is always in the native currency
  data.displayCurrency = disp.code; data.displayRate = disp.rate;

  const outcome = await db.withBookingLock(async client => {
    const settings = await getSettings(client);
    const rows = await repo.all(client);
    const bookings = repo.active(rows).map(repo.toObj);

    // Registration window: joining an existing room/camper only bypasses a closed
    // registration for room and camper bookings, not for any type.
    const joinBypass = data.joinExisting && (data.type === 'room' || data.type === 'camper');
    const tokenBypass = settings.BYPASS_TOKEN && data.bypassToken && data.bypassToken === settings.BYPASS_TOKEN;
    if (!settings.REGISTRATION_OPEN && !joinBypass && !tokenBypass) {
      const closedByDate = settings.REGISTRATION_CLOSES && new Date() > new Date(settings.REGISTRATION_CLOSES + 'T23:59:59');
      return closedByDate ? reject('err.closedOn', { date: settings.REGISTRATION_CLOSES }, callsign) : reject('err.closed', null, callsign);
    }

    const seq = rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
    if (vendorNoCall) { callsign = 'V' + seq; data.callsign = callsign; }
    const existing = bookings.find(b => b.callsign === callsign);
    if (existing) return reject('err.exists', { cs: callsign, ref: existing.bookingRef }, callsign);

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
        // Solo occupancy is only allowed when enabled and for multi-person rooms
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
      // The admin switch for tent bookings is enforced server-side as well
      if (!settings.TENT_ENABLED) return reject('err.tentNA', null, callsign);
      if (bookings.filter(b => b.type === 'tent').length >= settings.TENT_SPOTS) return reject('err.noTent', null, callsign);
      isPrimary = true;
    } else if (data.type === 'vendor') {
      isPrimary = true; // vendor-only registration: no accommodation, the vendor spaces are the booking
    } else if (data.type === 'singlebed') {
      // Single-bed bookings must be enabled in settings and within the slot limit
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

    const ad = await addons.resolve(input.addons, client);
    if (ad.error) return reject(ad.error, ad.vars, callsign);
    const hasSpace = ad.items.some(i => i.kind === 'vendor');
    if (data.type === 'vendor' && !hasSpace) return reject('err.vendorSpace', null, callsign);
    // Entry-ticket names belong to vendor bookings (and to any booking that includes a vendor space)
    const tickets = hasSpace ? addons.cleanTickets(input.tickets) : [];
    if (tickets.length > addons.MAX_TICKETS) return reject('err.tickets', { n: addons.MAX_TICKETS }, callsign);
    data.tickets = tickets; data.addonItems = ad.items;
    const priceInput_ = {
      addons: ad.items,
      type: data.type, roomId, isPrimaryBooker: isPrimary, extraNights: data.extraNights, nights: data.nights,
      fullBoard: data.fullBoard, soloRoom, visitorDays: data.visitorDays,
      joinExisting: data.type === 'camper' && !isPrimary,
    };
    const price = calculatePrice(priceInput_, settings); // stored in the event's default language
    const priceGuest = calculatePrice(priceInput_, settings, lang); // shown to the guest in their language

    await client.query(
      `INSERT INTO bookings (seq, booking_ref, callsign, name, email, phone, country, type, room_id, room_ref,
         is_primary, extra_nights, nights, full_board, dietary, shirt_size, total_price, price_breakdown, status,
         publish_consent, solo_room, visitor_days, free_text, privacy_ack_at, language, currency, display_currency, display_rate, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$22,$13,$14,$15,$16,$17,'CONFIRMED',$18,$19,$20,$21,now(),$23,$24,$25,$26,$27) RETURNING id`,
      [seq, bookingRef, callsign, name, email, data.phone, data.country, data.type, roomId, roomRef,
        isPrimary, data.extraNights.join(','), data.fullBoard, data.dietary, data.shirtSize, price.total, price.breakdown,
        data.publishConsent, soloRoom, data.visitorDays.join(','), data.freeText, data.nights.join(','), lang, currency.native(), data.displayCurrency, data.displayRate,
        PAYMENT_STATUSES.includes(opts.paymentStatus) ? opts.paymentStatus : (price.total > 0 ? 'UNPAID' : 'WAIVED')]
    ).then(async ins => {
      await addons.replaceForBooking(client, ins.rows[0].id, ad.items);
      if (tickets.length) await addons.replaceTickets(client, ins.rows[0].id, tickets);
      if (opts.paymentStatus === 'PAID') await client.query('UPDATE bookings SET paid_at = now() WHERE id = $1', [ins.rows[0].id]);
    });

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
  if (!opts.skipNotifications) {
  await safeEmail(callsign, () => emails.sendConfirmationEmail(mailData, bookingRef, priceGuest, CONFIG.FRIENDLY_URL, settings, primaryRow));
  if (sms.enabled() && data.phone) {
    // Short service message with the booking reference; the full confirmation goes by email.
    await sms.send(data.phone, `${CONFIG.EVENT_SHORT}: booking ${bookingRef} confirmed. Details sent by email.`, { label: callsign, externalId: bookingRef });
  }

  if (data.joinExisting && primaryRow && primaryRow.email) {
    await safeEmail(callsign, () => emails.sendRoomJoinNotification(primaryRow, data, bookingRef, settings));
    const roomCfg = roomCfgOf(primaryRow.roomId);
    if (roomCfg && data.type === 'room' && existingJoiners.length + 2 >= roomCfg.persons) {
      const all = [primaryRow].concat(existingJoiners).concat([{ callsign, name, isPrimaryBooker: 'NO', bookingRef }]);
      await safeEmail(callsign, () => emails.sendRoomFullNotification(primaryRow, roomCfg, all, settings));
    }
  }
  await safeEmail(callsign, () => emails.sendOrganizerNotification(mailData, bookingRef, price, settings));
  }

  db.logEvent('OK', 'booking_confirmed', callsign, `ref=${bookingRef} type=${data.type} price=${currency.fmt(price.total)}${opts.source ? ' via ' + opts.source : ''}`);
  await webhooks.emit('booking.created', bookingRef);
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
  // Chosen extras per booking, and the totals the organizer needs for catering and planning
  const ba = (await db.query(`SELECT b.booking_ref, b.status, a.addon_id, a.name, a.qty, a.note FROM booking_addons a JOIN bookings b ON b.id = a.booking_id ORDER BY a.addon_id`)).rows;
  const byRef = {}; const totals = {};
  ba.forEach(x => {
    (byRef[x.booking_ref] = byRef[x.booking_ref] || []).push({ id: x.addon_id, name: x.name, qty: Number(x.qty), note: x.note || '' });
    if (x.status !== 'CANCELLED') { const t = totals[x.addon_id] = totals[x.addon_id] || { id: x.addon_id, name: x.name, qty: 0, bookings: 0 }; t.qty += Number(x.qty); t.bookings++; }
  });
  const tk = (await db.query('SELECT b.booking_ref, t.name FROM booking_tickets t JOIN bookings b ON b.id = t.booking_id ORDER BY b.booking_ref, t.sort')).rows;
  const tkByRef = {}; tk.forEach(x => { (tkByRef[x.booking_ref] = tkByRef[x.booking_ref] || []).push(x.name); });
  const adminRows = rows.map(r => Object.assign(repo.toAdminRow(r), {
    AddonsJson: JSON.stringify(byRef[r.booking_ref] || []), TicketsJson: JSON.stringify(tkByRef[r.booking_ref] || []),
    Addons: (byRef[r.booking_ref] || []).map(a => a.name + (a.qty > 1 ? ' x' + a.qty : '') + (a.note ? ' (' + a.note + ')' : '')).join(', ') + ((tkByRef[r.booking_ref] || []).length ? ' [+' + tkByRef[r.booking_ref].length + ' tickets]' : ''),
  }));
  return {
    success: true, rows: adminRows, headers: repo.HEADERS.concat(['Addons']), addonTotals: Object.values(totals), addonCatalog: CONFIG.ADDONS,
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
      const items = addons.refreshPrices(await addons.forBooking(client, r.id));
      if (items.length) await addons.replaceForBooking(client, r.id, items);
      const p = calculatePrice(priceInput(repo.toObj(r), items), settings);
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
    if (clean.PaymentStatus !== undefined && !PAYMENT_STATUSES.includes(clean.PaymentStatus)) return { success: false, error: 'Invalid payment status' };
    if (clean.Callsign !== undefined) clean.Callsign = String(clean.Callsign).trim().toUpperCase();

    try { await repo.updateFields(client, bookingRef, clean); }
    catch (e) { return { success: false, error: e.code === '23505' ? 'Callsign already has an active booking' : e.message }; }

    if (clean.PaymentStatus !== undefined) {
      await client.query("UPDATE bookings SET paid_at = CASE WHEN payment_status = 'PAID' THEN COALESCE(paid_at, now()) ELSE NULL END WHERE booking_ref = $1", [bookingRef]);
    }
    // The admin may change the chosen extras (no capacity check: the organizer decides)
    let addonChange = false;
    if (Object.prototype.hasOwnProperty.call(fields, 'Addons')) {
      const old = await addons.forBooking(client, row.id);
      const items = [];
      for (const sel of Array.isArray(fields.Addons) ? fields.Addons : []) {
        const qty = Math.min(parseInt(sel && sel.qty, 10) || 0, 99);
        if (qty < 1) continue;
        const a = CONFIG.ADDONS.find(x => x.id === sel.id); const prev = old.find(x => x.id === sel.id);
        if (!a && !prev) return { success: false, error: 'Unknown extra: ' + sel.id };
        const note = sel.note !== undefined ? addons.cleanNote(sel.note) : (prev ? prev.note : '');
        items.push({ id: sel.id, name: a ? a.name : prev.name, qty, unit_price: prev ? prev.unit_price : addons.unitPrice(a), note });
      }
      await addons.replaceForBooking(client, row.id, items);
      addonChange = true;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'Tickets')) await addons.replaceTickets(client, row.id, addons.cleanTickets(fields.Tickets).slice(0, addons.MAX_TICKETS));
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
    const needsRecalc = addonChange || priceFields.some(f => Object.prototype.hasOwnProperty.call(clean, f));
    let price = { total: obj.totalPrice, breakdown: obj.priceBreakdown };
    if (needsRecalc) {
      price = calculatePrice(priceInput(obj, await addons.forBooking(client, row.id)), settings);
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
    return { success: true, cascadedCount: roommates.length, obj, price, roommates, before: { status: row.status, payment: row.payment_status }, clean };
  });

  if (!result.success) return result;
  const { obj, price, roommates } = result;
  if (sendEmail && obj.email) {
    const changed = Object.keys(fields).filter(k => k !== 'OrgComment' && k !== 'RoomNumber' && k !== 'FreeText' && k !== 'PaymentStatus');
    const m = emails.bookingUpdatedMail(obj, bookingRef, changed, price);
    await safeEmail(obj.callsign, () => emails.sendMail(obj.email, m.subject, m.body, { name: CONFIG.EMAIL_SENDER_NAME, replyTo: CONFIG.REPLY_TO_EMAIL, lang: m.lang }));
  }
  for (const rm of roommates) {
    if (!rm.email) continue;
    const m = emails.roommateCancelledMail(rm, bookingRef);
    await safeEmail(rm.callsign, () => emails.sendMail(rm.email, m.subject, m.body, { name: CONFIG.EMAIL_SENDER_NAME, replyTo: CONFIG.REPLY_TO_EMAIL, lang: m.lang }));
  }
  // Webhooks: what happened to the booking
  const API_NAME = { IsPrimaryBooker: 'isPrimary', Addons: 'extras' };
  const { before, clean } = result;
  const changed = Object.keys(clean).concat(Object.prototype.hasOwnProperty.call(fields, 'Addons') ? ['Addons'] : []).concat(Object.prototype.hasOwnProperty.call(fields, 'Tickets') ? ['Tickets'] : []).map(k => API_NAME[k] || k.charAt(0).toLowerCase() + k.slice(1));
  const evs = [];
  if (clean.Status === 'CANCELLED' && before.status !== 'CANCELLED') evs.push('booking.cancelled');
  if (clean.PaymentStatus === 'PAID' && before.payment !== 'PAID') evs.push('booking.paid');
  const statusMoved = clean.Status !== undefined && clean.Status !== before.status && clean.Status !== 'CANCELLED';
  const payMoved = clean.PaymentStatus !== undefined && clean.PaymentStatus !== before.payment && clean.PaymentStatus !== 'PAID';
  if (changed.some(k => k !== 'status' && k !== 'paymentStatus') || statusMoved || payMoved) evs.push('booking.updated');
  for (const t of evs) await webhooks.emit(t, bookingRef, { changed });
  for (const rm of roommates) await webhooks.emit('booking.updated', rm.booking_ref, { changed: ['status', 'orgComment'] });
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
    const items = await itemsByRef(client, bookingRef);
    const oldPrice = calculatePrice(priceInput(booking, items), settings);
    const updated = Object.assign({}, booking, { type: newType, roomId: newRoomId });
    const newPrice = calculatePrice(priceInput(updated, items), settings);

    const sets = { Type: newType, RoomId: newRoomId };
    if (newType !== 'room' && newType !== 'singlebed') { sets.RoomRef = bookingRef; sets.SoloRoom = 'NO'; }
    await repo.updateFields(client, bookingRef, sets);
    await client.query('UPDATE bookings SET total_price=$1, price_breakdown=$2 WHERE booking_ref=$3', [newPrice.total, newPrice.breakdown, bookingRef]);
    return { success: true, booking, oldRoomCfg, newRoomCfg, oldPrice, newPrice, newType, settings };
  });
  if (!result.success) return result;
  const { booking, oldRoomCfg, newRoomCfg, oldPrice, newPrice, newType, settings } = result;
  db.logEvent('OK', 'accommodation_changed', booking.callsign,
    `ref=${bookingRef} ${booking.type}/${booking.roomId} → ${newType}/${params.newRoomId || ''} price ${currency.fmt(oldPrice.total)}→${currency.fmt(newPrice.total)}`);
  await webhooks.emit('booking.updated', bookingRef, { changed: ['type', 'roomId'] });
  if (params.sendEmail && booking.email) {
    try {
      await emails.sendAccommodationChangeEmail_(booking, booking.type, oldRoomCfg, newType, newRoomCfg, oldPrice, newPrice, settings);
    } catch (e) { return { success: true, warning: 'Saved but email failed: ' + e.message }; }
  }
  return { success: true, oldPrice: oldPrice.total, newPrice: newPrice.total };
}

async function changeRole(bookingRef, params) {
  params = params || {};
  const out = await db.withBookingLock(async client => {
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
      const p = calculatePrice({ type: 'room', roomId: targetRoomId, fullBoard: row.full_board, extraNights: row.extra_nights, nights: row.nights, addons: await addons.forBooking(client, row.id) }, settings);
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
      const p = calculatePrice({ type: 'room', roomId: target.room_id, fullBoard: row.full_board, extraNights: row.extra_nights, nights: row.nights, addons: await addons.forBooking(client, row.id) }, settings);
      await client.query('UPDATE bookings SET total_price=$1, price_breakdown=$2 WHERE booking_ref=$3', [p.total, p.breakdown, bookingRef]);
      db.logEvent('OK', 'role_changed', callsign, `ref=${bookingRef} primary→joiner targetRoom=${targetRoomRef} oldJoinersFlagged=${oldJoiners.length}`);
      const extra = oldJoiners.length > 0 ? ` ${oldJoiners.length} previous joiner(s) flagged as NEEDS_ATTENTION.` : '';
      return { success: true, message: `${callsign} is now a joiner in room ${targetRoomRef}.${extra}`, flaggedCount: oldJoiners.length };
    }
    return { success: false, error: 'Unknown newRole: ' + params.newRole };
  });
  if (out && out.success) await webhooks.emit('booking.updated', bookingRef, { changed: ['isPrimary', 'roomRef', 'roomId'] });
  return out;
}

module.exports = {
  getAvailability, getPublicGuestList, submitBooking,
  getAdminData, getAdminSettings, saveAdminSettings, recalcAllPrices, updateBooking, changeAccommodation, changeRole,
};
