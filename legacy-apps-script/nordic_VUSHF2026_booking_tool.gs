// =============================================================================
// NORDIC VUSHF MEETING 2026 — BOOKING SYSTEM
// Organized by RATS - Radio Amateur Technology Society of Finland
// Location: Hotelli Martinhovi, Raisio, Finland
// Event dates: Fri–Sun 15–17 May 2026
// =============================================================================
// INSTRUCTIONS:
//   1. In Google Drive, create a new Google Apps Script project (script.google.com)
//   2. Paste this entire file into the editor (replace the default code)
//   3. Run setupSpreadsheet() ONCE to create the backing Sheet
//   4. Deploy as Web App:
//        Execute as: Me
//        Who has access: Anyone
//   5. Share the Web App URL with participants
//   6. Organizer view: append ?admin=1 to the URL, password set in CONFIG below
// =============================================================================

// =============================================================================
// CONFIGURATION — EDIT THESE VALUES AS NEEDED
// =============================================================================
const VERSION = '20260504-2136';  // ← update when deploying a new version

const CONFIG = {

  // --- Event info ---
  EVENT_NAME:     "Nordic VUSHF Meeting 2026",
  ORGANIZER:      "RATS – Radio Amateur Technology Society of Finland",
  LOCATION:       "Hotelli Martinhovi, Raisio, Finland",
  DATE_FRI:       "Friday 15 May 2026",
  DATE_SAT:       "Saturday 16 May 2026",
  DATE_SUN:       "Sunday 17 May 2026",
  DATE_THU:       "Thursday 14 May 2026",  // optional extra night
  CHECKIN_TIME:   "From 15:00 on Thursday/Friday",
  CHECKOUT_TIME:  "Sunday by 12:00",

  // --- Email ---
  EMAIL_SENDER_NAME: "Nordic VUSHF 2026 / RATS",
  REPLY_TO_EMAIL:    "meeting@rats.fi",

  // --- Admin ---
  ADMIN_PASSWORD: "REDACTED_ADMIN_PASSWORD",

  // --- Sheet name ---
  SHEET_NAME: "Bookings",

  // --- Room inventory ---
  // Upstairs rooms (NO LIFT — stairs only)
  ROOMS: [
    { id: "1S-W",  type: "single",  persons: 1, floor: "upstairs", window: true,  count: 6,  price_eur: 220, note_en: "Single room, window, upstairs (stairs only)" },
    { id: "1S-NW", type: "single",  persons: 1, floor: "upstairs", window: false, count: 3,  price_eur: 200, note_en: "⚠️ Single room, NO WINDOW, upstairs (stairs only)" },
    { id: "2S",    type: "double",  persons: 2, floor: "upstairs", window: true,  count: 20, price_eur: 270, note_en: "Double room, upstairs (stairs only)" },
    // Downstairs rooms
    // Upstairs triple rooms
    { id: "3S-U",  type: "triple",  persons: 3, floor: "upstairs",   window: true, count: 3, price_eur: 330, note_en: "Triple room, upstairs (stairs only)" },
    // Downstairs rooms
    { id: "3S",    type: "triple",  persons: 3, floor: "downstairs", window: true, count: 1, price_eur: 330, note_en: "Triple room, downstairs" },
    { id: "4S",    type: "quad",    persons: 4, floor: "downstairs", window: true, count: 2, price_eur: 400, note_en: "Quad room, downstairs" },
    { id: "7S",    type: "seven",   persons: 7, floor: "downstairs", window: true, count: 1, price_eur: 540, note_en: "Seven-person room, downstairs" },
  ],

  // Extra bed add-on (per person, whole event 2 nights)
  EXTRA_BED_PRICE: 74,

  // Thursday extra night add-on (per person — PRICE TBD, set when known)
  THU_EXTRA_NIGHT_PRICE: null,  // ← SET THIS when price is decided (e.g. 37)
  THU_EXTRA_INCLUDES: "Includes Friday breakfast",

  // --- Meal package ---
  FULL_BOARD_PRICE: 75,
  FULL_BOARD_INCLUDES_EN: [
    "Friday: BBQ dinner",
    "Saturday: lunch + Ham Dinner",
    "Note: breakfast is included in all room prices"
  ],

  // Individual meal prices (à la carte — available to all, especially day visitors)
  MEAL_FRI_BBQ: 20,
  MEAL_SAT_HAM_DINNER: 42,
  MEAL_LUNCH: 18,  // per lunch, applies to both Fri lunch and Sat lunch

  // --- Camping / camper van ---
  CAMPER_VAN_SPOTS: 10,
  CAMPER_VAN_PRICE_PER_NIGHT: 20,  // includes electricity
  TENT_SPOTS: 5,
  TENT_PRICE_WEEKEND: 10,
  TENT_PRICE_DAY: 5,  // day visitor camping (not handled in booking — on-site only)

  // Camping nights (Fri + Sat = 2)
  CAMPING_NIGHTS: 2,

  // Additional info shown to camper van and tent bookers
  CAMPER_INFO: "This is additional information for camper van guests. Electricity hookup (230V) is available at each spot. Please bring your own extension cable. The camper area is located adjacent to the hotel parking area. More details will be provided closer to the event.",
  TENT_INFO: "This is additional information for tent campers. The tent area is located on the hotel grounds. Shower and toilet facilities in the hotel are available for campers. Please note that open fires are not permitted. More details will be provided closer to the event.",

  // Web app URL — paste your deployed exec URL here once, never changes unless you create a new project
  WEBAPP_URL: "REDACTED_WEBAPP_EXEC_URL",
  FRIENDLY_URL: "https://vushf2026-booking.oh2lak.radio",

  // Solo double room booking
  ALLOW_SOLO_DOUBLE: false,

  // Single bed booking (organizer-assigned room)
  ALLOW_SINGLE_BED_BOOKING: false,
  SINGLE_BED_PRICE: 220,
  SINGLE_BED_SLOTS: 0,   // Max single bed bookings offered (0 = disabled until set in admin)

  // Meeting fee (charged to ALL registrants)
  MEETING_FEE_WEEKEND: 10,   // Fri+Sat or Sat+Sun — full weekend
  MEETING_FEE_DAY: 5,        // Single day (day visitors only)
};

// =============================================================================
// MAIN ENTRY POINT — doGet
// =============================================================================
function doGet(e) {
  const isAdmin  = e.parameter && e.parameter.admin === "1";
  const isPublic = e.parameter && e.parameter.public === "1";
  const isDebug  = e.parameter && e.parameter.debug === "admin";
  if (isDebug) return buildAdminPageDebug();
  const joinRef_ = (e.parameter && e.parameter.join)   ? e.parameter.join   : '';
  const bypass_  = (e.parameter && e.parameter.bypass) ? e.parameter.bypass : '';
  let html;
  if (isAdmin)       html = buildAdminPage();
  else if (isPublic) html = buildPublicPage();
  else               html = buildBookingPage(joinRef_, bypass_);
  return HtmlService.createHtmlOutput(html)
    .setTitle(CONFIG.EVENT_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =============================================================================
// SERVER-SIDE FUNCTIONS (called from client via google.script.run)
// =============================================================================

function getAvailability() {
  const sheet = getSheet();
  const bookings = getConfirmedBookings(sheet);
  const settings = getSettings_();

  const roomAvail = {};
  CONFIG.ROOMS.forEach(r => {
    const count = (settings.ROOM_COUNTS && settings.ROOM_COUNTS[r.id] !== undefined)
                  ? settings.ROOM_COUNTS[r.id] : r.count;
    const price = (settings.ROOM_PRICES && settings.ROOM_PRICES[r.id] !== undefined)
                  ? settings.ROOM_PRICES[r.id] : r.price_eur;
    const booked = bookings.filter(b => b.roomId === r.id && b.isPrimaryBooker === "YES").length;
    const spotsUsed = bookings.filter(b => b.roomId === r.id)
                              .reduce((sum, b) => sum + (b.personsInRoom || 1), 0);
    roomAvail[r.id] = {
      total: count,
      booked: booked,
      available: count - booked,
      spotsUsed: spotsUsed,
      capacity: r.persons * count,
      price_eur: price,
    };
  });

  const camperBooked    = bookings.filter(b => b.type === "camper" && b.isPrimaryBooker === "YES").length;
  const tentBooked      = bookings.filter(b => b.type === "tent").length;

  const singleBedBooked = bookings.filter(b => b.type === "singlebed").length;

  // Count free beds in all multi-person rooms (booked non-solo + fully unbooked)
  let freeSingleBeds = 0;
  const multiPersonRooms = CONFIG.ROOMS.filter(r => r.persons > 1);
  multiPersonRooms.forEach(roomCfg => {
    const primaryBookings = bookings.filter(b => b.roomId === roomCfg.id && b.isPrimaryBooker === "YES" && b.soloRoom !== "YES");
    // Beds taken in booked rooms
    primaryBookings.forEach(b => {
      const occupants = bookings.filter(bb => bb.roomRef === b.bookingRef).length;
      const free = roomCfg.persons - occupants;
      if (free > 0) freeSingleBeds += free;
    });
    // Fully unbooked rooms of this type
    const unbookedRooms = roomCfg.count - primaryBookings.length;
    if (unbookedRooms > 0) freeSingleBeds += unbookedRooms * roomCfg.persons;
  });

  const singleRoomIds = CONFIG.ROOMS.filter(r => r.persons === 1).map(r => r.id);
  const allSinglesFull = singleRoomIds.every(id => {
    const cfg = CONFIG.ROOMS.find(r => r.id === id);
    if (!cfg) return true;
    const booked = bookings.filter(b => b.roomId === id && b.isPrimaryBooker === "YES").length;
    return booked >= cfg.count;
  });
  const singleBedSlots = settings.SINGLE_BED_SLOTS || 0;
  const singleBedVisible = allSinglesFull && freeSingleBeds > 0 && singleBedSlots > 0 && singleBedBooked < singleBedSlots;

  const openRooms = bookings
    .filter(b => b.type === "room" && b.isPrimaryBooker === "YES" && b.soloRoom !== "YES")
    .map(b => {
      const roomCfg = CONFIG.ROOMS.find(r => r.id === b.roomId);
      if (!roomCfg) return null;
      const occupants = bookings.filter(bb => bb.roomRef === b.bookingRef && bb.isPrimaryBooker !== "YES").length + 1;
      const spotsLeft = roomCfg.persons - occupants;
      const liveRoomPrice = (settings.ROOM_PRICES && settings.ROOM_PRICES[roomCfg.id] !== undefined)
                            ? settings.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur;
      return {
        ref: b.bookingRef,
        callsign: b.callsign,
        roomType: roomCfg.note_en,
        roomId: roomCfg.id,
        roomPersons: roomCfg.persons,
        spotsLeft: spotsLeft,
        pricePerPerson: Math.round(liveRoomPrice / roomCfg.persons),
        roomPrice: liveRoomPrice,
        thuExtraNight: b.thuExtraNight === "YES",
      };
    })
    .filter(Boolean);

  const openCampers = bookings
    .filter(b => b.type === "camper" && b.isPrimaryBooker === "YES")
    .map(b => {
      const occupants = bookings.filter(bb => bb.roomRef === b.bookingRef && bb.isPrimaryBooker !== "YES").length + 1;
      return {
        ref: b.bookingRef,
        callsign: b.callsign,
        occupants: occupants,
      };
    });

  return {
    rooms: roomAvail,
    camperSpotsLeft:   settings.CAMPER_VAN_SPOTS - camperBooked,
    tentSpotsLeft:     settings.TENT_SPOTS - tentBooked,
    singleBedsLeft:    freeSingleBeds,
    singleBedBooked:   singleBedBooked,
    singleBedVisible:  singleBedVisible,
    openRooms:         openRooms,
    openCampers:       openCampers,
    tentEnabled:       settings.TENT_ENABLED,
    config:            CONFIG,
    prices: {
      fullBoard:           settings.FULL_BOARD_PRICE,
      camperPerNight:      settings.CAMPER_VAN_PRICE_PER_NIGHT,
      tentWeekend:         settings.TENT_PRICE_WEEKEND,
      singleBed:           settings.SINGLE_BED_PRICE,
      meetingFeeWeekend:   settings.MEETING_FEE_WEEKEND,
      meetingFeeDay:       settings.MEETING_FEE_DAY,
      mealFriBbq:          settings.MEAL_FRI_BBQ,
      mealSatHamDinner:    settings.MEAL_SAT_HAM_DINNER,
      mealLunch:           settings.MEAL_LUNCH,
      rooms:               settings.ROOM_PRICES,
    },
  };
}

function submitBooking(data) {
  try {
    if (!data.callsign || data.callsign.trim().length < 3)
      return reject("Invalid callsign");
    if (!data.name || data.name.trim().length < 2)
      return reject("Name required");
    if (!data.email || !data.email.includes("@"))
      return reject("Valid email required");

    const callsign = data.callsign.trim().toUpperCase();
    const sheet = getSheet();
    const settings = getSettings_();

    // Helper: log a rejection and return the error object
    const reject = (msg) => {
      logEvent_("WARN", "booking_rejected", callsign, msg);
      return { success: false, error: msg };
    };

    if (!settings.REGISTRATION_OPEN) {
      const validBypass = (data.joinExisting)
        || (settings.BYPASS_TOKEN && data.bypassToken && data.bypassToken === settings.BYPASS_TOKEN);
      if (!validBypass)
        return reject("Registration is closed.");
    }
    if (settings.REGISTRATION_CLOSES) {
      var deadline = new Date(settings.REGISTRATION_CLOSES + 'T23:59:59');
      if (new Date() > deadline) {
        const validBypass = (data.joinExisting)
          || (settings.BYPASS_TOKEN && data.bypassToken && data.bypassToken === settings.BYPASS_TOKEN);
        if (!validBypass)
          return reject("Registration closed on " + settings.REGISTRATION_CLOSES + ".");
      }
    }
    const bookings = getConfirmedBookings(sheet);

    const existing = bookings.find(b => b.callsign === callsign);
    if (existing)
      return reject(`Callsign ${callsign} already has booking ${existing.bookingRef}. Contact organizer to modify.`);

    const seqNum = sheet.getLastRow();
    const bookingRef = `${callsign}-${seqNum}`;

    if (data.type === "room") {
      if (data.joinExisting && data.roomRef) {
        const primary = bookings.find(b => b.bookingRef === data.roomRef && b.isPrimaryBooker === "YES");
        if (!primary)
          return reject("Room reference not found: " + data.roomRef);
        if (primary.soloRoom === "YES")
          return reject("This room is booked for sole occupancy and cannot be joined.");
        const roomCfg = CONFIG.ROOMS.find(r => r.id === primary.roomId);
        const occupants = bookings.filter(b => b.roomRef === data.roomRef && b.isPrimaryBooker !== "YES").length + 1;
        if (occupants >= roomCfg.persons)
          return reject(`Room ${data.roomRef} is full (${roomCfg.persons} persons max).`);
        data.roomId = primary.roomId;
        data.isPrimaryBooker = false;
      } else {
        const roomCfg = CONFIG.ROOMS.find(r => r.id === data.roomId);
        if (!roomCfg)
          return reject("Invalid room type");
        const bookedCount = bookings.filter(b => b.roomId === data.roomId && b.isPrimaryBooker === "YES").length;
        if (bookedCount >= roomCfg.count)
          return reject(`No ${roomCfg.note_en} rooms left.`);
        data.isPrimaryBooker = true;
        data.roomRef = bookingRef;
      }
    } else if (data.type === "camper") {
      if (data.joinExisting && data.roomRef) {
        const primary = bookings.find(b => b.bookingRef === data.roomRef && b.isPrimaryBooker === "YES" && b.type === "camper");
        if (!primary) return reject("Camper spot reference not found: " + data.roomRef);
        data.isPrimaryBooker = false;
      } else {
        const camperBooked = bookings.filter(b => b.type === "camper" && b.isPrimaryBooker === "YES").length;
        if (camperBooked >= settings.CAMPER_VAN_SPOTS)
          return reject("No camper van spots left.");
        data.isPrimaryBooker = true;
        data.roomRef = bookingRef;
      }
    } else if (data.type === "tent") {
      const tentBooked = bookings.filter(b => b.type === "tent").length;
      if (tentBooked >= settings.TENT_SPOTS)
        return reject("No tent spots left.");
      data.isPrimaryBooker = true;
      data.roomRef = bookingRef;
    } else if (data.type === "singlebed") {
      let freeSingleBeds_ = 0;
      bookings
        .filter(b => b.type === "room" && b.isPrimaryBooker === "YES" && b.soloRoom !== "YES")
        .forEach(b => {
          const roomCfg_ = CONFIG.ROOMS.find(r => r.id === b.roomId);
          if (!roomCfg_) return;
          const occupants_ = bookings.filter(bb => bb.roomRef === b.bookingRef).length;
          const free_ = roomCfg_.persons - occupants_;
          if (free_ > 0) freeSingleBeds_ += free_;
        });
      if (freeSingleBeds_ <= 0)
        return reject("No single bed spots available.");
      data.isPrimaryBooker = true;
      data.roomId = "singlebed";
      data.roomRef = bookingRef;
    }

    if (data.thuExtraNight && data.type !== "room" && data.type !== "singlebed")
      return reject("Thursday extra night is only available with room or single-bed bookings.");

    if (data.type === "dayvisitor") {
      if (!data.dayVisitorDays || !["fri","sat","both"].includes(data.dayVisitorDays))
        return reject("Please select which day(s) you will attend.");
    }

    const price = calculatePrice(data);

    const timestamp = new Date();
    sheet.appendRow([
      timestamp,
      bookingRef,
      callsign,
      data.name,
      data.email,
      data.phone || "",
      data.country || "",
      data.type,
      data.roomId || "",
      data.roomRef || bookingRef,
      data.isPrimaryBooker ? "YES" : "NO",
      data.thuExtraNight ? "YES" : "NO",
      data.fullBoard ? "YES" : "NO",
      data.dietary || "",
      data.shirtSize || "",
      price.total,
      price.breakdown,
      "CONFIRMED",
      "",  // RoomNumber
      "",  // OrgComment
      data.gdprNoPublish ? "NO" : "YES",  // PublishConsent
      data.soloDouble ? "YES" : "NO",     // SoloRoom
      data.dayVisitorDays || "",           // DayVisitorDays
      data.meals ? Object.entries(data.meals).filter(([,v])=>v).map(([k])=>k).join(",") : "", // Meals
      data.freeText || "",                 // FreeText
      "",                                  // IsOrganizer
    ]);

    const webAppUrl = CONFIG.FRIENDLY_URL || CONFIG.WEBAPP_URL;
    sendConfirmationEmail(data, bookingRef, price, webAppUrl);

    if (data.joinExisting && data.roomRef) {
      const primary = bookings.find(b => b.bookingRef === data.roomRef && b.isPrimaryBooker === "YES");
      if (primary && primary.email) {
        sendRoomJoinNotification(primary, data, bookingRef);
        const roomCfg = CONFIG.ROOMS.find(r => r.id === primary.roomId);
        if (roomCfg) {
          const existingJoiners = bookings.filter(b => b.roomRef === data.roomRef && b.isPrimaryBooker !== "YES");
          const occupantsNow = existingJoiners.length + 1 + 1;
          if (occupantsNow >= roomCfg.persons) {
            const allOccupants = [primary].concat(existingJoiners).concat([{
              callsign: data.callsign,
              name: data.name,
              isPrimaryBooker: "NO",
              bookingRef: bookingRef,
            }]);
            sendRoomFullNotification(primary, roomCfg, allOccupants);
          }
        }
      }
    }

    sendOrganizerNotification(data, bookingRef, price);

    logEvent_("OK", "booking_confirmed", data.callsign, `ref=${bookingRef} type=${data.type} price=€${price.total}`);
    return { success: true, bookingRef: bookingRef, price: price };

  } catch (err) {
    Logger.log("submitBooking error: " + err.message + " | stack: " + err.stack);
    logEvent_("ERROR", "submitBooking_exception", (data && data.callsign) || "?", err.message);
    return { success: false, error: "Server error: " + err.message };
  }
}

// =============================================================================
// SETTINGS — stored in Script Properties, override CONFIG defaults
// =============================================================================

function getSettings_() {
  const props = PropertiesService.getScriptProperties();
  return {
    REGISTRATION_OPEN:        (function() {
      var open = props.getProperty('REGISTRATION_OPEN') !== 'false';
      if (open) {
        var closes = props.getProperty('REGISTRATION_CLOSES') || '';
        if (closes) {
          var deadline = new Date(closes + 'T23:59:59');
          if (new Date() > deadline) return false;
        }
      }
      return open;
    })(),
    REGISTRATION_CLOSES:      props.getProperty('REGISTRATION_CLOSES') || '',
    ALLOW_SOLO_DOUBLE:        props.getProperty('ALLOW_SOLO_DOUBLE') === 'true' || CONFIG.ALLOW_SOLO_DOUBLE,
    ALLOW_SINGLE_BED_BOOKING: props.getProperty('ALLOW_SINGLE_BED_BOOKING') === 'true' || CONFIG.ALLOW_SINGLE_BED_BOOKING,
    TENT_ENABLED:             props.getProperty('TENT_ENABLED') !== 'false',  // default on
    ANNOUNCEMENT:             props.getProperty('ANNOUNCEMENT') || '',
    CLOSED_MESSAGE:           props.getProperty('CLOSED_MESSAGE') || '',
    BYPASS_TOKEN:             props.getProperty('BYPASS_TOKEN') || '',
    CAMPER_INFO:              props.getProperty('CAMPER_INFO') !== null && props.getProperty('CAMPER_INFO') !== undefined
                                ? props.getProperty('CAMPER_INFO')
                                : CONFIG.CAMPER_INFO,
    TENT_INFO:                props.getProperty('TENT_INFO') !== null && props.getProperty('TENT_INFO') !== undefined
                                ? props.getProperty('TENT_INFO')
                                : CONFIG.TENT_INFO,
    PRICE_DISCLAIMER:         props.getProperty('PRICE_DISCLAIMER') !== null && props.getProperty('PRICE_DISCLAIMER') !== undefined
                                ? props.getProperty('PRICE_DISCLAIMER')
                                : 'Prices may be updated. You will be notified of any changes affecting your booking.',
    SINGLE_BED_PRICE:         props.getProperty('SINGLE_BED_PRICE') ? parseFloat(props.getProperty('SINGLE_BED_PRICE')) : CONFIG.SINGLE_BED_PRICE,
    SINGLE_BED_SLOTS:         props.getProperty('SINGLE_BED_SLOTS') !== null ? parseInt(props.getProperty('SINGLE_BED_SLOTS')) : CONFIG.SINGLE_BED_SLOTS,
    MEETING_FEE_WEEKEND:      props.getProperty('MEETING_FEE_WEEKEND') ? parseFloat(props.getProperty('MEETING_FEE_WEEKEND')) : CONFIG.MEETING_FEE_WEEKEND,
    MEETING_FEE_DAY:          props.getProperty('MEETING_FEE_DAY') ? parseFloat(props.getProperty('MEETING_FEE_DAY')) : CONFIG.MEETING_FEE_DAY,
    MEAL_FRI_BBQ:             props.getProperty('MEAL_FRI_BBQ') ? parseFloat(props.getProperty('MEAL_FRI_BBQ')) : CONFIG.MEAL_FRI_BBQ,
    MEAL_SAT_HAM_DINNER:      props.getProperty('MEAL_SAT_HAM_DINNER') ? parseFloat(props.getProperty('MEAL_SAT_HAM_DINNER')) : CONFIG.MEAL_SAT_HAM_DINNER,
    MEAL_LUNCH:               props.getProperty('MEAL_LUNCH') ? parseFloat(props.getProperty('MEAL_LUNCH')) : CONFIG.MEAL_LUNCH,
    THU_EXTRA_NIGHT_PRICE:    props.getProperty('THU_EXTRA_NIGHT_PRICE') !== null && props.getProperty('THU_EXTRA_NIGHT_PRICE') !== ''
                                ? parseFloat(props.getProperty('THU_EXTRA_NIGHT_PRICE'))
                                : CONFIG.THU_EXTRA_NIGHT_PRICE,
    FULL_BOARD_PRICE:         props.getProperty('FULL_BOARD_PRICE') ? parseFloat(props.getProperty('FULL_BOARD_PRICE')) : CONFIG.FULL_BOARD_PRICE,
    CAMPER_VAN_PRICE_PER_NIGHT: props.getProperty('CAMPER_VAN_PRICE_PER_NIGHT') ? parseFloat(props.getProperty('CAMPER_VAN_PRICE_PER_NIGHT')) : CONFIG.CAMPER_VAN_PRICE_PER_NIGHT,
    TENT_PRICE_WEEKEND:       props.getProperty('TENT_PRICE_WEEKEND') ? parseFloat(props.getProperty('TENT_PRICE_WEEKEND')) : CONFIG.TENT_PRICE_WEEKEND,
    ROOM_PRICES: CONFIG.ROOMS.reduce((acc, r) => {
      const stored = props.getProperty('ROOM_PRICE_' + r.id);
      acc[r.id] = stored !== null ? parseFloat(stored) : r.price_eur;
      return acc;
    }, {}),
    ROOM_PRICES: CONFIG.ROOMS.reduce((acc, r) => {
      const stored = props.getProperty('ROOM_PRICE_' + r.id);
      acc[r.id] = stored !== null ? parseFloat(stored) : r.price_eur;
      return acc;
    }, {}),
    ROOM_COUNTS: CONFIG.ROOMS.reduce((acc, r) => {
      const stored = props.getProperty('ROOM_COUNT_' + r.id);
      acc[r.id] = stored !== null ? parseInt(stored, 10) : r.count;
      return acc;
    }, {}),
    CAMPER_VAN_SPOTS: props.getProperty('CAMPER_VAN_SPOTS') !== null ? parseInt(props.getProperty('CAMPER_VAN_SPOTS'), 10) : CONFIG.CAMPER_VAN_SPOTS,
    TENT_SPOTS:       props.getProperty('TENT_SPOTS')       !== null ? parseInt(props.getProperty('TENT_SPOTS'),       10) : CONFIG.TENT_SPOTS,
  };
}

function getAdminSettings(pw) {
  if (pw !== CONFIG.ADMIN_PASSWORD) return { success: false, error: 'Wrong password' };
  return { success: true, settings: getSettings_() };
}

function saveAdminSettings(pw, settings) {
  if (pw !== CONFIG.ADMIN_PASSWORD) return { success: false, error: 'Wrong password' };
  try {
    const props = PropertiesService.getScriptProperties();
    if (settings.REGISTRATION_OPEN !== undefined) props.setProperty('REGISTRATION_OPEN', settings.REGISTRATION_OPEN ? 'true' : 'false');
    if (settings.REGISTRATION_CLOSES !== undefined) props.setProperty('REGISTRATION_CLOSES', settings.REGISTRATION_CLOSES || '');
    if (settings.ALLOW_SOLO_DOUBLE !== undefined) props.setProperty('ALLOW_SOLO_DOUBLE', settings.ALLOW_SOLO_DOUBLE ? 'true' : 'false');
    if (settings.ALLOW_SINGLE_BED_BOOKING !== undefined) props.setProperty('ALLOW_SINGLE_BED_BOOKING', settings.ALLOW_SINGLE_BED_BOOKING ? 'true' : 'false');
    if (settings.SINGLE_BED_PRICE) props.setProperty('SINGLE_BED_PRICE', String(parseFloat(settings.SINGLE_BED_PRICE)));
    if (settings.SINGLE_BED_SLOTS !== undefined && settings.SINGLE_BED_SLOTS !== '') props.setProperty('SINGLE_BED_SLOTS', String(parseInt(settings.SINGLE_BED_SLOTS)));
    if (settings.MEETING_FEE_WEEKEND !== undefined && settings.MEETING_FEE_WEEKEND !== '') props.setProperty('MEETING_FEE_WEEKEND', String(parseFloat(settings.MEETING_FEE_WEEKEND)));
    if (settings.MEETING_FEE_DAY !== undefined && settings.MEETING_FEE_DAY !== '') props.setProperty('MEETING_FEE_DAY', String(parseFloat(settings.MEETING_FEE_DAY)));
    if (settings.MEAL_FRI_BBQ !== undefined && settings.MEAL_FRI_BBQ !== '') props.setProperty('MEAL_FRI_BBQ', String(parseFloat(settings.MEAL_FRI_BBQ)));
    if (settings.MEAL_SAT_HAM_DINNER !== undefined && settings.MEAL_SAT_HAM_DINNER !== '') props.setProperty('MEAL_SAT_HAM_DINNER', String(parseFloat(settings.MEAL_SAT_HAM_DINNER)));
    if (settings.MEAL_LUNCH !== undefined && settings.MEAL_LUNCH !== '') props.setProperty('MEAL_LUNCH', String(parseFloat(settings.MEAL_LUNCH)));
    if (settings.THU_EXTRA_NIGHT_PRICE !== undefined) {
      if (settings.THU_EXTRA_NIGHT_PRICE !== null && settings.THU_EXTRA_NIGHT_PRICE !== '') {
        props.setProperty('THU_EXTRA_NIGHT_PRICE', String(parseFloat(settings.THU_EXTRA_NIGHT_PRICE)));
      } else {
        props.deleteProperty('THU_EXTRA_NIGHT_PRICE');
      }
    }
    if (settings.TENT_ENABLED !== undefined) props.setProperty('TENT_ENABLED', settings.TENT_ENABLED ? 'true' : 'false');
    if (settings.ANNOUNCEMENT    !== undefined) props.setProperty('ANNOUNCEMENT',    settings.ANNOUNCEMENT);
    if (settings.CLOSED_MESSAGE  !== undefined) props.setProperty('CLOSED_MESSAGE',  settings.CLOSED_MESSAGE);
    if (settings.BYPASS_TOKEN    !== undefined) props.setProperty('BYPASS_TOKEN',     settings.BYPASS_TOKEN);
    if (settings.CAMPER_INFO  !== undefined) props.setProperty('CAMPER_INFO',  settings.CAMPER_INFO);
    if (settings.TENT_INFO    !== undefined) props.setProperty('TENT_INFO',    settings.TENT_INFO);
    if (settings.PRICE_DISCLAIMER !== undefined) props.setProperty('PRICE_DISCLAIMER', settings.PRICE_DISCLAIMER);
    if (settings.FULL_BOARD_PRICE) props.setProperty('FULL_BOARD_PRICE', String(parseFloat(settings.FULL_BOARD_PRICE)));
    if (settings.CAMPER_VAN_PRICE_PER_NIGHT) props.setProperty('CAMPER_VAN_PRICE_PER_NIGHT', String(parseFloat(settings.CAMPER_VAN_PRICE_PER_NIGHT)));
    if (settings.TENT_PRICE_WEEKEND) props.setProperty('TENT_PRICE_WEEKEND', String(parseFloat(settings.TENT_PRICE_WEEKEND)));
    if (settings.ROOM_COUNTS && typeof settings.ROOM_COUNTS === 'object') {
      CONFIG.ROOMS.forEach(r => {
        const v = settings.ROOM_COUNTS[r.id];
        if (v !== undefined && v !== '' && !isNaN(parseInt(v, 10))) {
          props.setProperty('ROOM_COUNT_' + r.id, String(Math.max(0, parseInt(v, 10))));
        }
      });
    }
    if (settings.CAMPER_VAN_SPOTS !== undefined && settings.CAMPER_VAN_SPOTS !== '' && !isNaN(parseInt(settings.CAMPER_VAN_SPOTS, 10))) {
      props.setProperty('CAMPER_VAN_SPOTS', String(Math.max(0, parseInt(settings.CAMPER_VAN_SPOTS, 10))));
    }
    if (settings.TENT_SPOTS !== undefined && settings.TENT_SPOTS !== '' && !isNaN(parseInt(settings.TENT_SPOTS, 10))) {
      props.setProperty('TENT_SPOTS', String(Math.max(0, parseInt(settings.TENT_SPOTS, 10))));
    }
    if (settings.ROOM_PRICES && typeof settings.ROOM_PRICES === 'object') {
      CONFIG.ROOMS.forEach(r => {
        const v = settings.ROOM_PRICES[r.id];
        if (v !== undefined && v !== '' && !isNaN(parseFloat(v))) {
          props.setProperty('ROOM_PRICE_' + r.id, String(Math.max(0, parseFloat(v))));
        }
      });
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function checkAdminPassword(pw) {
  return pw === CONFIG.ADMIN_PASSWORD;
}

function recalcAllPrices(pw) {
  if (pw !== CONFIG.ADMIN_PASSWORD)
    return { success: false, error: "Wrong password" };
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = function(col) { return headers.indexOf(col); };
  const activeStatuses = ['CONFIRMED','CHECKED_IN','NEEDS_ATTENTION'];
  var updated = 0;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!activeStatuses.includes(row[idx('Status')])) continue;
    var fakeBooking = {
      type:            row[idx('Type')],
      roomId:          row[idx('RoomId')],
      isPrimaryBooker: row[idx('IsPrimaryBooker')] === 'YES',
      thuExtraNight:   row[idx('ThuExtraNight')]   === 'YES',
      fullBoard:       row[idx('FullBoard')]        === 'YES',
      soloRoom:        row[idx('SoloRoom')]         === 'YES',
      dayVisitorDays:  row[idx('DayVisitorDays')]   || '',
      meals:           row[idx('Meals')]            || '',
    };
    var newPrice = calculatePrice(fakeBooking);
    sheet.getRange(i + 1, idx('TotalPrice')    + 1).setValue(newPrice.total);
    sheet.getRange(i + 1, idx('PriceBreakdown')+ 1).setValue(newPrice.breakdown);
    updated++;
  }
  return { success: true, updated: updated };
}

function getAdminData(pw) {
  try {
    Logger.log("getAdminData: called");
    if (pw !== CONFIG.ADMIN_PASSWORD) {
      Logger.log("getAdminData: wrong password");
      return { success: false, error: "Wrong password" };
    }
    Logger.log("getAdminData: password ok, getting sheet");
    const sheet = getSheet();
    Logger.log("getAdminData: got sheet: " + sheet.getName());
    const data = sheet.getDataRange().getValues();
    Logger.log("getAdminData: rows=" + data.length + " headers=" + JSON.stringify(data[0]));
    if (data.length <= 1) return { success: true, rows: [], headers: data[0] || [] };

    const headers = data[0].map(h => String(h));
    const rows = data.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => {
        const v = r[i];
        if (v instanceof Date) {
          obj[h] = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
        } else if (v === null || v === undefined) {
          obj[h] = "";
        } else {
          obj[h] = String(v);
        }
      });
      return obj;
    });
    Logger.log("getAdminData: returning " + rows.length + " rows");
    const adminSettings = getSettings_();
    const confirmedBookings = getConfirmedBookings(sheet);
    const bookedByType = {};
    CONFIG.ROOMS.forEach(r => {
      bookedByType[r.id] = confirmedBookings.filter(b => b.roomId === r.id && b.isPrimaryBooker === 'YES').length;
    });
    return { success: true, rows: rows, headers: headers,
      rooms: CONFIG.ROOMS,
      roomPrices: adminSettings.ROOM_PRICES || {},
      bookedByType: bookedByType };
  } catch(e) {
    Logger.log("getAdminData ERROR: " + e.message + " | stack: " + e.stack);
    return { success: false, error: "getAdminData error: " + e.message };
  }
}

function updateBooking(pw, bookingRef, fields, sendEmail) {
  if (pw !== CONFIG.ADMIN_PASSWORD)
    return { success: false, error: "Wrong password" };
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rowIdx = data.slice(1).findIndex(r => r[headers.indexOf("BookingRef")] === bookingRef);
  if (rowIdx === -1) return { success: false, error: "Booking not found: " + bookingRef };

  const editableFields = [
    "Callsign","Name","Email","Phone","Country","Type","RoomId","RoomRef",
    "IsPrimaryBooker","ThuExtraNight","FullBoard","Dietary","Status",
    "RoomNumber","OrgComment","PublishConsent","SoloRoom","FreeText","IsOrganizer","DayVisitorDays"
  ];
  const sheetRow = rowIdx + 2;
  editableFields.forEach(function(field) {
    if (fields.hasOwnProperty(field)) {
      const colIdx = headers.indexOf(field);
      if (colIdx !== -1) {
        sheet.getRange(sheetRow, colIdx + 1).setValue(fields[field]);
      }
    }
  });

  if (fields.hasOwnProperty("RoomNumber")) {
    const roomNumColIdx = headers.indexOf("RoomNumber");
    const roomRefColIdx = headers.indexOf("RoomRef");
    const isPrimaryColIdx = headers.indexOf("IsPrimaryBooker");
    const bookingRefColIdx = headers.indexOf("BookingRef");
    const thisRow = data[rowIdx + 1];
    const thisRoomRef = thisRow[roomRefColIdx];
    const thisIsPrimary = thisRow[isPrimaryColIdx] === "YES";
    const canonicalRoomRef = thisIsPrimary ? bookingRef : thisRoomRef;

    data.slice(1).forEach(function(row, i) {
      const rowRef  = row[bookingRefColIdx];
      const rowRoomRef = row[roomRefColIdx];
      const rowIsPrimary = row[isPrimaryColIdx] === "YES";
      const inGroup = (rowRef === canonicalRoomRef) || (rowRoomRef === canonicalRoomRef && !rowIsPrimary);
      if (inGroup && rowRef !== bookingRef) {
        sheet.getRange(i + 2, roomNumColIdx + 1).setValue(fields["RoomNumber"]);
      }
    });
  }

  const priceFields = ['FullBoard','ThuExtraNight','Type','RoomId','IsPrimaryBooker','SoloRoom'];
  const needsRecalc = priceFields.some(function(f) { return fields.hasOwnProperty(f); });
  if (needsRecalc) {
    // Build a fake booking object from current + updated fields
    const currentRow = data[rowIdx + 1];
    const get = function(col) {
      var updated = fields.hasOwnProperty(col) ? fields[col] : currentRow[headers.indexOf(col)];
      return updated;
    };
    const fakeBooking = {
      type:           get('Type'),
      roomId:         get('RoomId'),
      isPrimaryBooker: get('IsPrimaryBooker') === 'YES',
      thuExtraNight:  get('ThuExtraNight') === 'YES',
      fullBoard:      get('FullBoard') === 'YES',
      soloRoom:       get('SoloRoom') === 'YES',
      dayVisitorDays: get('DayVisitorDays'),
      meals:          get('Meals') || '',
    };
    const newPrice = calculatePrice(fakeBooking);
    sheet.getRange(sheetRow, headers.indexOf('TotalPrice') + 1).setValue(newPrice.total);
    sheet.getRange(sheetRow, headers.indexOf('PriceBreakdown') + 1).setValue(newPrice.breakdown);
  }

  // Send change notification email if requested
  if (sendEmail) {
    try {
      const currentRow = data[rowIdx + 1];
      const get = function(col) {
        return fields.hasOwnProperty(col) ? fields[col] : currentRow[headers.indexOf(col)];
      };
      const guestEmail = get('Email');
      const guestName  = get('Name');
      const callsign   = get('Callsign');
      if (guestEmail) {
        const settings  = getSettings_();
        const priceData = needsRecalc
          ? calculatePrice({
              type:           get('Type'), roomId: get('RoomId'),
              isPrimaryBooker:get('IsPrimaryBooker') === 'YES',
              thuExtraNight:  get('ThuExtraNight') === 'YES',
              fullBoard:      get('FullBoard') === 'YES',
              soloRoom:       get('SoloRoom') === 'YES',
              dayVisitorDays: get('DayVisitorDays') || '',
              meals:          get('Meals') || '',
            })
          : { total: currentRow[headers.indexOf('TotalPrice')], breakdown: currentRow[headers.indexOf('PriceBreakdown')] };

        const changedFields = Object.keys(fields).filter(function(k) {
          return k !== 'OrgComment' && k !== 'RoomNumber' && k !== 'FreeText';
        });

        const subject = '[Nordic VUSHF 2026] Booking updated — ' + bookingRef;
        const body = 'Dear ' + guestName + ' (' + callsign + '),\n\n'
          + 'Your booking has been updated by the organizer.\n\n'
          + 'Booking reference: ' + bookingRef + '\n'
          + 'Updated fields: ' + changedFields.join(', ') + '\n\n'
          + '─────────────────────────────────────────\n'
          + 'CURRENT SERVICES\n'
          + '─────────────────────────────────────────\n'
          + (priceData.breakdown || '').replace(/ \| /g, '\n') + '\n\n'
          + 'TOTAL: €' + priceData.total + '\n\n'
          + '─────────────────────────────────────────\n'
          + 'If you have questions, please contact us: ' + CONFIG.REPLY_TO_EMAIL + '\n\n'
          + CONFIG.ORGANIZER;

        GmailApp.sendEmail(guestEmail, subject, body, {
          replyTo: CONFIG.REPLY_TO_EMAIL,
          name: CONFIG.EMAIL_SENDER_NAME || CONFIG.ORGANIZER,
        });
      }
    } catch(emailErr) {
      // Don't fail the save if email fails
      Logger.log('Change notification email failed: ' + emailErr.message);
    }
  }

  const newStatus = fields.Status;
  const isPrimary = data[rowIdx + 1][headers.indexOf("IsPrimaryBooker")] === "YES";
  const bookingType = data[rowIdx + 1][headers.indexOf("Type")];
  if (newStatus === "CANCELLED" && isPrimary && bookingType === "room") {
    const allData = sheet.getDataRange().getValues();
    const allHeaders = allData[0];
    const roommates = allData.slice(1).filter(r =>
      r[allHeaders.indexOf("RoomRef")] === bookingRef &&
      r[allHeaders.indexOf("IsPrimaryBooker")] !== "YES" &&
      r[allHeaders.indexOf("Status")] !== "CANCELLED"
    );
    roommates.forEach(function(rm) {
      const rmEmail = rm[allHeaders.indexOf("Email")];
      const rmName  = rm[allHeaders.indexOf("Name")];
      const rmCall  = rm[allHeaders.indexOf("Callsign")];
      const rmRef   = rm[allHeaders.indexOf("BookingRef")];
      const rmRowIdx = allData.slice(1).findIndex(r => r[allHeaders.indexOf("BookingRef")] === rmRef);
      if (rmRowIdx !== -1) {
        sheet.getRange(rmRowIdx + 2, allHeaders.indexOf("Status") + 1).setValue("NEEDS_ATTENTION");
        sheet.getRange(rmRowIdx + 2, allHeaders.indexOf("OrgComment") + 1).setValue("Primary booker " + bookingRef + " was cancelled — needs reassignment");
      }
      if (rmEmail) {
        try {
          MailApp.sendEmail({
            to: rmEmail,
            replyTo: CONFIG.REPLY_TO_EMAIL,
            name: CONFIG.EMAIL_SENDER_NAME,
            subject: "Nordic VUSHF 2026 — Your room booking needs attention",
            body: (function() {
                var NL = "\n";
                return "Dear " + rmName + " (" + rmCall.toUpperCase() + ")," + NL + NL +
                  "The primary booker of your room (" + bookingRef + ") has had their booking cancelled." + NL +
                  "Your booking (" + rmRef + ") has been flagged as NEEDS_ATTENTION." + NL + NL +
                  "Please contact the organizers at " + CONFIG.REPLY_TO_EMAIL + " to arrange a new room or alternative." + NL + NL +
                  "Nordic VUSHF 2026 / RATS";
              })()
          });
        } catch(mailErr) {
          Logger.log("Cascade email failed for " + rmRef + ": " + mailErr.message);
        }
      }
    });
    return { success: true, cascadedCount: roommates.length };
  }

  return { success: true, cascadedCount: 0 };
}

// =============================================================================
// HELPERS
// =============================================================================

function getSheet() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch(e) { ss = null; }
  if (!ss) {
    const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
    if (!id) throw new Error("SHEET_ID not set in Script Properties");
    ss = SpreadsheetApp.openById(id);
  }
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = setupSpreadsheet_(ss);
  return sheet;
}

function getLogSheet_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch(e) { ss = null; }
  if (!ss) {
    const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
    if (!id) return null;
    ss = SpreadsheetApp.openById(id);
  }
  let log = ss.getSheetByName("Log");
  if (!log) {
    log = ss.insertSheet("Log");
    log.appendRow(["Timestamp", "Level", "Event", "Callsign", "Detail"]);
    log.getRange(1, 1, 1, 5).setFontWeight("bold");
    log.setFrozenRows(1);
  }
  return log;
}

function logEvent_(level, event, callsign, detail) {
  try {
    const log = getLogSheet_();
    if (!log) return;
    log.appendRow([new Date(), level, event, callsign || "", detail || ""]);
  } catch(e) {
    // Never let logging crash the main flow
  }
}

function getConfirmedBookings(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  const activeStatuses = ['CONFIRMED', 'CHECKED_IN', 'NEEDS_ATTENTION'];
  return data.slice(1)
    .filter(r => activeStatuses.includes(r[headers.indexOf("Status")]))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => obj[toCamel(h)] = r[i]);
      return obj;
    });
}

function getAllActiveBookings_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1)
    .filter(r => r[headers.indexOf("Status")] !== "CANCELLED")
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => obj[toCamel(h)] = r[i]);
      return obj;
    });
}

function toCamel(str) {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function calculatePrice(data) {
  let total = 0;
  const lines = [];
  const s = getSettings_();

  if (data.type === "room") {
    const roomCfg = CONFIG.ROOMS.find(r => r.id === data.roomId);
    if (roomCfg) {
      const roomPrice = (s.ROOM_PRICES && s.ROOM_PRICES[roomCfg.id] !== undefined) ? s.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur;
      const pricePerPerson = Math.round(roomPrice / roomCfg.persons);
      total += pricePerPerson;
      lines.push(`Room (${roomCfg.note_en}): €${pricePerPerson}/person (room total €${roomPrice})`);
      if (data.thuExtraNight) {
        const thuRoomPrice = Math.round(roomPrice / 2);
        const thuPP = Math.round(thuRoomPrice / roomCfg.persons);
        total += thuPP;
        lines.push(`Thu extra night (incl. Fri breakfast): €${thuPP}/person (room night €${thuRoomPrice})`);
      }
    }
  } else if (data.type === "camper") {
    if (!data.joinExisting) {
      const camperTotal = s.CAMPER_VAN_PRICE_PER_NIGHT * CONFIG.CAMPING_NIGHTS;
      total += camperTotal;
      lines.push(`Camper van spot (${CONFIG.CAMPING_NIGHTS} nights, incl. electricity): €${camperTotal}`);
    } else {
      lines.push(`Camper van spot: shared with primary booker (costs split separately)`);
    }
    total += s.MEETING_FEE_WEEKEND;
    lines.push(`Meeting fee (full weekend): €${s.MEETING_FEE_WEEKEND}`);
    if (data.fullBoard) {
      total += s.FULL_BOARD_PRICE;
      lines.push(`Full board meal package: €${s.FULL_BOARD_PRICE}`);
    }
  } else if (data.type === "tent") {
    total += s.TENT_PRICE_WEEKEND;
    lines.push(`Tent spot (weekend): €${s.TENT_PRICE_WEEKEND}`);
    total += s.MEETING_FEE_WEEKEND;
    lines.push(`Meeting fee (full weekend): €${s.MEETING_FEE_WEEKEND}`);
    if (data.fullBoard) {
      total += s.FULL_BOARD_PRICE;
      lines.push(`Full board meal package: €${s.FULL_BOARD_PRICE}`);
    }
  } else if (data.type === "singlebed") {
    total += s.SINGLE_BED_PRICE;
    lines.push(`Single bed (organizer-assigned room): €${s.SINGLE_BED_PRICE}`);
    if (data.thuExtraNight) {
      const thuPrice = Math.round(s.SINGLE_BED_PRICE / 2);
      total += thuPrice;
      lines.push(`Thu extra night (incl. Fri breakfast): €${thuPrice}`);
    }
  } else if (data.type === "dayvisitor") {
    if (data.dayVisitorDays === "both") {
      total += s.MEETING_FEE_WEEKEND;
      lines.push(`Meeting fee (Fri + Sat): €${s.MEETING_FEE_WEEKEND}`);
    } else {
      const dayLabel = data.dayVisitorDays === "fri" ? "Friday" : "Saturday";
      total += s.MEETING_FEE_DAY;
      lines.push(`Meeting fee (${dayLabel}): €${s.MEETING_FEE_DAY}`);
    }
    if (data.fullBoard) {
      total += s.FULL_BOARD_PRICE;
      lines.push(`Full board meal package: €${s.FULL_BOARD_PRICE}`);
    }
  }

  if (data.type === "room" || data.type === "singlebed") {
    if (data.fullBoard) {
      total += s.FULL_BOARD_PRICE;
      lines.push(`Full board meal package: €${s.FULL_BOARD_PRICE}`);
    }
    total += s.MEETING_FEE_WEEKEND;
    lines.push(`Meeting fee (full weekend): €${s.MEETING_FEE_WEEKEND}`);
  }

  return { total: total, breakdown: lines.join(" | ") };
}

function sendConfirmationEmail(data, bookingRef, price, webAppUrl) {
  const callsign = data.callsign.toUpperCase();
  const emailSettings = getSettings_();
  let roomCfg = data.roomId ? CONFIG.ROOMS.find(r => r.id === data.roomId) : null;
  let primaryBooker_ = null;
  if (!roomCfg && data.roomRef) {
    const sheet = getSheet();
    const primary = getConfirmedBookings(sheet).find(b => b.bookingRef === data.roomRef && b.isPrimaryBooker === "YES");
    if (primary && primary.roomId) roomCfg = CONFIG.ROOMS.find(r => r.id === primary.roomId);
    primaryBooker_ = primary || null;
  } else if (data.roomRef && !data.isPrimaryBooker) {
    const sheet = getSheet();
    primaryBooker_ = getConfirmedBookings(sheet).find(b => b.bookingRef === data.roomRef && b.isPrimaryBooker === "YES") || null;
  }
  const liveRoomPrice = roomCfg
    ? ((emailSettings.ROOM_PRICES && emailSettings.ROOM_PRICES[roomCfg.id] !== undefined)
        ? emailSettings.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur)
    : null;
  const mealLines = CONFIG.FULL_BOARD_INCLUDES_EN
    .filter(l => (data.type === 'room' || data.type === 'singlebed') ? true : !l.toLowerCase().includes('breakfast is included in all room'))
    .map(l => `  • ${l}`).join("\n");

  const subject = `[Nordic VUSHF 2026] Booking confirmation — ${bookingRef}`;

  const body = `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  NORDIC VUSHF MEETING 2026
  BOOKING CONFIRMATION
  ${CONFIG.LOCATION}
  ${CONFIG.DATE_FRI} \u2013 ${CONFIG.DATE_SUN}
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Dear ${data.name},

Your booking has been confirmed!

BOOKING REFERENCE: ${bookingRef}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
GUEST DETAILS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Callsign : ${callsign}
Name     : ${data.name}
Email    : ${data.email}
${data.phone ? `Phone    : ${data.phone}` : ""}
${data.country ? `Country  : ${data.country}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.type === "dayvisitor" ? "ATTENDANCE" : "ACCOMMODATION"}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.type === "dayvisitor" ? `Type     : Day visitor (no overnight accommodation)
Days     : ${data.dayVisitorDays === "both" ? "Friday 15.5 + Saturday 16.5" : data.dayVisitorDays === "fri" ? "Friday 15.5 only" : "Saturday 16.5 only"}` : `Type     : ${data.type === "room" ? (roomCfg ? roomCfg.note_en : "Room") : data.type === "camper" ? "Camper van spot" : data.type === "tent" ? "Tent" : data.type}
${data.type === "camper" ? `\n${emailSettings.CAMPER_INFO}` : ""}${data.type === "tent" ? `\n${emailSettings.TENT_INFO}` : ""}
${data.isPrimaryBooker && data.type === "room" ? `Room ref : ${bookingRef}

! IMPORTANT — SHARING YOUR ROOM !
Anyone joining your room MUST use one of these options:

  1) Use "Join a booking" on the booking page and enter your
     booking reference: ${bookingRef}

  2) Or use this direct join link (pre-fills the reference):
     ${webAppUrl}?join=${encodeURIComponent(bookingRef)}

Roommates who do NOT use the join option will be registered
as separate guests and may be assigned a different room.` : ""}
${data.isPrimaryBooker && data.type === "camper" ? `Spot ref : ${bookingRef}

! IMPORTANT — SHARING YOUR CAMPER SPOT !
Anyone travelling in the same vehicle MUST use one of these options:

  1) Use "Join a booking" on the booking page and enter your
     booking reference: ${bookingRef}

  2) Or use this direct join link (pre-fills the reference):
     ${webAppUrl}?join=${encodeURIComponent(bookingRef)}

Co-travellers who do NOT use the join option will be registered
as separate camper spots.` : ""}
${!data.isPrimaryBooker ? `Joining ${data.type === 'camper' ? 'camper spot' : 'room'}: ${data.roomRef}${primaryBooker_ ? " — booked by " + primaryBooker_.callsign.toUpperCase() + " " + primaryBooker_.name : ""}` : ""}
${data.thuExtraNight ? `Thu extra night: YES (${CONFIG.THU_EXTRA_INCLUDES})` : ""}`}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ORDERED SERVICES
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${price.breakdown.split(" | ").join("\n")}

${data.fullBoard ? `Meal package includes:\n${mealLines}` : "Meal package: No"}
${!data.fullBoard && data.meals && Object.values(data.meals).some(Boolean) ? `Individual meals:\n${[
  data.meals.friBbq   ? '  • Friday BBQ dinner' : '',
  data.meals.friLunch ? '  • Friday lunch' : '',
  data.meals.satLunch ? '  • Saturday lunch' : '',
  data.meals.satHam   ? '  • Saturday Ham Dinner' : '',
].filter(Boolean).join('\n')}` : ""}

${data.dietary ? `Dietary requirements: ${data.dietary}` : ""}
${data.shirtSize ? `T-shirt size: ${data.shirtSize}` : ""}
${data.freeText ? `\nAdditional information sent:\n${data.freeText}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
TOTAL: \u20AC${price.total}
${emailSettings.THU_EXTRA_NIGHT_PRICE === null && data.thuExtraNight ? "(+ Thu extra night TBD — to be confirmed separately)" : ""}
${emailSettings.PRICE_DISCLAIMER ? `\n* ${emailSettings.PRICE_DISCLAIMER}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
PAYMENT
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
All payments are to be completed upon arrival at the venue.

Accepted payment methods:
  • Cash
  • Debit and credit cards (Visa, Mastercard)
  x No Amex or Diners Club

${data.isPrimaryBooker && data.type === "room" && roomCfg ? `NOTE: The room total is \u20AC${liveRoomPrice}. As the room booker you are responsible for settling the room costs with your roommates.` : ""}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

CHECK-IN: ${CONFIG.CHECKIN_TIME}
CHECK-OUT: ${CONFIG.CHECKOUT_TIME}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
If you have any questions, please contact us:
meeting@rats.fi

73,
${CONFIG.EMAIL_SENDER_NAME}
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
`.trim();

  GmailApp.sendEmail(data.email, subject, body, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL,
  });
}

function sendRoomJoinNotification(primary, joiner, joinerRef) {
  const joinerCallsign = joiner.callsign.toUpperCase();
  const roomCfg = primary.roomId ? CONFIG.ROOMS.find(r => r.id === primary.roomId) : null;
  const s = getSettings_();
  const liveRoomPrice = roomCfg
    ? ((s.ROOM_PRICES && s.ROOM_PRICES[roomCfg.id] !== undefined) ? s.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur)
    : null;
  const subject = `[Nordic VUSHF 2026] ${joinerCallsign} has joined your room — ${primary.bookingRef}`;

  const body = `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  NORDIC VUSHF MEETING 2026 — ROOM NOTICE
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Dear ${primary.name},

${joinerCallsign} (${joiner.name}) has joined your room booking.

Booking reference  : ${primary.bookingRef}
Their reference    : ${joinerRef}
${roomCfg ? `Room type          : ${roomCfg.note_en}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ROOM COSTS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${roomCfg ? `Room total price : \u20AC${liveRoomPrice}\nPer person (${roomCfg.persons} persons) : \u20AC${Math.round(liveRoomPrice / roomCfg.persons)}` : ""}

IMPORTANT: As the primary room booker, you are responsible
for settling the total room cost with your roommates.
Please agree amongst yourselves who pays what upon arrival.

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
PAYMENT
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
All payments are completed upon arrival at the venue.
Accepted: Cash, Visa, Mastercard
Not accepted: Amex, Diners Club
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

If you have any questions, please contact us: meeting@rats.fi

73,
${CONFIG.EMAIL_SENDER_NAME}
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
`.trim();

  GmailApp.sendEmail(primary.email, subject, body, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL,
  });
}

// =============================================================================
// ORGANIZER NOTIFICATION EMAIL
// =============================================================================
function sendRoomFullNotification(primary, roomCfg, allOccupants) {
  const s = getSettings_();
  const liveRoomPrice = (s.ROOM_PRICES && s.ROOM_PRICES[roomCfg.id] !== undefined) ? s.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur;
  const occupantList = allOccupants.map((b, i) =>
    `  ${i+1}. ${b.callsign.toUpperCase()} — ${b.name}${b.isPrimaryBooker === "YES" ? " (primary booker)" : ""}`
  ).join("\n");

  const bodyCore = `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  NORDIC VUSHF MEETING 2026 — ROOM NOTICE
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Room full!

Booking reference : ${primary.bookingRef}
Room type         : ${roomCfg.note_en}
Capacity          : ${roomCfg.persons} persons

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ROOM OCCUPANTS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${occupantList}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ROOM COSTS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Room total price : \u20AC${liveRoomPrice}
Per person       : \u20AC${Math.round(liveRoomPrice / roomCfg.persons)}
`.trim();

  const subjectPrimary = `[Nordic VUSHF 2026] Your room is full! — ${primary.bookingRef}`;
  const bodyPrimary = `${bodyCore}

All spots in your room have now been booked.

IMPORTANT: As the primary room booker, you are responsible
for settling the total room cost with your roommates.
Please agree amongst yourselves who pays what upon arrival.

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
If you have any questions, please contact us: meeting@rats.fi

73,
${CONFIG.EMAIL_SENDER_NAME}
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`;

  GmailApp.sendEmail(primary.email, subjectPrimary, bodyPrimary, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL,
  });

  const subjectOrg = `[Nordic VUSHF 2026] Room full: ${primary.bookingRef} — ${roomCfg.note_en}`;
  const bodyOrg = `${bodyCore}

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`;

  GmailApp.sendEmail(CONFIG.REPLY_TO_EMAIL, subjectOrg, bodyOrg, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL,
  });
}

function sendOrganizerNotification(data, bookingRef, price) {
  const callsign = data.callsign.toUpperCase();
  const roomCfg = data.roomId ? CONFIG.ROOMS.find(r => r.id === data.roomId) : null;
  const orgSettings = getSettings_();
  const mealLines = CONFIG.FULL_BOARD_INCLUDES_EN
    .filter(l => (data.type === 'room' || data.type === 'singlebed') ? true : !l.toLowerCase().includes('breakfast is included in all room'))
    .map(l => `  • ${l}`).join("\n");

  const subject = `[Nordic VUSHF 2026] New booking: ${callsign} — ${bookingRef}`;

  const body = `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  NORDIC VUSHF MEETING 2026 — NEW BOOKING NOTIFICATION
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

New booking received:

BOOKING REFERENCE: ${bookingRef}
Timestamp: ${new Date().toISOString()}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
GUEST DETAILS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Callsign : ${callsign}
Name     : ${data.name}
Email    : ${data.email}
Phone    : ${data.phone || "\u2014"}
Country  : ${data.country || "\u2014"}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.type === "dayvisitor" ? "ATTENDANCE" : "ACCOMMODATION"}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.type === "dayvisitor" ? `Type     : Day visitor (no overnight accommodation)
Days     : ${data.dayVisitorDays === "both" ? "Friday 15.5 + Saturday 16.5" : data.dayVisitorDays === "fri" ? "Friday 15.5 only" : "Saturday 16.5 only"}` : `Type     : ${data.type === "room" ? (roomCfg ? roomCfg.note_en : "Room") : data.type === "camper" ? "Camper van" : data.type === "tent" ? "Tent" : data.type}
${data.type === "room" && data.isPrimaryBooker ? `Role     : Primary booker (room holder)` : ""}
${data.type === "room" && !data.isPrimaryBooker ? `Role     : Joining existing room: ${data.roomRef}` : ""}
Thu extra night: ${data.thuExtraNight ? "YES" : "No"}`}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ORDERED SERVICES
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${price.breakdown.split(" | ").join("\n")}

Meal package: ${data.fullBoard ? "YES" : "No"}
${data.fullBoard ? `${mealLines}` : ""}
${!data.fullBoard && data.meals && Object.values(data.meals).some(Boolean) ? `Individual meals: ${[
  data.meals.friBbq   ? 'Fri BBQ' : '',
  data.meals.friLunch ? 'Fri lunch' : '',
  data.meals.satLunch ? 'Sat lunch' : '',
  data.meals.satHam   ? 'Sat Ham Dinner' : '',
].filter(Boolean).join(', ')}` : ""}
Dietary: ${data.dietary || "\u2014"}
T-shirt size: ${data.shirtSize || "\u2014"}
${data.freeText ? `\nAdditional info from booker:\n${data.freeText}` : ""}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
TOTAL: \u20AC${price.total}
${price.total === 0 ? "(Price pending — check with organizers)" : ""}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
`.trim();

  GmailApp.sendEmail(CONFIG.REPLY_TO_EMAIL, subject, body, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: data.email,
  });
}

// =============================================================================
// ACCOMMODATION CHANGE (admin)
// =============================================================================
function changeAccommodation(pw, bookingRef, params) {
  // params: { newType, newRoomId, sendEmail }
  if (pw !== CONFIG.ADMIN_PASSWORD) return { success: false, error: 'Wrong password' };
  const sheet = getSheet();
  const settings = getSettings_();
  const allBookings = getAllActiveBookings_(sheet);
  const bookings = allBookings; // includes CONFIRMED + NEEDS_ATTENTION
  const booking = bookings.find(b => b.bookingRef === bookingRef);
  if (!booking) return { success: false, error: 'Booking not found: ' + bookingRef };

  const newType   = params.newType;
  const newRoomId = params.newRoomId || '';

  // Validate new room type if switching to room
  let newRoomCfg = null;
  if (newType === 'room') {
    newRoomCfg = CONFIG.ROOMS.find(r => r.id === newRoomId);
    if (!newRoomCfg) return { success: false, error: 'Invalid room type: ' + newRoomId };
    // Check capacity — count existing primary bookings of this type
    const alreadyBooked = bookings.filter(b => b.roomId === newRoomId && b.isPrimaryBooker === 'YES').length;
    if (alreadyBooked >= newRoomCfg.count) return { success: false, error: 'No ' + newRoomCfg.note_en + ' rooms available.' };
    // If primary booker with joiners, check new room fits all occupants
    if (booking.isPrimaryBooker === 'YES') {
      const joiners = bookings.filter(b => b.roomRef === bookingRef && b.isPrimaryBooker !== 'YES' && b.bookingRef !== bookingRef);
      const totalOccupants = joiners.length + 1;
      if (totalOccupants > newRoomCfg.persons) {
        return { success: false, error: `Room has ${joiners.length} joiner(s) — new room type only fits ${newRoomCfg.persons} person(s) total.` };
      }
    }
  }

  // Build old description for email
  const oldType   = booking.type;
  const oldRoomId = booking.roomId || '';
  const oldRoomCfg = oldRoomId ? CONFIG.ROOMS.find(r => r.id === oldRoomId) : null;

  // Calculate old and new prices
  const fakeOld = Object.assign({}, booking, { type: oldType, roomId: oldRoomId, fullBoard: booking.fullBoard === 'YES', thuExtraNight: booking.thuExtraNight === 'YES' });
  const fakeNew = Object.assign({}, booking, { type: newType, roomId: newRoomId, fullBoard: booking.fullBoard === 'YES', thuExtraNight: booking.thuExtraNight === 'YES' });
  const oldPrice = calculatePrice(fakeOld);
  const newPrice = calculatePrice(fakeNew);

  // Update sheet
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rowIdx = data.slice(1).findIndex(r => r[headers.indexOf('BookingRef')] === bookingRef);
  if (rowIdx === -1) return { success: false, error: 'Row not found' };
  const sheetRow = rowIdx + 2;

  const setCol = (col, val) => {
    const idx = headers.indexOf(col);
    if (idx !== -1) sheet.getRange(sheetRow, idx + 1).setValue(val);
  };
  setCol('Type',    newType);
  setCol('RoomId',  newRoomId);
  setCol('TotalPrice',    newPrice.total);
  setCol('PriceBreakdown', newPrice.breakdown);

  // If type changes to non-room, clear room-specific fields
  if (newType !== 'room' && newType !== 'singlebed') {
    setCol('RoomRef', bookingRef);
    setCol('SoloRoom', '');
  }

  logEvent_('OK', 'accommodation_changed', booking.callsign,
    `ref=${bookingRef} ${oldType}/${oldRoomId} → ${newType}/${newRoomId} price €${oldPrice.total}→€${newPrice.total}`);

  // Send change notification email if requested
  if (params.sendEmail && booking.email) {
    try {
      sendAccommodationChangeEmail_(booking, oldType, oldRoomCfg, newType, newRoomCfg, oldPrice, newPrice, settings);
    } catch(e) {
      return { success: true, warning: 'Saved but email failed: ' + e.message };
    }
  }

  return { success: true, oldPrice: oldPrice.total, newPrice: newPrice.total };
}

function changeRole(pw, bookingRef, params) {
  // params: { newRole: 'primary'|'joiner', targetRoomRef, targetRoomId }
  // newRole='primary': joiner becomes primary booker (needs free room slot)
  // newRole='joiner':  primary booker becomes joiner in another room (targetRoomRef required)
  if (pw !== CONFIG.ADMIN_PASSWORD) return { success: false, error: 'Wrong password' };

  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows    = data.slice(1);
  const settings = getSettings_();

  const hIdx = (col) => headers.indexOf(col);
  const getVal = (row, col) => row[hIdx(col)];
  const setVal = (sheetRow, col, val) => {
    const idx = hIdx(col);
    if (idx !== -1) sheet.getRange(sheetRow, idx + 1).setValue(val);
  };

  // Find the target booking row
  const rowIdx = rows.findIndex(r => getVal(r, 'BookingRef') === bookingRef);
  if (rowIdx === -1) return { success: false, error: 'Booking not found: ' + bookingRef };
  const sheetRow = rowIdx + 2;
  const row = rows[rowIdx];

  const isPrimary     = getVal(row, 'IsPrimaryBooker') === 'YES';
  const callsign      = getVal(row, 'Callsign');
  const currentRoomRef = getVal(row, 'RoomRef');
  const bookingType   = getVal(row, 'Type');

  // Only applicable to room/singlebed bookings
  if (bookingType !== 'room' && bookingType !== 'singlebed') {
    return { success: false, error: 'Role change only applies to room/singlebed bookings.' };
  }

  // -----------------------------------------------------------------------
  // CASE 1: JOINER → PRIMARY BOOKER
  // -----------------------------------------------------------------------
  if (params.newRole === 'primary') {
    if (isPrimary) return { success: false, error: 'Already a primary booker.' };

    const targetRoomId = params.targetRoomId;
    if (!targetRoomId) return { success: false, error: 'No room type selected.' };

    const roomCfg = CONFIG.ROOMS.find(r => r.id === targetRoomId);
    if (!roomCfg) return { success: false, error: 'Invalid room type.' };

    // Check room availability (only CONFIRMED primaries count)
    const bookedCount = rows.filter(r =>
      getVal(r, 'RoomId') === targetRoomId &&
      getVal(r, 'IsPrimaryBooker') === 'YES' &&
      ['CONFIRMED','CHECKED_IN','NEEDS_ATTENTION'].includes(getVal(r, 'Status'))
    ).length;
    const roomLimit = (settings.ROOM_COUNTS && settings.ROOM_COUNTS[targetRoomId] !== undefined)
                      ? settings.ROOM_COUNTS[targetRoomId] : roomCfg.count;
    if (bookedCount >= roomLimit) {
      return { success: false, error: `No ${roomCfg.note_en} rooms available (${bookedCount}/${roomLimit} booked).` };
    }

    // Update: this person becomes primary with own ref as RoomRef, gets new room
    setVal(sheetRow, 'IsPrimaryBooker', 'YES');
    setVal(sheetRow, 'RoomRef', bookingRef);
    setVal(sheetRow, 'RoomId', targetRoomId);
    setVal(sheetRow, 'Type', 'room');

    // Recalculate price
    const fakeBooking = { type: 'room', roomId: targetRoomId,
      fullBoard: getVal(row, 'FullBoard') === 'YES',
      thuExtraNight: getVal(row, 'ThuExtraNight') === 'YES' };
    const newPrice = calculatePrice(fakeBooking);
    setVal(sheetRow, 'TotalPrice', newPrice.total);
    setVal(sheetRow, 'PriceBreakdown', newPrice.breakdown);

    logEvent_('OK', 'role_changed', callsign,
      `ref=${bookingRef} joiner→primary roomId=${targetRoomId}`);

    return { success: true, message: `${callsign} promoted to primary booker in a ${roomCfg.note_en} room.` };
  }

  // -----------------------------------------------------------------------
  // CASE 2: PRIMARY BOOKER → JOINER
  // -----------------------------------------------------------------------
  if (params.newRole === 'joiner') {
    if (!isPrimary) return { success: false, error: 'Not a primary booker.' };

    const targetRoomRef = params.targetRoomRef;
    if (!targetRoomRef) return { success: false, error: 'No target room selected.' };
    if (targetRoomRef === bookingRef) return { success: false, error: 'Cannot join own room.' };

    // Find the target primary booking
    const targetPrimaryIdx = rows.findIndex(r =>
      getVal(r, 'BookingRef') === targetRoomRef &&
      getVal(r, 'IsPrimaryBooker') === 'YES' &&
      ['CONFIRMED','CHECKED_IN','NEEDS_ATTENTION'].includes(getVal(r, 'Status'))
    );
    if (targetPrimaryIdx === -1) return { success: false, error: 'Target room not found or not a primary booking.' };
    const targetRow = rows[targetPrimaryIdx];
    const targetRoomId = getVal(targetRow, 'RoomId');
    const targetRoomCfg = CONFIG.ROOMS.find(r => r.id === targetRoomId);
    if (!targetRoomCfg) return { success: false, error: 'Target room config not found.' };

    // Check capacity in target room
    const targetOccupants = rows.filter(r =>
      (getVal(r, 'BookingRef') === targetRoomRef || getVal(r, 'RoomRef') === targetRoomRef) &&
      ['CONFIRMED','CHECKED_IN','NEEDS_ATTENTION'].includes(getVal(r, 'Status'))
    ).length;
    if (targetOccupants >= targetRoomCfg.persons) {
      return { success: false, error: `Target room is full (${targetOccupants}/${targetRoomCfg.persons}).` };
    }

    // Find joiners in the OLD room (this person's room)
    const oldJoiners = rows.filter(r =>
      getVal(r, 'RoomRef') === bookingRef &&
      getVal(r, 'IsPrimaryBooker') !== 'YES' &&
      ['CONFIRMED','CHECKED_IN','NEEDS_ATTENTION'].includes(getVal(r, 'Status'))
    );

    // Flag old joiners as NEEDS_ATTENTION
    if (oldJoiners.length > 0) {
      const comment = `Primary booker ${callsign} (${bookingRef}) was moved to another room by admin. Please reassign or contact these guests.`;
      oldJoiners.forEach(joiner => {
        const joinerRef = getVal(joiner, 'BookingRef');
        const joinerRowIdx = rows.findIndex(r => getVal(r, 'BookingRef') === joinerRef);
        if (joinerRowIdx !== -1) {
          setVal(joinerRowIdx + 2, 'Status', 'NEEDS_ATTENTION');
          setVal(joinerRowIdx + 2, 'OrgComment', comment);
        }
      });
    }

    // Update this booking: becomes joiner in target room
    setVal(sheetRow, 'IsPrimaryBooker', 'NO');
    setVal(sheetRow, 'RoomRef', targetRoomRef);
    setVal(sheetRow, 'RoomId', targetRoomId);

    // Recalculate price (as joiner, same room type)
    const fakeBooking = { type: 'room', roomId: targetRoomId,
      fullBoard: getVal(row, 'FullBoard') === 'YES',
      thuExtraNight: getVal(row, 'ThuExtraNight') === 'YES' };
    const newPrice = calculatePrice(fakeBooking);
    setVal(sheetRow, 'TotalPrice', newPrice.total);
    setVal(sheetRow, 'PriceBreakdown', newPrice.breakdown);

    logEvent_('OK', 'role_changed', callsign,
      `ref=${bookingRef} primary→joiner targetRoom=${targetRoomRef} oldJoinersFlagged=${oldJoiners.length}`);

    const joinerMsg = oldJoiners.length > 0
      ? ` ${oldJoiners.length} previous joiner(s) flagged as NEEDS_ATTENTION.`
      : '';
    return { success: true, message: `${callsign} is now a joiner in room ${targetRoomRef}.${joinerMsg}`, flaggedCount: oldJoiners.length };
  }

  return { success: false, error: 'Unknown newRole: ' + params.newRole };
}

function sendAccommodationChangeEmail_(booking, oldType, oldRoomCfg, newType, newRoomCfg, oldPrice, newPrice, settings) {
  const typeLabel = (type, cfg) => {
    if (type === 'room')       return cfg ? cfg.note_en : 'Room';
    if (type === 'camper')     return 'Camper van spot';
    if (type === 'tent')       return 'Tent';
    if (type === 'singlebed')  return 'Single bed (organizer-assigned)';
    if (type === 'dayvisitor') return 'Day visitor';
    return type;
  };
  const subject = `[Nordic VUSHF 2026] Accommodation change — ${booking.bookingRef}`;
  const sep = '\u2500'.repeat(57);
  const dsep = '\u2550'.repeat(59);
  const priceDiff = newPrice.total - oldPrice.total;
  const diffStr = priceDiff === 0 ? 'No change' : (priceDiff > 0 ? '+€' + priceDiff : '\u2212€' + Math.abs(priceDiff));

  const body = `
${dsep}
  NORDIC VUSHF MEETING 2026
  ACCOMMODATION CHANGE NOTICE
  ${CONFIG.LOCATION}
  ${CONFIG.DATE_FRI} \u2013 ${CONFIG.DATE_SUN}
${dsep}

Dear ${booking.name},

The organizers have updated your accommodation booking.

BOOKING REFERENCE: ${booking.bookingRef}

${sep}
CHANGE DETAILS
${sep}
Previous : ${typeLabel(oldType, oldRoomCfg)}
New      : ${typeLabel(newType, newRoomCfg)}

Previous total : \u20AC${oldPrice.total}
New total      : \u20AC${newPrice.total}
Difference     : ${diffStr}

${sep}
NEW PRICE BREAKDOWN
${sep}
${newPrice.breakdown.split(' | ').join('\n')}

${settings.PRICE_DISCLAIMER ? `\n* ${settings.PRICE_DISCLAIMER}` : ''}
${sep}
PAYMENT
${sep}
All payments are completed upon arrival at the venue.
Accepted: Cash · Visa · Mastercard  (no Amex/Diners)

${sep}
If you have any questions, please contact us:
meeting@rats.fi

73,
${CONFIG.EMAIL_SENDER_NAME}
${dsep}
`.trim();

  GmailApp.sendEmail(booking.email, subject, body, {
    name: CONFIG.EMAIL_SENDER_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL,
    bcc: CONFIG.REPLY_TO_EMAIL,
  });
}

// =============================================================================
// SETUP — Run once to create the sheet
// =============================================================================
function setupSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch(e) { ss = null; }
  if (!ss) {
    if (!id) throw new Error("SHEET_ID not set in Script Properties — add it via Project Settings → Script Properties");
    ss = SpreadsheetApp.openById(id);
  }
  const sheet = setupSpreadsheet_(ss);
  Logger.log("Done — sheet ready: " + sheet.getName());
}

function setupSpreadsheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  const headers = [
    "Timestamp", "BookingRef", "Callsign", "Name", "Email", "Phone",
    "Country", "Type", "RoomId", "RoomRef", "IsPrimaryBooker",
    "ThuExtraNight", "FullBoard", "Dietary", "ShirtSize", "TotalPrice", "PriceBreakdown", "Status",
    "RoomNumber", "OrgComment", "PublishConsent", "SoloRoom", "DayVisitorDays", "Meals", "FreeText", "IsOrganizer"
  ];
  sheet.appendRow(headers);
  sheet.setFrozenRows(1);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#1a1a2e");
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");

  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

// =============================================================================
// HTML — BOOKING PAGE
// =============================================================================
function getClientConfigJson_(joinRef, settings) {
  const s = settings || getSettings_();
  const cfg = {
    INITIAL_JOIN: joinRef || '',
    ROOMS: CONFIG.ROOMS,
    CAMPER_VAN_SPOTS: settings.CAMPER_VAN_SPOTS,
    CAMPER_VAN_PRICE_PER_NIGHT: s.CAMPER_VAN_PRICE_PER_NIGHT,
    CAMPING_NIGHTS: CONFIG.CAMPING_NIGHTS,
    TENT_SPOTS: settings.TENT_SPOTS,
    TENT_PRICE_WEEKEND: s.TENT_PRICE_WEEKEND,
    TENT_ENABLED: s.TENT_ENABLED,
    FULL_BOARD_PRICE: s.FULL_BOARD_PRICE,
    THU_EXTRA_INCLUDES: CONFIG.THU_EXTRA_INCLUDES,
    ALLOW_SOLO_DOUBLE: s.ALLOW_SOLO_DOUBLE,
    ALLOW_SINGLE_BED_BOOKING: s.ALLOW_SINGLE_BED_BOOKING,
    SINGLE_BED_PRICE: s.SINGLE_BED_PRICE,
    ROOM_PRICES: s.ROOM_PRICES,
    WEBAPP_URL: CONFIG.WEBAPP_URL,
    FRIENDLY_URL: CONFIG.FRIENDLY_URL,
    CAMPER_INFO: s.CAMPER_INFO,
    TENT_INFO: s.TENT_INFO,
    REGISTRATION_CLOSES: s.REGISTRATION_CLOSES,
    PRICE_DISCLAIMER: s.PRICE_DISCLAIMER,
    MEETING_FEE_WEEKEND: s.MEETING_FEE_WEEKEND,
    MEETING_FEE_DAY: s.MEETING_FEE_DAY,
    MEAL_FRI_BBQ: s.MEAL_FRI_BBQ,
    MEAL_SAT_HAM_DINNER: s.MEAL_SAT_HAM_DINNER,
    MEAL_LUNCH: s.MEAL_LUNCH,
  };
  return JSON.stringify(cfg);
}

function buildBookingPage(joinRef, bypassToken) {
  const settings = getSettings_();
  // Join links always work — joiner should be able to join even if registration is closed
  const validBypass = (joinRef && joinRef.length > 0)
    || (settings.BYPASS_TOKEN && bypassToken && bypassToken === settings.BYPASS_TOKEN);
  if (!validBypass) {
    if (!settings.REGISTRATION_OPEN) {
      return buildRegistrationClosedPage(settings);
    }
    if (settings.REGISTRATION_CLOSES) {
      var deadline = new Date(settings.REGISTRATION_CLOSES + 'T23:59:59');
      if (new Date() > deadline) {
        return buildRegistrationClosedPage(settings);
      }
    }
  }
  return buildBookingPageHtml_(joinRef, settings, bypassToken);
}

function buildRegistrationClosedPage(settings) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nordic VUSHF Meeting 2026 — Registration</title>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
  :root{--bg:#f0f2f5;--surface:#fff;--border:#d0d7de;--accent:#b45309;--accent2:#1d6fa5;--text:#1c2128;--muted:#57606a;--danger:#cf222e;--mono:'Share Tech Mono',monospace;--sans:'Barlow',sans-serif;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:17px;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
  .box{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:2.5rem;max-width:560px;width:100%;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .logos{display:flex;align-items:center;justify-content:center;gap:1.25rem;margin-bottom:1.5rem}
  h1{font-size:1.4rem;margin-bottom:0.5rem}
  h1 span{color:var(--accent)}
  .badge{font-family:var(--mono);font-size:0.7rem;color:var(--accent);letter-spacing:0.2em;text-transform:uppercase;margin-bottom:1.25rem}
  .closed-icon{font-size:3rem;margin-bottom:1rem}
  .msg{font-size:1.1rem;margin-bottom:1.5rem;line-height:1.6}
  .contact{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:1rem 1.5rem;font-family:var(--mono);font-size:1rem;color:var(--accent2)}
  .closes{margin-top:1.25rem;font-size:0.85rem;color:var(--muted);font-family:var(--mono)}
</style>
</head>
<body>
<div class="box">
  <div class="logos">
    <img src="https://rats.fi/wp-content/uploads/2026/02/vushf26-logo-small.png" alt="Nordic VUSHF 2026" style="height:55px;width:auto;">
    <img src="https://rats.fi/wp-content/uploads/2015/06/cropped-RATSrotta-286x300.jpg" alt="RATS" style="height:45px;width:auto;">
  </div>
  <div class="badge">Nordic VUSHF Meeting 2026 · RATS · Raisio</div>
  <div class="closed-icon">🔒</div>
  <div class="msg">Registration is currently closed.</div>
  ${settings.CLOSED_MESSAGE ? `<div style="margin-bottom:1rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:0.9rem 1.25rem;font-size:0.95rem;line-height:1.6;text-align:left">${settings.CLOSED_MESSAGE}</div>` : ''}
  <div style="margin-bottom:0.5rem">If you have questions or wish to register, please contact the organizers:</div>
  <div class="contact">meeting@rats.fi</div>
  ${settings.REGISTRATION_CLOSES ? '<div class="closes">Registration closed: ' + settings.REGISTRATION_CLOSES + '</div>' : ''}
</div>
</body>
</html>`;
}

function buildBookingPageHtml_(joinRef, settings, bypassToken) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nordic VUSHF Meeting 2026 — Registration</title>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#f0f2f5; --surface:#ffffff; --border:#d0d7de;
    --accent:#b45309; --accent2:#1d6fa5;
    --text:#1c2128; --muted:#57606a;
    --danger:#cf222e; --success:#1a7f37;
    --mono:'Share Tech Mono',monospace; --sans:'Barlow',sans-serif;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:17px;min-height:100vh}
  .container{max-width:760px;margin:0 auto;padding:2rem 1.25rem 4rem}

  .header{text-align:center;margin-bottom:2.5rem;padding-bottom:1.5rem;border-bottom:2px solid var(--border)}
  .header-badge{font-family:var(--mono);font-size:0.75rem;color:var(--accent);letter-spacing:0.2em;text-transform:uppercase;margin-bottom:1rem}
  .logos{display:flex;align-items:center;justify-content:center;gap:1.5rem;margin-bottom:1rem;flex-wrap:wrap}
  .header .sub{font-size:1rem;color:var(--muted);font-weight:300}
  .header .dates{margin-top:1rem;display:flex;justify-content:center;gap:0.75rem;flex-wrap:wrap}
  .date-pill{font-family:var(--mono);font-size:0.8rem;padding:0.3rem 0.9rem;border:2px solid var(--accent);color:var(--accent);border-radius:3px;font-weight:600}

  .avail-bar{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1.1rem 1.4rem;margin-bottom:2rem;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .avail-bar h3{font-family:var(--mono);font-size:0.85rem;color:var(--muted);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:0.75rem}
  .avail-grid{display:flex;flex-wrap:wrap;gap:0.5rem}
  .avail-item{font-family:var(--mono);font-size:1rem;padding:0.3rem 0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:3px;display:flex;gap:0.6rem;align-items:center}
  .avail-item .count{color:var(--accent2);font-weight:600}
  .avail-item.full{opacity:0.5}
  .avail-item.full .count{color:var(--danger);font-weight:600}

  .landing{display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;margin-bottom:2rem}
  .choice-card{background:var(--surface);border:2px solid var(--border);border-radius:8px;padding:1.75rem 1.25rem;text-align:center;cursor:pointer;transition:border-color .15s,box-shadow .15s;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .choice-card:hover{border-color:var(--accent2);box-shadow:0 4px 12px rgba(0,0,0,.1)}
  .choice-card.selected{border-color:var(--accent);box-shadow:0 0 0 3px rgba(180,83,9,.15)}
  .choice-icon{font-size:2.2rem;margin-bottom:0.75rem}
  .choice-title{font-size:1.1rem;font-weight:700;margin-bottom:0.3rem}
  .choice-desc{font-size:0.88rem;color:var(--muted);line-height:1.4}

  .card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1.75rem;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .card h2{font-size:1.1rem;font-weight:700;margin-bottom:1.25rem;padding-bottom:0.6rem;border-bottom:1px solid var(--border)}
  .section{display:none}
  .section.visible{display:block}

  .field{margin-bottom:1.1rem}
  .field label{display:block;font-size:0.9rem;font-weight:600;margin-bottom:0.4rem}
  .field input,.field select,.field textarea{width:100%;background:#f8fafc;border:1px solid var(--border);color:var(--text);padding:0.7rem 0.85rem;font-family:var(--sans);font-size:1rem;border-radius:3px;outline:none;transition:border-color .15s}
  .field input:focus,.field select:focus,.field textarea:focus{border-color:var(--accent2);background:#fff}
  .field textarea{min-height:70px;resize:vertical}
  .field .hint{font-size:0.8rem;color:var(--muted);margin-top:0.3rem}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  @media(max-width:500px){.row2{grid-template-columns:1fr}}

  .options{display:flex;flex-direction:column;gap:0.5rem}
  .radio-option,.check-option{display:flex;align-items:flex-start;gap:0.75rem;padding:0.75rem 1rem;border:1px solid var(--border);border-radius:4px;cursor:pointer;transition:border-color .12s,background .12s;background:var(--bg)}
  .radio-option:hover,.check-option:hover{border-color:var(--accent2);background:rgba(29,111,165,.04)}
  .radio-option input,.check-option input{margin-top:3px;flex-shrink:0;width:16px;height:16px}
  .radio-option .opt-label,.check-option .opt-label{font-weight:600;font-size:0.95rem}
  .radio-option .opt-sub,.check-option .opt-sub{font-size:0.82rem;color:var(--muted);margin-top:0.15rem}
  .radio-option.selected,.check-option.selected{border-color:var(--accent);background:rgba(180,83,9,.04)}
  .check-option.disabled-meal{opacity:0.45;pointer-events:none;cursor:not-allowed}

  .warn-box{background:#fffbeb;border:1px solid #d97706;border-radius:3px;padding:0.75rem 1rem;font-size:0.9rem;color:#92400e;margin-bottom:1rem}
  .info-box{background:#eff6ff;border:1px solid #93c5fd;border-radius:3px;padding:0.75rem 1rem;font-size:0.9rem;color:#1d4ed8;margin-bottom:1rem}

  .price-box{background:#fffbeb;border:2px solid var(--accent);border-radius:3px;padding:1rem;margin-top:1rem}
  .price-row{display:flex;justify-content:space-between;font-size:0.95rem;padding:0.25rem 0;color:var(--text)}
  .price-row.total{font-size:1.15rem;font-weight:700;color:var(--accent);padding-top:0.6rem;margin-top:0.3rem;border-top:2px solid var(--border);font-family:var(--mono)}

  .submit-btn{width:100%;padding:1rem;background:var(--accent);color:#fff;border:none;font-family:var(--sans);font-size:1.05rem;font-weight:700;letter-spacing:0.04em;border-radius:4px;cursor:pointer;transition:background .15s}
  .submit-btn:hover{background:#92400e}
  .submit-btn:disabled{opacity:0.6;cursor:not-allowed}
  .back-btn{background:none;border:1px solid var(--border);color:var(--muted);font-family:var(--sans);font-size:0.9rem;padding:0.5rem 1.1rem;border-radius:4px;cursor:pointer;margin-bottom:1.25rem}
  .back-btn:hover{border-color:var(--accent2);color:var(--accent2)}

  .msg{padding:0.75rem 1rem;border-radius:3px;margin-top:1rem;font-size:0.95rem;display:none}
  .msg.visible{display:block}
  .msg.error{background:#fff0f0;border:1px solid var(--danger);color:var(--danger)}
  .msg.success{background:#f0faf4;border:1px solid var(--success);color:var(--success)}

  .success-screen{display:none;text-align:center;padding:2rem 1rem}
  .success-icon{font-size:3rem;margin-bottom:1rem}
  .success-ref{font-family:var(--mono);font-size:1.5rem;color:var(--accent);margin:1rem 0;padding:0.75rem 1.25rem;border:2px solid var(--accent);background:#fffbeb;display:inline-block;letter-spacing:0.1em;border-radius:4px}

  #loading{display:none;position:fixed;inset:0;background:rgba(240,242,245,.88);z-index:100;align-items:center;justify-content:center;flex-direction:column;gap:1rem}
  #loading.visible{display:flex}
  .spinner{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}

  .footer{text-align:center;margin-top:3rem;font-size:0.8rem;color:var(--muted);font-family:var(--mono)}

  @media(max-width:600px){
    body{font-size:18px}
    .container{padding:0.5rem 0.5rem 2rem}
    .header{margin-bottom:1rem;padding-bottom:0.75rem}
    .logos img{max-height:70px!important}
    .header .sub{font-size:1rem}
    .date-pill{font-size:0.78rem;padding:0.25rem 0.6rem}
    .avail-bar{padding:0.85rem 1rem}
    .avail-item{font-size:0.95rem;padding:0.25rem 0.5rem}
    .landing{grid-template-columns:1fr;gap:0.5rem;margin-bottom:1rem}
    .choice-card{padding:0.85rem 0.9rem;display:flex;align-items:center;text-align:left;gap:0.85rem}
    .choice-icon{font-size:1.8rem;margin-bottom:0;flex-shrink:0}
    .choice-title{font-size:1.1rem;margin-bottom:0.1rem}
    .choice-desc{font-size:0.95rem}
    .card{padding:0.9rem 0.85rem;margin-bottom:0.75rem}
    .card h2{font-size:1.1rem;margin-bottom:0.75rem}
    .radio-option,.check-option{padding:0.6rem 0.65rem}
    .radio-option .opt-label,.check-option .opt-label{font-size:1rem}
    .radio-option .opt-sub,.check-option .opt-sub{font-size:0.9rem}
    .row2{grid-template-columns:1fr}
    .field input,.field select,.field textarea{font-size:16px}
    .price-box{padding:0.75rem}
    .price-row{font-size:1rem}
    .price-row.total{font-size:1.15rem}
    .submit-btn{font-size:1.1rem;padding:1rem}
    .back-btn{font-size:0.95rem;padding:0.5rem 1rem;margin-bottom:0.75rem}
    .success-screen{padding:1.25rem 0.5rem}
    .success-ref{font-size:1.2rem;padding:0.5rem 1rem}
  }
</style>
</head>
<body>
<div id="loading"><div class="spinner"></div><div style="color:var(--muted);font-family:var(--mono);font-size:.9rem">Processing...</div></div>

<div class="container">
  <div class="header">
    <div class="header-badge">Registration</div>
    <div class="logos">
      <img src="https://rats.fi/wp-content/uploads/2026/02/vushf26-logo-small.png" alt="Nordic VUSHF Meeting 2026" style="max-height:110px;width:auto;">
      <img src="https://rats.fi/wp-content/uploads/2015/06/cropped-RATSrotta-286x300.jpg" alt="RATS" style="max-height:90px;width:auto;">
    </div>
    <div class="sub">RATS – Radio Amateur Technology Society of Finland<br>Hotelli Martinhovi, Raisio, Finland</div>
    ${settings.REGISTRATION_CLOSES ? '<div style="margin-top:0.75rem;font-family:var(--mono);font-size:0.78rem;color:var(--muted)">Registration closes: ' + settings.REGISTRATION_CLOSES + '</div>' : ''}
    <div style="margin-top:0.9rem"><a href="https://rats.fi/vushf2026/" style="font-size:0.85rem;color:var(--muted);text-decoration:none;border-bottom:1px solid var(--border)">← Back to the meeting page</a></div>
  </div>

  ${settings.ANNOUNCEMENT ? '<div id="announcement-banner" style="background:#fffbeb;border:1.5px solid var(--accent);border-radius:6px;padding:0.85rem 1.1rem;margin-bottom:1.5rem;font-size:0.95rem;color:var(--text);white-space:pre-line">' + settings.ANNOUNCEMENT + '</div>' : ''}

  <div class="avail-bar">
    <h3>Room availability</h3>
    <div class="avail-grid" id="avail-grid"><div style="color:var(--muted);font-family:var(--mono);font-size:.85rem">Loading...</div></div>
  </div>

  <div id="landing-section">
    <div class="landing">
      <div class="choice-card" id="card-new" onclick="selectMode('new')">
        <div class="choice-icon">🏨 🚐</div>
        <div class="choice-title">Book accommodation</div>
        <div class="choice-desc">Reserve a room or camper van spot</div>
      </div>
      <div class="choice-card" id="card-join" onclick="selectMode('join')">
        <div class="choice-icon">🔑</div>
        <div class="choice-title">Join a booking</div>
        <div class="choice-desc">Join an already booked room or camper van spot with a booking reference</div>
      </div>
      <div class="choice-card" id="card-dayvisitor" onclick="selectMode('dayvisitor')">
        <div class="choice-icon">🎫</div>
        <div class="choice-title">Day visitor</div>
        <div class="choice-desc">Attending Fri and/or Sat without overnight stay</div>
      </div>
      <div class="choice-card" id="card-who" onclick="openPublicPage()">
        <div class="choice-icon">📋</div>
        <div class="choice-title">Who's coming?</div>
        <div class="choice-desc">See participants already registered</div>
      </div>
    </div>
  </div>

  <div id="form-section" class="section">
    <button class="back-btn" onclick="goBack()">← Back</button>

    <div id="acc-type-section" class="card section">
      <h2>Accommodation type</h2>
      <div class="options">
        <label class="radio-option">
          <input type="radio" name="acc-type" value="room" onchange="onTypeChange()">
          <div><div class="opt-label">🏨 Hotel room</div>
          <div class="opt-sub">Fri–Sun (2 nights) · Single, double, triple, quad or seven-person room · Breakfast included</div></div>
        </label>
        <label class="radio-option">
          <input type="radio" name="acc-type" value="camper" onchange="onTypeChange()">
          <div><div class="opt-label">🚐 Camper van spot</div>
          <div class="opt-sub">Fri–Sun (2 nights) · Includes electricity · €${settings.CAMPER_VAN_PRICE_PER_NIGHT * CONFIG.CAMPING_NIGHTS}</div></div>
        </label>
        <label class="radio-option" id="tent-option" ${!settings.TENT_ENABLED ? 'style="display:none"' : ''}>
          <input type="radio" name="acc-type" value="tent" onchange="onTypeChange()">
          <div><div class="opt-label">⛺ Tent spot</div>
          <div class="opt-sub">Fri–Sun weekend · €${settings.TENT_PRICE_WEEKEND}</div></div>
        </label>
        <label class="radio-option" id="singlebed-option" style="display:none">
          <input type="radio" name="acc-type" value="singlebed" onchange="onTypeChange()">
          <div><div class="opt-label">🛏️ Single bed (organizer-assigned room)</div>
          <div class="opt-sub">Fri–Sun (2 nights) · All single rooms are full — organizers will assign your room · €${settings.SINGLE_BED_PRICE}</div></div>
        </label>
      </div>
      <div id="camper-info-box" class="info-box" style="display:none;margin-top:1rem">${settings.CAMPER_INFO}</div>
      <div id="tent-info-box" class="info-box" style="display:none;margin-top:1rem">${settings.TENT_INFO}</div>
    </div>

    <div id="room-type-section" class="card section">
      <h2>Room type</h2>
      <div class="options" id="room-type-options"></div>
    </div>

    <div id="thu-section" class="card section" style="display:none">
      <h2>Extra night</h2>
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:0.75rem">All room bookings are Fri–Sun by default. Add Thursday night to arrive a day early. If you wish to book additional nights beyond Thursday, please let us know in the free text field below.</p>
      <label class="check-option">
        <input type="checkbox" id="thu-extra" onchange="onThuExtraChange()">
        <div>
          <div class="opt-label">🌙 Add Thursday night (14.5 → 15.5)</div>
          <div class="opt-sub" id="thu-sub">Price based on selected room · ${CONFIG.THU_EXTRA_INCLUDES}</div>
        </div>
      </label>
    </div>

    <div id="thu-info-join" class="card section" style="display:none">
      <h2>Extra night</h2>
      <div class="info-box" id="thu-info-join-text">The primary booker has included Thursday night.</div>
    </div>

    <div id="join-section" class="card section">
      <h2>Join a booking</h2>
      <div id="join-ref-entry" style="margin-bottom:1rem">
        <div class="field">
          <label>Booking reference <span style="font-weight:400;color:var(--muted)">(from the primary booker's confirmation email)</span></label>
          <div style="display:flex;gap:0.5rem;align-items:flex-start">
            <input type="text" id="join-ref-input" placeholder="e.g. OH2LAK-7" autocomplete="off" style="text-transform:uppercase;flex:1" oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')lookupJoinRef()">
            <button onclick="lookupJoinRef()" style="padding:0.55rem 1.1rem;background:var(--accent2);color:#fff;border:none;border-radius:4px;font-family:var(--sans);font-size:0.95rem;font-weight:600;cursor:pointer;white-space:nowrap">Look up →</button>
          </div>
        </div>
      </div>
      <div id="join-room-info" class="info-box" style="display:none;margin-bottom:0.75rem"></div>
      <div id="join-room-full" class="info-box" style="display:none;background:#fef2f2;border-color:#fca5a5;color:#b91c1c"></div>
    </div>

    <div id="guest-section" class="card section">
      <h2>Your details</h2>
      <div class="row2">
        <div class="field">
          <label>Callsign *</label>
          <input type="text" id="callsign" placeholder="OH2LAK" autocomplete="off" style="text-transform:uppercase">
        </div>
        <div class="field">
          <label>Name *</label>
          <input type="text" id="name" placeholder="Firstname Lastname">
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label>Email *</label>
          <input type="email" id="email" placeholder="you@example.com">
        </div>
        <div class="field">
          <label>Phone</label>
          <input type="tel" id="phone" placeholder="+358 40 123 4567">
        </div>
      </div>
      <div class="field">
        <label>Country *</label>
        <input type="text" id="country" placeholder="Finland">
      </div>
    </div>

    <div id="dayvisitor-section" class="card section" style="display:none">
      <h2>Attendance days</h2>
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:1rem">Which day(s) will you be attending?</p>
      <div style="display:flex;flex-direction:column;gap:0.5rem">
        <label class="radio-option">
          <input type="radio" name="dv-days" value="fri" onchange="updatePriceDisplay()">
          <div><div class="opt-label">Friday 15.5 only</div>
          <div class="opt-sub">Meeting fee: €${settings.MEETING_FEE_DAY}</div></div>
        </label>
        <label class="radio-option">
          <input type="radio" name="dv-days" value="sat" onchange="updatePriceDisplay()">
          <div><div class="opt-label">Saturday 16.5 only</div>
          <div class="opt-sub">Meeting fee: €${settings.MEETING_FEE_DAY}</div></div>
        </label>
        <label class="radio-option">
          <input type="radio" name="dv-days" value="both" onchange="updatePriceDisplay()">
          <div><div class="opt-label">Both days (Fri + Sat)</div>
          <div class="opt-sub">Meeting fee: €${settings.MEETING_FEE_WEEKEND}</div></div>
        </label>
      </div>
    </div>

    <div id="addons-section" class="card section">
      <h2>Add-ons</h2>

      <div id="individual-meals-section" style="display:none;margin-bottom:1rem">
        <div style="font-size:0.88rem;font-weight:600;color:var(--text);margin-bottom:0.5rem">🍽️ Meals</div>
        <div id="full-board-row">
          <label class="check-option">
            <input type="checkbox" id="full-board" onchange="onFullBoardChange()">
            <div>
              <div class="opt-label">Full board meal package — €${settings.FULL_BOARD_PRICE}/person</div>
              <div class="opt-sub" id="full-board-sub">Fri BBQ dinner · Sat lunch + Ham Dinner</div>
            </div>
          </label>
        </div>
        <hr style="margin:0.9rem 0;border:none;border-top:1px solid var(--border)">
      </div>
      <div class="field" style="margin-top:1rem">
        <label>Dietary requirements</label>
        <input type="text" id="dietary" placeholder="e.g. vegetarian, gluten-free">
      </div>
      <div class="field">
        <label>T-shirt size <span style="font-weight:400;color:var(--muted)">(optional — for planning only, not a purchase)</span></label>
        <select id="shirt-size">
          <option value="">— No preference —</option>
          <option value="XS">XS</option>
          <option value="S">S</option>
          <option value="M">M</option>
          <option value="L">L</option>
          <option value="XL">XL</option>
          <option value="XXL">XXL</option>
          <option value="3XL">3XL</option>
        </select>
        <div class="hint">For planning purposes only — not a commitment to purchase</div>
      </div>
      <div class="field">
        <label>Additional information <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
        <textarea id="free-text" rows="3" placeholder="Any additional requests or information for the organizers..." style="width:100%;font-family:var(--sans);font-size:0.95rem;padding:0.5rem 0.75rem;border:1.5px solid #d1d5db;border-radius:4px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
    </div>

    <div class="section" id="gdpr-section">
      <div class="section-title">Privacy</div>
      <label class="check-option">
        <input type="checkbox" id="gdpr-no-publish">
        <div>
          <div class="opt-label">🔒 I do NOT consent to publishing my participation on the public participant page</div>
          <div class="opt-sub" style="color:var(--muted);margin-top:0.25rem">If left unticked, your callsign and first name will be visible on the "Who's coming?" page. No other personal data is published.</div>
        </div>
      </label>
    </div>

    <div id="price-section" class="section"><div id="price-box"></div><div id="price-disclaimer" style="font-size:0.78rem;color:var(--muted);margin-top:0.5rem;font-style:italic"></div></div>
    <div id="submit-section" class="section">
      <div id="form-msg" class="msg"></div>
      <button class="submit-btn" id="submit-btn" onclick="submitForm()">Confirm booking</button>
      <p style="text-align:center;font-size:0.8rem;color:var(--muted);margin-top:0.75rem">Payment on arrival · Cash, Visa, Mastercard · No Amex/Diners</p>
    </div>
  </div>

  <div id="success-screen" class="success-screen">
    <div class="success-icon">✅</div>
    <h2 style="margin-bottom:0.5rem">Booking confirmed!</h2>
    <p style="color:var(--muted);margin-bottom:1rem">A confirmation email has been sent to you.</p>
    <div class="success-ref" id="success-ref"></div>
    <div id="success-join-link" style="display:none;margin-top:1.25rem"></div>
    <div id="success-details" style="margin-top:1.5rem;text-align:left"></div>
    <button onclick="this.textContent='↺ Loading...'; this.disabled=true; this.style.opacity='0.6'; hardRefresh();" style="margin-top:2rem;padding:0.8rem 2.5rem;background:var(--accent);color:#fff;border:none;border-radius:4px;font-size:1rem;font-family:var(--sans);font-weight:600;cursor:pointer;letter-spacing:0.05em">READY</button>
  </div>

  <div class="footer">
    Nordic VUSHF Meeting 2026 &nbsp;·&nbsp; RATS &nbsp;·&nbsp; 15–17 May 2026
    <div style="margin-top:0.6rem"><a href="https://rats.fi/vushf2026/" style="color:var(--muted);text-decoration:none;border-bottom:1px solid var(--border);font-size:0.85rem">← Back to the meeting page</a></div>
  </div>
</div>

<script>
const CONFIG_CLIENT = ${getClientConfigJson_(joinRef, settings)};
CONFIG_CLIENT.BYPASS_TOKEN = '${bypassToken || ''}';
console.log('%c Nordic VUSHF 2026 Booking System %c v${VERSION} ', 'background:#1d4ed8;color:#fff;font-weight:bold', 'background:#e5e7eb;color:#374151');

let avail = null;
let currentMode = null;
let currentAccType = null;

function selectMode(mode) {
  currentMode = mode;
  ['new','join','dayvisitor','who'].forEach(function(m) {
    const el = document.getElementById('card-' + m);
    if (el) el.classList.toggle('selected', m === mode);
  });
  document.getElementById('landing-section').style.display = 'none';
  document.getElementById('form-section').classList.add('visible');

  if (mode === 'join') {
    show('join-section'); show('guest-section'); show('gdpr-section');
    show('price-section'); show('submit-section');
    hide('acc-type-section'); hide('room-type-section');
    hide('dayvisitor-section');
    document.getElementById('thu-section').style.display = 'none';
    document.getElementById('thu-info-join').style.display = 'none';
    document.getElementById('addons-section').classList.remove('visible');
    document.getElementById('individual-meals-section').style.display = 'none';
    var thuEl = document.getElementById('thu-extra');
    if (thuEl) { thuEl.checked = false; thuEl.disabled = false; }
    updatePriceDisplay();
  } else if (mode === 'dayvisitor') {
    currentAccType = 'dayvisitor';
    hide('acc-type-section'); hide('room-type-section'); hide('join-section'); hide('thu-section');
    document.getElementById('dayvisitor-section').style.display = 'block';
    document.getElementById('individual-meals-section').style.display = 'block';
    document.getElementById('full-board-row').style.display = '';
    updateFullBoardSub();
    show('addons-section'); show('guest-section'); show('gdpr-section');
    show('price-section'); show('submit-section');
    updatePriceDisplay();
  } else {
    currentAccType = null;
    show('acc-type-section');
    hide('join-section'); hide('room-type-section'); hide('guest-section');
    hide('addons-section'); hide('gdpr-section'); hide('price-section'); hide('submit-section');
    document.getElementById('dayvisitor-section').style.display = 'none';
    document.getElementById('individual-meals-section').style.display = 'none';
  }
}

function openPublicPage() {
  window.open(CONFIG_CLIENT.WEBAPP_URL + '?public=1', '_blank');
}

function hardRefresh() {
  var base = CONFIG_CLIENT.FRIENDLY_URL || CONFIG_CLIENT.WEBAPP_URL;
  window.location.replace(base + '?t=' + Date.now());
}

function goBack() {
  var btn = event && event.target ? event.target : null;
  if (btn) { btn.textContent = '↺ Loading...'; btn.disabled = true; btn.style.opacity = '0.6'; }
  hardRefresh();
}

function show(id) { document.getElementById(id).classList.add('visible'); }
function hide(id) { document.getElementById(id).classList.remove('visible'); }

function onTypeChange() {
  const el = document.querySelector('input[name="acc-type"]:checked');
  if (!el) return;
  currentAccType = el.value;
  document.querySelectorAll('.radio-option').forEach(function(o) { o.classList.remove('selected'); });
  el.closest('.radio-option').classList.add('selected');
  const isRoom      = currentAccType === 'room';
  const isSingleBed = currentAccType === 'singlebed';
  const hasRoom     = isRoom || isSingleBed;
  document.getElementById('room-type-section').classList.toggle('visible', isRoom);
  document.getElementById('thu-section').style.display = hasRoom ? 'block' : 'none';
  document.getElementById('camper-info-box').style.display = currentAccType === 'camper' ? 'block' : 'none';
  document.getElementById('tent-info-box').style.display   = currentAccType === 'tent'   ? 'block' : 'none';
  document.getElementById('dayvisitor-section').style.display = 'none';
  document.getElementById('individual-meals-section').style.display = 'block';
  document.getElementById('full-board-row').style.display = '';
  updateFullBoardSub();
  show('guest-section'); show('addons-section'); show('gdpr-section'); show('price-section'); show('submit-section');
  updatePriceDisplay();
}

function updateFullBoardSub() {
  var el = document.getElementById('full-board-sub');
  if (!el) return;
  var base = 'Fri BBQ dinner \u00b7 Sat lunch + Ham Dinner';
  if (currentAccType === 'room' || currentAccType === 'singlebed') {
    base += ' \u00b7 Note: breakfast is included in your room price';
  }
  el.textContent = base;
}

function onFullBoardChange() {
  updatePriceDisplay();
}

function onThuExtraChange() {
  updatePriceDisplay();
}

function renderAvailability(data) {
  const grid = document.getElementById('avail-grid');
  let html = '';
  CONFIG_CLIENT.ROOMS.forEach(function(r) {
    const a = data.rooms[r.id];
    const full = a && a.available <= 0;
    html += '<div class="avail-item' + (full ? ' full' : '') + '"><span>' + r.note_en.replace(/\u26a0\ufe0f /,'') + '</span><span class="count">' + (a ? a.available + '/' + a.total : '?') + '</span></div>';
  });
  html += '<div class="avail-item' + (data.camperSpotsLeft <= 0 ? ' full' : '') + '"><span>Camper van spots</span><span class="count">' + data.camperSpotsLeft + '/' + CONFIG_CLIENT.CAMPER_VAN_SPOTS + '</span></div>';
  if (data.tentEnabled) {
    html += '<div class="avail-item' + (data.tentSpotsLeft <= 0 ? ' full' : '') + '"><span>Tent spots</span><span class="count">' + data.tentSpotsLeft + '/' + CONFIG_CLIENT.TENT_SPOTS + '</span></div>';
  }
  grid.innerHTML = html;

  // Show/hide tent option
  var tentOpt = document.getElementById('tent-option');
  if (tentOpt) tentOpt.style.display = data.tentEnabled ? '' : 'none';

  // Show/hide single bed option
  var sbOpt = document.getElementById('singlebed-option');
  if (sbOpt) {
    sbOpt.style.display = (CONFIG_CLIENT.ALLOW_SINGLE_BED_BOOKING && data.singleBedVisible) ? '' : 'none';
  }
}

function renderRoomTypes(data) {
  const container = document.getElementById('room-type-options');
  let html = '';
  CONFIG_CLIENT.ROOMS.forEach(function(r) {
    const a = data.rooms[r.id];
    const full = a && a.available <= 0;
    const noWin = !r.window;
    const isDouble = r.id === '2S';
    const livePrice = (data.prices && data.prices.rooms && data.prices.rooms[r.id] !== undefined) ? data.prices.rooms[r.id] : r.price_eur;
    html += '<label class="radio-option" id="rt-' + r.id + '">'
      + '<input type="radio" name="room-type" value="' + r.id + '"' + (full ? ' disabled' : '') + ' onchange="onRoomTypeChange()">'
      + '<div><div class="opt-label">' + (noWin ? '\u26a0\ufe0f ' : '') + r.note_en + (full ? ' — FULL' : '') + '</div>'
      + '<div class="opt-sub">\u20AC' + livePrice + ' / room \u00b7 ' + r.persons + ' person' + (r.persons > 1 ? 's' : '') + (r.floor === 'upstairs' ? ' \u00b7 Upstairs (stairs only)' : ' \u00b7 Downstairs') + '</div>'
      + (noWin ? '<div class="opt-sub" style="color:#92400e;font-weight:600">\u26a0\ufe0f No window</div>' : '')
      + (isDouble && CONFIG_CLIENT.ALLOW_SOLO_DOUBLE ? '<div style="margin-top:0.5rem"><label style="display:flex;align-items:center;gap:0.5rem;font-size:0.88rem;cursor:pointer"><input type="checkbox" id="solo-double" onchange="updatePriceDisplay()"> Book entire room for myself (solo use)</label></div>' : '')
      + '</div></label>';
  });
  container.innerHTML = html;
}

function onRoomTypeChange() {
  document.querySelectorAll('#room-type-options .radio-option').forEach(function(el) { el.classList.remove('selected'); });
  const checked = document.querySelector('input[name="room-type"]:checked');
  if (checked) checked.closest('.radio-option').classList.add('selected');
  // Update thu extra night sub-label with room-based price
  const r = checked ? CONFIG_CLIENT.ROOMS.find(function(x){return x.id===checked.value;}) : null;
  const thuSub = document.getElementById('thu-sub');
  if (thuSub && r) {
    const livePrice = (CONFIG_CLIENT.ROOM_PRICES && CONFIG_CLIENT.ROOM_PRICES[r.id] !== undefined) ? CONFIG_CLIENT.ROOM_PRICES[r.id] : r.price_eur;
    const thuRoom = Math.round(livePrice / 2);
    const thuPP = r.persons > 1 ? Math.round(thuRoom / r.persons) : thuRoom;
    var txt = '\u20AC' + thuRoom + ' room night';
    if (r.persons > 1) txt += ' (\u20AC' + thuPP + '/person)';
    txt += ' \u00b7 ' + CONFIG_CLIENT.THU_EXTRA_INCLUDES;
    thuSub.textContent = txt;
  }
  updatePriceDisplay();
}

function renderOpenRooms(data) {
  // Nothing to render into a dropdown — join is link-based only.
  // If we have a pending join ref, initialise now that avail is loaded.
  if (CONFIG_CLIENT.INITIAL_JOIN) {
    initJoinFromRef(CONFIG_CLIENT.INITIAL_JOIN);
  }
}

function lookupJoinRef() {
  var input = document.getElementById('join-ref-input');
  var ref = input ? input.value.trim().toUpperCase() : '';
  if (!ref) { return; }
  // Reset state
  var infoEl = document.getElementById('join-room-info');
  var fullEl = document.getElementById('join-room-full');
  if (infoEl) { infoEl.style.display = 'none'; infoEl.style.background = ''; infoEl.style.borderColor = ''; infoEl.style.color = ''; }
  if (fullEl) { fullEl.style.display = 'none'; }
  ['guest-section','gdpr-section','addons-section','price-section','submit-section'].forEach(function(id){ hide(id); });
  initJoinFromRef(ref);
}

function initJoinFromRef(ref) {
  var room   = avail && avail.openRooms   ? avail.openRooms.find(function(r){ return r.ref === ref; })   : null;
  var camper = avail && avail.openCampers ? avail.openCampers.find(function(c){ return c.ref === ref; }) : null;
  var infoEl  = document.getElementById('join-room-info');
  var fullEl  = document.getElementById('join-room-full');
  var thuEl   = document.getElementById('thu-extra');

  // Keep a synthetic "selected" value so the rest of the flow can read it
  if (!document.getElementById('room-ref-select')) {
    var hidden = document.createElement('input');
    hidden.type = 'hidden'; hidden.id = 'room-ref-select'; hidden.value = ref;
    document.body.appendChild(hidden);
  } else {
    document.getElementById('room-ref-select').value = ref;
  }

  if (!room && !camper) {
    if (infoEl) { infoEl.style.display = 'block'; infoEl.textContent = 'Booking reference "' + ref + '" not found. Please check the reference and try again.'; infoEl.style.background = '#fef2f2'; infoEl.style.borderColor = '#fca5a5'; infoEl.style.color = '#b91c1c'; }
    ['guest-section','gdpr-section','addons-section','price-section','submit-section'].forEach(function(id){ hide(id); });
    return;
  }

  // --- CAMPER JOIN ---
  if (camper) {
    if (infoEl) { infoEl.style.display = 'block'; infoEl.style.background = ''; infoEl.style.borderColor = ''; infoEl.style.color = ''; infoEl.innerHTML = '<strong>' + ref + '</strong> — 🚐 Camper van spot · booked by <strong>' + camper.callsign + '</strong> · ' + camper.occupants + ' registered so far'; }
    document.getElementById('thu-section').style.display = 'none';
    document.getElementById('thu-info-join').style.display = 'none';
    if (thuEl) { thuEl.checked = false; thuEl.disabled = false; }
    document.getElementById('addons-section').classList.add('visible');
    document.getElementById('individual-meals-section').style.display = 'block';
    document.getElementById('full-board-row').style.display = '';
    updateFullBoardSub();
    show('guest-section'); show('gdpr-section'); show('price-section'); show('submit-section');
    updatePriceDisplay();
    return;
  }

  // --- ROOM JOIN ---
  if (room.spotsLeft <= 0) {
    if (infoEl) infoEl.style.display = 'none';
    if (fullEl) { fullEl.style.display = 'block'; fullEl.textContent = 'This room (' + ref + ', ' + room.roomType + ') is already full — no spots remaining.'; }
    ['guest-section','gdpr-section','addons-section','price-section','submit-section'].forEach(function(id){ hide(id); });
    return;
  }

  // Room has space — show info and form
  var spotsText = room.spotsLeft + ' spot' + (room.spotsLeft > 1 ? 's' : '') + ' remaining';
  var thuNote = room.thuExtraNight ? ' · 🌙 Thu night included' : '';
  if (infoEl) { infoEl.style.display = 'block'; infoEl.style.background = ''; infoEl.style.borderColor = ''; infoEl.style.color = ''; infoEl.innerHTML = '<strong>' + ref + '</strong> — ' + room.roomType + ' · <strong>' + spotsText + '</strong>' + thuNote; }

  // Thu handling
  document.getElementById('thu-section').style.display = 'none';
  if (room.thuExtraNight) {
    var thuRoom = Math.round(room.roomPrice / 2);
    var thuPP = Math.round(thuRoom / (room.roomPersons || 1));
    var joinInfoEl = document.getElementById('thu-info-join');
    var joinTextEl = document.getElementById('thu-info-join-text');
    var priceNote = ' · \u20AC' + thuRoom + ' room night (\u20AC' + thuPP + '/person)';
    if (joinTextEl) joinTextEl.textContent = '\uD83C\uDF19 The primary booker has included Thursday night (14.5 \u2192 15.5). Your share is included in the total price.' + priceNote;
    if (joinInfoEl) joinInfoEl.style.display = 'block';
    if (thuEl) { thuEl.checked = true; thuEl.disabled = true; }
  } else {
    document.getElementById('thu-info-join').style.display = 'none';
    if (thuEl) { thuEl.checked = false; thuEl.disabled = false; }
  }

  document.getElementById('addons-section').classList.add('visible');
  document.getElementById('individual-meals-section').style.display = 'block';
  document.getElementById('full-board-row').style.display = '';
  updateFullBoardSub();
  show('guest-section'); show('gdpr-section'); show('price-section'); show('submit-section');
  updatePriceDisplay();
}
function onJoinRoomSelect() {
  var sel = document.getElementById('room-ref-select');
  if (sel && sel.value) initJoinFromRef(sel.value);
}

function updatePriceDisplay() {
  const box = document.getElementById('price-box');
  let rows = [], total = 0, tbd = false;
  if (currentMode === 'join') {
    const sel = document.getElementById('room-ref-select');
    const ref = sel ? sel.value : '';
    const selRoom   = ref && avail && avail.openRooms   ? avail.openRooms.find(function(r){ return r.ref === ref; })   : null;
    const selCamper = ref && avail && avail.openCampers ? avail.openCampers.find(function(c){ return c.ref === ref; }) : null;
    if (selCamper) {
      rows.push({label:'Camper van spot: shared with ' + ref + ' (costs split separately)', val:'—'});
      rows.push({label:'Meeting fee (full weekend)', val:'\u20AC' + CONFIG_CLIENT.MEETING_FEE_WEEKEND});
      total += CONFIG_CLIENT.MEETING_FEE_WEEKEND;
      if (document.getElementById('full-board') && document.getElementById('full-board').checked) {
        rows.push({label:'Full board meal package', val:'\u20AC' + CONFIG_CLIENT.FULL_BOARD_PRICE});
        total += CONFIG_CLIENT.FULL_BOARD_PRICE;
      }
    } else if (selRoom) {
      rows.push({label:'Room share (' + selRoom.roomType + ')', val:'\u20AC' + selRoom.pricePerPerson + '/person (room \u20AC' + selRoom.roomPrice + ')'});
      total += selRoom.pricePerPerson;
      if (selRoom.thuExtraNight) {
        const thuRoom = Math.round(selRoom.roomPrice / 2);
        const persons = selRoom.roomPersons || 1;
        const thuPP = Math.round(thuRoom / persons);
        rows.push({label:'\uD83C\uDF19 Extra night (\u20AC'+thuRoom+' room night \u00f7 '+persons+' persons)', val:'\u20AC'+thuPP+'/person'});
        total += thuPP;
      }
      rows.push({label:'Meeting fee (full weekend)', val:'\u20AC' + CONFIG_CLIENT.MEETING_FEE_WEEKEND});
      total += CONFIG_CLIENT.MEETING_FEE_WEEKEND;
      if (document.getElementById('full-board') && document.getElementById('full-board').checked) {
        rows.push({label:'Full board meal package', val:'\u20AC' + CONFIG_CLIENT.FULL_BOARD_PRICE});
        total += CONFIG_CLIENT.FULL_BOARD_PRICE;
      }
    } else {
      rows.push({label:'Joining existing booking', val:'Enter a reference above to see price'});
    }
  } else if (currentAccType === 'room') {
    const rt = document.querySelector('input[name="room-type"]:checked');
    if (rt) {
      const r = CONFIG_CLIENT.ROOMS.find(function(x){return x.id===rt.value;});
      if (r) {
        const livePrice = (CONFIG_CLIENT.ROOM_PRICES && CONFIG_CLIENT.ROOM_PRICES[r.id] !== undefined) ? CONFIG_CLIENT.ROOM_PRICES[r.id] : r.price_eur;
        const soloEl = document.getElementById('solo-double');
        const isSolo = soloEl && soloEl.checked;
        const pp = isSolo ? livePrice : Math.round(livePrice / r.persons);
        rows.push({label:'Room (' + r.note_en + (isSolo ? ', solo)' : ')'), val:'\u20AC' + pp + (isSolo ? '' : '/person (room \u20AC' + livePrice + ')')});
        total += pp;
      }
    }
    const thuEl = document.getElementById('thu-extra');
    if (thuEl && thuEl.checked) {
      const rt2 = document.querySelector('input[name="room-type"]:checked');
      const r2 = rt2 ? CONFIG_CLIENT.ROOMS.find(function(x){return x.id===rt2.value;}) : null;
      if (r2) {
        const livePrice2 = (CONFIG_CLIENT.ROOM_PRICES && CONFIG_CLIENT.ROOM_PRICES[r2.id] !== undefined) ? CONFIG_CLIENT.ROOM_PRICES[r2.id] : r2.price_eur;
        const thuRoom = Math.round(livePrice2 / 2);
        const soloEl2 = document.getElementById('solo-double');
        const isSolo2 = soloEl2 && soloEl2.checked;
        const thuPP = isSolo2 ? thuRoom : Math.round(thuRoom / r2.persons);
        var label = '\uD83C\uDF19 Extra night (\u20AC'+thuRoom+' room night';
        if (!isSolo2 && r2.persons > 1) label += ' \u00f7 '+r2.persons+' persons';
        label += ')';
        rows.push({label:label, val:'\u20AC'+thuPP+(isSolo2||r2.persons===1?'':'/person')});
        total += thuPP;
      }
    }
  } else if (currentAccType === 'camper') {
    const t = CONFIG_CLIENT.CAMPER_VAN_PRICE_PER_NIGHT * CONFIG_CLIENT.CAMPING_NIGHTS;
    rows.push({label:'Camper van (2 nights)', val:'\u20AC'+t}); total += t;
  } else if (currentAccType === 'tent') {
    rows.push({label:'Tent spot (weekend)', val:'\u20AC'+CONFIG_CLIENT.TENT_PRICE_WEEKEND});
    total += CONFIG_CLIENT.TENT_PRICE_WEEKEND;
  } else if (currentAccType === 'singlebed') {
    rows.push({label:'Single bed (organizer-assigned room)', val:'\u20AC'+CONFIG_CLIENT.SINGLE_BED_PRICE});
    total += CONFIG_CLIENT.SINGLE_BED_PRICE;
    const thuEl2 = document.getElementById('thu-extra');
    if (thuEl2 && thuEl2.checked) {
      const thuPrice = Math.round(CONFIG_CLIENT.SINGLE_BED_PRICE / 2);
      rows.push({label:'\uD83C\uDF19 Extra night', val:'\u20AC'+thuPrice});
      total += thuPrice;
    }
  } else if (currentAccType === 'dayvisitor') {
    var dvDays = document.querySelector('input[name="dv-days"]:checked');
    if (dvDays) {
      if (dvDays.value === 'both') {
        rows.push({label:'Meeting fee (Fri + Sat)', val:'\u20AC'+CONFIG_CLIENT.MEETING_FEE_WEEKEND});
        total += CONFIG_CLIENT.MEETING_FEE_WEEKEND;
      } else {
        var dayLabel = dvDays.value === 'fri' ? 'Friday' : 'Saturday';
        rows.push({label:'Meeting fee (' + dayLabel + ')', val:'\u20AC'+CONFIG_CLIENT.MEETING_FEE_DAY});
        total += CONFIG_CLIENT.MEETING_FEE_DAY;
      }
    }
  }
  if (currentMode !== 'join') {
    const boardEl = document.getElementById('full-board');
    if (boardEl && boardEl.checked) {
      rows.push({label:'Full board meal package', val:'\u20AC'+CONFIG_CLIENT.FULL_BOARD_PRICE});
      total += CONFIG_CLIENT.FULL_BOARD_PRICE;
    }
    // Meeting fee for all non-day-visitor types
    if (currentAccType && currentAccType !== 'dayvisitor' && rows.length > 0) {
      rows.push({label:'Meeting fee (full weekend)', val:'\u20AC'+CONFIG_CLIENT.MEETING_FEE_WEEKEND});
      total += CONFIG_CLIENT.MEETING_FEE_WEEKEND;
    }
  }
  if (!rows.length) { box.innerHTML = ''; return; }
  let html = '<div class="price-box">';
  rows.forEach(function(r) { html += '<div class="price-row"><span>' + r.label + '</span><span>' + r.val + '</span></div>'; });
  html += '<div class="price-row total"><span>TOTAL</span><span>\u20AC' + total + (tbd ? ' + TBD' : '') + '</span></div></div>';
  box.innerHTML = html;
}

function submitForm() {
  const msg = document.getElementById('form-msg');
  msg.className = 'msg'; msg.textContent = '';
  const data = {
    callsign:    document.getElementById('callsign').value.trim().toUpperCase(),
    name:        document.getElementById('name').value.trim(),
    email:       document.getElementById('email').value.trim(),
    phone:       document.getElementById('phone').value.trim(),
    country:     document.getElementById('country').value.trim(),
    dietary:     document.getElementById('dietary').value.trim(),
    shirtSize:   document.getElementById('shirt-size').value,
    freeText:    document.getElementById('free-text') ? document.getElementById('free-text').value.trim() : '',
    fullBoard:   document.getElementById('full-board').checked,
    meals: {},
    gdprNoPublish:  document.getElementById('gdpr-no-publish').checked,
    thuExtraNight:  false,
    bypassToken:    CONFIG_CLIENT.BYPASS_TOKEN || '',
  };
  if (currentMode === 'join') {
    const ref = document.getElementById('room-ref-select').value;
    if (!ref) { showError('Please enter a booking reference to join.'); return; }
    data.roomRef = ref;
    data.joinExisting = true;
    // Detect if joining a camper spot or a room
    const isCamperJoin = avail && avail.openCampers && avail.openCampers.find(function(c){ return c.ref === ref; });
    data.type = isCamperJoin ? 'camper' : 'room';
    const thuEl = document.getElementById('thu-extra');
    data.thuExtraNight = thuEl ? thuEl.checked : false;
  } else {
    data.type = currentAccType; data.joinExisting = false;
    if (currentAccType === 'room') {
      const rt = document.querySelector('input[name="room-type"]:checked');
      if (!rt) { showError('Please select a room type.'); return; }
      data.roomId = rt.value;
      const soloEl = document.getElementById('solo-double');
      data.soloDouble = soloEl ? soloEl.checked : false;
      const thuEl = document.getElementById('thu-extra');
      data.thuExtraNight = thuEl ? thuEl.checked : false;
    } else if (currentAccType === 'singlebed') {
      const thuEl = document.getElementById('thu-extra');
      data.thuExtraNight = thuEl ? thuEl.checked : false;
    } else if (currentAccType === 'dayvisitor') {
      const dvEl = document.querySelector('input[name="dv-days"]:checked');
      if (!dvEl) { showError('Please select which day(s) you will attend.'); return; }
      data.dayVisitorDays = dvEl.value;
    }
  }
  if (!data.callsign || data.callsign.length < 3) { showError('Please enter a valid callsign.'); return; }
  if (!data.name)    { showError('Please enter your name.'); return; }
  if (!data.email)   { showError('Please enter a valid email.'); return; }
  if (!data.country) { showError('Please enter your country.'); return; }

  document.getElementById('loading').classList.add('visible');
  document.getElementById('submit-btn').disabled = true;

  google.script.run
    .withSuccessHandler(function(result) {
      document.getElementById('loading').classList.remove('visible');
      if (result && result.success) {
        // Keep button disabled — booking complete
        hide('form-section'); document.getElementById('landing-section').style.display = 'none';
        const ss = document.getElementById('success-screen');
        ss.style.display = 'block';
        document.getElementById('success-ref').textContent = result.bookingRef;
        if (data.type === 'room' && !data.joinExisting) {
          const base = CONFIG_CLIENT.FRIENDLY_URL || CONFIG_CLIENT.WEBAPP_URL;
          const joinUrl = base + '?join=' + encodeURIComponent(result.bookingRef);
          document.getElementById('success-join-link').style.display = 'block';
          document.getElementById('success-join-link').innerHTML =
            '<div class="info-box" style="text-align:left"><strong>Share this link with your roommates:</strong><br>'
            + '<a href="' + joinUrl + '" style="font-family:var(--mono);font-size:.85rem;word-break:break-all;color:var(--accent2)">' + joinUrl + '</a><br>'
            + '<span style="font-size:.82rem;color:var(--muted)">Opens the form with your room pre-selected.</span></div>';
        }
        if (result.price) {
          let html = '<div class="price-box">';
          result.price.breakdown.split(' | ').forEach(function(line) { html += '<div class="price-row"><span>' + line + '</span></div>'; });
          html += '<div class="price-row total"><span>TOTAL</span><span>\u20AC' + result.price.total + '</span></div></div>';
          document.getElementById('success-details').innerHTML = html;
        }
      } else {
        // Known error from server — re-enable button so user can fix and retry
        document.getElementById('submit-btn').disabled = false;
        showError((result && result.error) ? result.error : 'Booking failed — please try again.');
      }
    })
    .withFailureHandler(function(err) {
      document.getElementById('loading').classList.remove('visible');
      document.getElementById('submit-btn').disabled = false;
      showError('Server error: ' + (err && err.message ? err.message : String(err)));
    })
    .submitBooking(data);
}

function showError(msg) {
  const el = document.getElementById('form-msg');
  el.textContent = msg; el.className = 'msg error visible';
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
}

window.selectMode = selectMode;
window.openPublicPage = openPublicPage;
window.goBack = goBack;
window.hardRefresh = hardRefresh;
window.lookupJoinRef = lookupJoinRef;
window.onTypeChange = onTypeChange;
window.onRoomTypeChange = onRoomTypeChange;
window.updatePriceDisplay = updatePriceDisplay;

window.submitForm = submitForm;
window.showError = showError;
window.renderAvailability = renderAvailability;
window.renderRoomTypes = renderRoomTypes;
window.renderOpenRooms = renderOpenRooms;
window.onFullBoardChange = onFullBoardChange;
window.onThuExtraChange = onThuExtraChange;
window.updateFullBoardSub = updateFullBoardSub;
window.onJoinRoomSelect = onJoinRoomSelect;
window.initJoinFromRef = initJoinFromRef;
window.onload = function() {
  google.script.run
    .withSuccessHandler(function(data) {
      avail = data;
      // Merge live prices into CONFIG_CLIENT so price display is always current
      if (data.prices) {
        CONFIG_CLIENT.FULL_BOARD_PRICE        = data.prices.fullBoard;
        CONFIG_CLIENT.CAMPER_VAN_PRICE_PER_NIGHT = data.prices.camperPerNight;
        CONFIG_CLIENT.TENT_PRICE_WEEKEND      = data.prices.tentWeekend;
        CONFIG_CLIENT.SINGLE_BED_PRICE        = data.prices.singleBed;
        CONFIG_CLIENT.ROOM_PRICES             = data.prices.rooms;
        CONFIG_CLIENT.MEETING_FEE_WEEKEND     = data.prices.meetingFeeWeekend;
        CONFIG_CLIENT.MEETING_FEE_DAY         = data.prices.meetingFeeDay;
        CONFIG_CLIENT.MEAL_FRI_BBQ            = data.prices.mealFriBbq;
        CONFIG_CLIENT.MEAL_SAT_HAM_DINNER     = data.prices.mealSatHamDinner;
        CONFIG_CLIENT.MEAL_LUNCH              = data.prices.mealLunch;
      }
      var disclaimerEl = document.getElementById('price-disclaimer');
      if (disclaimerEl && CONFIG_CLIENT.PRICE_DISCLAIMER) {
        disclaimerEl.textContent = CONFIG_CLIENT.PRICE_DISCLAIMER;
      }
      renderAvailability(data);
      renderRoomTypes(data);
      const joinRef = CONFIG_CLIENT.INITIAL_JOIN || '';
      if (joinRef) {
        selectMode('join');
        setTimeout(function() { var js = document.getElementById('join-section'); if (js) js.scrollIntoView({behavior:'smooth',block:'start'}); }, 300);
      }
      renderOpenRooms(data);  // initialises join form if INITIAL_JOIN is set
    })
    .withFailureHandler(function(err) {
      document.getElementById('avail-grid').innerHTML = '<div style="color:var(--danger)">Error: ' + err.message + '</div>';
    })
    .getAvailability();
};
</script>
</body>
</html>`;
}

// =============================================================================
// SERVER-SIDE: Get public guest list
// =============================================================================
function getPublicGuestList() {
  const sheet = getSheet();
  const bookings = getConfirmedBookings(sheet);
  return bookings
    .filter(function(b) { return b.publishConsent !== "NO"; })
    .sort(function(a, b) {
      const numA = parseInt((a.bookingRef || "").split("-").pop()) || 0;
      const numB = parseInt((b.bookingRef || "").split("-").pop()) || 0;
      return numA - numB;
    })
    .map(function(b) {
      const firstName = (b.name || "").split(" ")[0];
      return {
        callsign: b.callsign || "",
        firstName: firstName,
        type: b.type || "room",
        isPrimaryBooker: b.isPrimaryBooker === "YES",
        isOrganizer: b.isOrganizer === "YES",
      };
    });
}

// =============================================================================
// HTML — PUBLIC PAGE
// =============================================================================
function buildPublicPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Who's Coming — Nordic VUSHF Meeting 2026</title>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#f0f2f5; --surface:#ffffff; --border:#d0d7de;
    --accent:#b45309; --accent2:#1d6fa5; --text:#1c2128; --muted:#57606a;
    --success:#1a7f37; --mono:'Share Tech Mono',monospace; --sans:'Barlow',sans-serif;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:17px;min-height:100vh}
  .container{max-width:800px;margin:0 auto;padding:2.5rem 1.5rem 4rem}
  .header{text-align:center;margin-bottom:2.5rem;padding-bottom:1.5rem;border-bottom:2px solid var(--border)}
  .header-badge{font-family:var(--mono);font-size:0.75rem;color:var(--accent);letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem}
  .header h1{font-size:2rem;font-weight:700;margin-bottom:0.4rem}
  .header h1 span{color:var(--accent)}
  .header .sub{font-size:1rem;color:var(--muted);font-weight:300}
  .header .dates{margin-top:1rem;display:flex;justify-content:center;gap:1rem;flex-wrap:wrap}
  .date-pill{font-family:var(--mono);font-size:0.8rem;padding:0.3rem 0.9rem;border:2px solid var(--accent);color:var(--accent);border-radius:3px;font-weight:600}
  .count-bar{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1.25rem 1.5rem;margin-bottom:2rem;display:flex;align-items:center;gap:1rem;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
  .count-num{font-family:var(--mono);font-size:2.5rem;font-weight:700;color:var(--accent);line-height:1}
  .count-label{font-size:1rem;color:var(--muted)}
  .count-label strong{color:var(--text);display:block;font-size:1.1rem}
  .guest-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.75rem}
  .guest-card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1rem 1.1rem;box-shadow:0 1px 3px rgba(0,0,0,0.05);transition:box-shadow 0.15s,border-color 0.15s}
  .guest-card:hover{box-shadow:0 3px 8px rgba(0,0,0,0.1);border-color:var(--accent2)}
  .guest-callsign{font-family:var(--mono);font-size:1.05rem;font-weight:700;color:var(--accent2);letter-spacing:0.05em}
  .guest-name{font-size:0.95rem;color:var(--muted);margin-top:0.2rem}
  .guest-type{font-size:0.85rem;font-family:var(--mono);margin-top:0.4rem;color:var(--border)}
  .guest-type.camper{color:var(--accent)}
  .guest-type.tent{color:var(--success)}
  .guest-type.hotel{color:var(--accent2)}
  .guest-type.dayvisitor{color:var(--muted)}
  .guest-type.organizer{color:#7c3aed}
  .loading{text-align:center;color:var(--muted);padding:3rem;font-family:var(--mono);font-size:0.9rem}
  .spinner{width:30px;height:30px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.7s linear infinite;margin:0 auto 1rem}
  @keyframes spin{to{transform:rotate(360deg)}}
  .footer{text-align:center;margin-top:3rem;font-size:0.78rem;color:var(--muted);font-family:var(--mono)}
  .refresh-btn{display:inline-block;margin-top:1.5rem;padding:0.5rem 1.25rem;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:var(--sans);font-size:0.9rem;cursor:pointer;border-radius:4px}
  .refresh-btn:hover{border-color:var(--accent2);color:var(--accent2)}
  .updated{font-size:0.75rem;color:var(--muted);font-family:var(--mono);margin-top:0.5rem}
  @media(max-width:600px){
    .container{padding:0.5rem 0.5rem 2rem}
    .guest-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:0.5rem}
    .guest-card{padding:0.5rem 0.6rem}
    .guest-callsign{font-size:0.9rem}
    .guest-name{font-size:0.75rem}
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="header-badge">Participants</div>
    <div style="display:flex;align-items:center;justify-content:center;gap:1.5rem;margin-bottom:1rem;flex-wrap:wrap;">
      <img src="https://rats.fi/wp-content/uploads/2026/02/vushf26-logo-small.png" alt="Nordic VUSHF Meeting 2026" style="max-height:100px;width:auto;">
      <img src="https://rats.fi/wp-content/uploads/2015/06/cropped-RATSrotta-286x300.jpg" alt="RATS" style="max-height:80px;width:auto;">
    </div>
    <div class="sub">RATS – Radio Amateur Technology Society of Finland<br>Hotelli Martinhovi, Raisio, Finland</div>
  </div>

  <div id="count-bar" class="count-bar" style="display:none">
    <div class="count-num" id="guest-count">0</div>
    <div class="count-label"><strong>Registered participants</strong></div>
  </div>

  <div id="loading" class="loading">
    <div class="spinner"></div>
    Loading participants...
  </div>

  <div id="guest-grid" class="guest-grid"></div>

  <div style="text-align:center">
    <button class="refresh-btn" onclick="loadGuests()">&#8635; Refresh</button>
    <div class="updated" id="updated-time"></div>
    <div style="margin-top:0.75rem">
      <a href="${CONFIG.FRIENDLY_URL || CONFIG.WEBAPP_URL}" style="font-family:var(--sans);font-size:0.85rem;color:var(--muted);text-decoration:none;border-bottom:1px solid var(--border)">← Back to main page</a>
    </div>
  </div>

  <div class="footer">
    Nordic VUSHF Meeting 2026 &nbsp;&middot;&nbsp; RATS &nbsp;&middot;&nbsp; 15&ndash;17 May 2026
  </div>
</div>
<script>
function loadGuests() {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('guest-grid').innerHTML = '';
  document.getElementById('count-bar').style.display = 'none';

  google.script.run
    .withSuccessHandler(function(guests) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('count-bar').style.display = 'flex';
      document.getElementById('guest-count').textContent = guests.length;

      const grid = document.getElementById('guest-grid');
      if (guests.length === 0) {
        grid.innerHTML = '<div style="color:var(--muted);grid-column:1/-1;text-align:center;padding:2rem;font-size:1rem">No registrations yet — be the first!</div>';
        return;
      }
      grid.innerHTML = guests.map(function(g) {
        var badge = '';
        if (g.isOrganizer) {
          badge = '<div class="guest-type organizer">👷 staff</div>';
        } else if (g.type === 'camper') {
          badge = '<div class="guest-type camper">🚐 camper</div>';
        } else if (g.type === 'tent') {
          badge = '<div class="guest-type tent">⛺ tent</div>';
        } else if (g.type === 'dayvisitor') {
          badge = '<div class="guest-type dayvisitor">🎫 day visitor</div>';
        } else if (g.type === 'room' || g.type === 'singlebed') {
          badge = '<div class="guest-type hotel">🏨 hotel</div>';
        }
        return '<div class="guest-card">'
          + '<div class="guest-callsign">' + g.callsign + '</div>'
          + '<div class="guest-name">' + g.firstName + '</div>'
          + badge
          + '</div>';
      }).join('');

      document.getElementById('updated-time').textContent =
        'Updated: ' + new Date().toLocaleTimeString();
    })
    .withFailureHandler(function(err) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('guest-grid').innerHTML =
        '<div style="color:red;grid-column:1/-1">Error: ' + err.message + '</div>';
    })
    .getPublicGuestList();
}

window.loadGuests = loadGuests;
window.onload = loadGuests;
</script>
</body>
</html>`;
}

// =============================================================================
// HTML — ADMIN PAGE
// =============================================================================
function getAdminConfigJson_() {
  const settings = getSettings_();
  return {
    CAMPER_VAN_SPOTS: settings.CAMPER_VAN_SPOTS,
    TENT_SPOTS: settings.TENT_SPOTS,
    ROOMS: CONFIG.ROOMS.map(function(r) {
      return {
        id: r.id,
        note_en: r.note_en || r.type,
        persons: r.persons,
        count: (settings.ROOM_COUNTS && settings.ROOM_COUNTS[r.id] !== undefined) ? settings.ROOM_COUNTS[r.id] : r.count
      };
    })
  };
}

function buildAdminPageDebug() {
  const html = buildAdminPage();
  const lines = html.split("\n");
  for (let i = 0; i < lines.length; i++) {
    Logger.log((i+1) + ": " + lines[i]);
  }
}

function getAdminPanelHtml(pw) {
  if (pw !== CONFIG.ADMIN_PASSWORD) return null;
  return `
<div id="admin-panel">
  <div style="display:flex;align-items:center;gap:1.25rem;margin-bottom:0.25rem">
    <img src="https://rats.fi/wp-content/uploads/2026/02/vushf26-logo-small.png" alt="Nordic VUSHF 2026" style="height:60px;width:auto;">
    <img src="https://rats.fi/wp-content/uploads/2015/06/cropped-RATSrotta-286x300.jpg" alt="RATS" style="height:50px;width:auto;">
    <div style="flex:1">
      <h1>Nordic <span>VUSHF</span> 2026 — Booking Admin</h1>
      <div class="sub" style="margin-bottom:0">RATS · Hotelli Martinhovi, Raisio · 15–17 May 2026</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <button id="header-refresh-btn" class="export-btn" style="float:none;margin:0 0 0.4rem 0" onclick="loadAdmin()">↺ Refresh</button>
      <div style="font-size:0.75rem;color:var(--muted);font-family:var(--mono)">This page does not auto-refresh</div>
      <div id="header-refresh-ts" style="font-size:0.75rem;color:var(--muted);font-family:var(--mono)"></div>
      <button onclick="localStorage.removeItem('vushf_admin_pw');location.reload()" style="margin-top:0.4rem;background:none;border:none;font-size:0.72rem;color:var(--muted);cursor:pointer;font-family:var(--mono)" title="Kirjaudu ulos">🔒 Kirjaudu ulos</button>
    </div>
  </div>
  <div class="sub"></div>

  <div class="stats" id="stats"></div>

  <div class="settings-panel">
    <h3>⚙️ Registration Settings</h3>
    <div class="settings-grid">
      <div class="setting-item">
        <div class="setting-label">Registration open
          <div class="hint">Uncheck to close registration. Deadline date overrides this automatically.</div>
        </div>
        <label class="toggle"><input type="checkbox" id="s-reg-open" checked><span class="toggle-slider"></span></label>
      </div>
      <div id="reg-open-warning" style="display:none;background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;padding:0.6rem 0.85rem;font-size:0.82rem;color:#92400e;margin-bottom:0.5rem">
        &#9888; <strong>Note:</strong> You are opening registration after the set deadline. Remember to close it again when done.
      </div>
      </div>
      <div class="setting-item">
        <div class="setting-label">Registration closes
          <div class="hint">e.g. 2026-04-30 — registration closes automatically at 23:59 local time on this date</div>
        </div>
        <input type="text" class="setting-input" id="s-reg-closes" placeholder="YYYY-MM-DD">
      </div>
      <div class="setting-item">
        <div class="setting-label">Allow solo double room
          <div class="hint">One person books entire double</div>
        </div>
        <label class="toggle"><input type="checkbox" id="s-solo-double"><span class="toggle-slider"></span></label>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.6rem">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
          <div class="setting-label">Allow single bed booking
            <div class="hint">Enables the single bed option in the booking form</div>
          </div>
          <label class="toggle"><input type="checkbox" id="s-single-bed"><span class="toggle-slider"></span></label>
        </div>
        <div style="font-size:0.8rem;color:var(--muted);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.6rem 0.75rem;line-height:1.6;width:100%;box-sizing:border-box">
          ℹ️ The single bed option is <strong>only shown to guests</strong> when all conditions are met:<br>
          1. All <strong>single rooms</strong> (1S-W and 1S-NW) are <strong>fully booked</strong><br>
          2. At least one <strong>multi-person room</strong> has a free bed and is <strong>not marked solo</strong>
        </div>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Announcement banner
          <div class="hint">Shown prominently on the booking front page. Leave empty to hide.</div>
        </div>
        <textarea id="s-announcement" rows="3" style="width:100%;font-family:var(--sans);font-size:0.85rem;padding:0.4rem 0.6rem;border:1.5px solid #d1d5db;border-radius:3px;resize:vertical;box-sizing:border-box" placeholder="e.g. Registration closes Friday 10 April at 23:59"></textarea>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Registration closed message
          <div class="hint">Shown on the booking page when registration is closed. Leave empty to show default text only.</div>
        </div>
        <textarea id="s-closed-message" rows="3" style="width:100%;font-family:var(--sans);font-size:0.85rem;padding:0.4rem 0.6rem;border:1.5px solid #d1d5db;border-radius:3px;resize:vertical;box-sizing:border-box" placeholder="e.g. Registration for Nordic VUSHF 2026 is now closed. Thank you for your interest!"></textarea>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Bypass link (secret registration link)
          <div class="hint">Anyone with this link can register even when registration is closed. Leave empty to disable. Regenerate to invalidate old links.</div>
        </div>
        <div style="display:flex;gap:0.5rem;width:100%;align-items:center">
          <input type="text" id="s-bypass-token" class="setting-input" style="flex:1;font-family:var(--mono);font-size:0.82rem" placeholder="Empty = disabled" readonly>
          <button type="button" id="btn-generate-bypass" class="export-btn" style="white-space:nowrap">↺ Regenerate</button>
          <button type="button" id="btn-clear-bypass" class="export-btn" style="white-space:nowrap">✕ Clear</button>
        </div>
        <div id="bypass-link-display" style="display:none;width:100%;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;padding:0.5rem 0.75rem;font-size:0.78rem;word-break:break-all;font-family:var(--mono);color:#166534"></div>
      </div>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Camper van info text
          <div class="hint">Shown on booking page when camper van is selected, and in confirmation emails to camper guests.</div>
        </div>
        <textarea id="s-camper-info" rows="4" style="width:100%;font-family:var(--sans);font-size:0.85rem;padding:0.4rem 0.6rem;border:1.5px solid #d1d5db;border-radius:3px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Tent info text
          <div class="hint">Shown on booking page when tent is selected, and in confirmation emails to tent guests.</div>
        </div>
        <textarea id="s-tent-info" rows="4" style="width:100%;font-family:var(--sans);font-size:0.85rem;padding:0.4rem 0.6rem;border:1.5px solid #d1d5db;border-radius:3px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Price disclaimer
          <div class="hint">Shown on booking page and in confirmation emails. Leave empty to hide.</div>
        </div>
        <textarea id="s-price-disclaimer" rows="2" style="width:100%;font-family:var(--sans);font-size:0.85rem;padding:0.4rem 0.6rem;border:1.5px solid #d1d5db;border-radius:3px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div class="setting-item">
        <div class="setting-label">Tent spots enabled
          <div class="hint">Uncheck to hide tent option from guests</div>
        </div>
        <label class="toggle"><input type="checkbox" id="s-tent-enabled" checked><span class="toggle-slider"></span></label>
      </div>
    </div>
    <div style="display:flex;align-items:center">
      <button class="btn-settings-save" onclick="saveSettings()">Save settings</button>
      <span class="settings-msg" id="settings-msg"></span>
    </div>

    <hr class="divider" style="margin-top:1.5rem">
    <h3 style="font-size:0.85rem;font-family:var(--mono);color:var(--muted);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:0.9rem">💶 Pricing</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0.6rem;margin-bottom:1rem" id="pricing-grid">
      <div class="setting-item">
        <div class="setting-label">Full board meal package (€/person)</div>
        <input type="number" class="setting-input" id="s-fullboard-price" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Camper van spot (€/night)</div>
        <input type="number" class="setting-input" id="s-camper-price" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Tent spot, weekend (€)</div>
        <input type="number" class="setting-input" id="s-tent-price" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Single bed, organizer-assigned (€)</div>
        <input type="number" class="setting-input" id="s-singlebed-price" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Single bed slots available
          <div class="hint">How many single bed bookings to offer (0 = disabled)</div>
        </div>
        <input type="number" class="setting-input" id="s-singlebed-slots" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Meeting fee — full weekend (€)</div>
        <input type="number" class="setting-input" id="s-meeting-fee-weekend" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Meeting fee — single day (€)</div>
        <input type="number" class="setting-input" id="s-meeting-fee-day" min="0" style="width:90px">
      </div>
    </div>
    </div>
    <div id="room-prices-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0.6rem;margin-bottom:1rem"></div>
    <div style="display:flex;align-items:center">
      <button class="btn-settings-save" onclick="savePricing()">Save pricing</button>
      <span class="settings-msg" id="pricing-msg"></span>
    </div>

    <hr class="divider" style="margin-top:1.5rem">
    <h3 style="font-size:0.85rem;font-family:var(--mono);color:var(--muted);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:0.9rem">🏨 Room Inventory</h3>
    <div id="room-counts-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0.6rem;margin-bottom:0.6rem"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0.6rem;margin-bottom:1rem">
      <div class="setting-item">
        <div class="setting-label">Camper van spots</div>
        <input type="number" class="setting-input" id="rc-camper" min="0" max="99" style="width:70px;text-align:center">
      </div>
      <div class="setting-item">
        <div class="setting-label">Tent spots</div>
        <input type="number" class="setting-input" id="rc-tent" min="0" max="99" style="width:70px;text-align:center">
      </div>
    </div>
    <div style="display:flex;align-items:center">
      <button class="btn-settings-save" onclick="saveRoomCounts()">Save inventory</button>
      <span class="settings-msg" id="room-counts-msg"></span>
    </div>
  </div>

  <div style="margin-top:1.5rem;display:flex;gap:0.5rem;margin-bottom:1rem;align-items:center">
    <button id="table-refresh-btn" class="export-btn" style="float:none;margin:0" onclick="loadAdmin()">↺ Refresh</button>
    <button class="export-btn" style="float:none;margin:0" onclick="exportCSV()">⬇ Export CSV</button>
    <button class="export-btn" style="float:none;margin:0" id="recalc-btn" onclick="recalcAllPrices()" title="Recalculate prices for all bookings">🔄 Recalculate prices</button>
    <button class="export-btn" style="float:none;margin:0" id="sort-reset-btn" onclick="adminResetSort()" title="Return to default grouped view">✕ Clear sort</button>
    <span id="table-refresh-ts" style="font-size:0.75rem;color:var(--muted);font-family:var(--mono);margin-left:0.5rem"></span>
  </div>
  <div class="table-wrap">
    <table id="bookings-table">
      <thead><tr id="table-head"></tr></thead>
      <tbody id="table-body"></tbody>
    </table>
  </div>
</div>

<div id="edit-modal" onclick="if(event.target===this)closeEdit()">
  <div class="modal-box">
    <h3>✏️ Edit booking: <span id="edit-ref"></span></h3>
    <div class="modal-row2">
      <div class="modal-field">
        <label>Callsign</label>
        <input type="text" id="edit-callsign" style="text-transform:uppercase">
      </div>
      <div class="modal-field">
        <label>Name</label>
        <input type="text" id="edit-name">
      </div>
    </div>
    <div class="modal-row2">
      <div class="modal-field">
        <label>Email</label>
        <input type="email" id="edit-email">
      </div>
      <div class="modal-field">
        <label>Phone</label>
        <input type="tel" id="edit-phone">
      </div>
    </div>
    <div class="modal-row2">
      <div class="modal-field">
        <label>Country</label>
        <input type="text" id="edit-country">
      </div>
      <div class="modal-field">
        <label>Status</label>
        <select id="edit-status">
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="NEEDS_ATTENTION">NEEDS_ATTENTION</option>
        </select>
      </div>
    </div>
    <div class="modal-field" id="edit-dayvisitor-days-row" style="display:none">
      <label>Day visitor days</label>
      <select id="edit-dayvisitor-days">
        <option value="fri">Friday 15.5 only</option>
        <option value="sat">Saturday 16.5 only</option>
        <option value="both">Friday + Saturday (both days)</option>
      </select>
    </div>
    <div class="modal-field">
      <label>Dietary requirements</label>
      <input type="text" id="edit-dietary">
    </div>
    <div class="modal-row2" style="margin-top:0.75rem">
      <div class="modal-field" style="flex-direction:row;align-items:center;gap:0.5rem">
        <input type="checkbox" id="edit-fullboard" style="width:auto;margin:0">
        <label style="margin:0">Full board meal package</label>
      </div>
      <div class="modal-field" style="flex-direction:row;align-items:center;gap:0.5rem">
        <input type="checkbox" id="edit-thuextra" style="width:auto;margin:0">
        <label style="margin:0">Thursday extra night</label>
      </div>
    </div>
    <div class="modal-field" style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:0.5rem">
      <input type="checkbox" id="edit-soloroom" style="width:auto;margin:0">
      <label style="margin:0">Solo room <span class="tag solo" style="font-size:0.7rem">SOLO</span></label>
    </div>
    <div class="modal-field" style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:0.5rem">
      <input type="checkbox" id="edit-publish" style="width:auto;margin:0">
      <label style="margin:0">Publish consent <span style="font-size:0.78rem;color:var(--muted)">(appears on Who's coming?)</span></label>
    </div>
    <div class="modal-field" style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:0.5rem">
      <input type="checkbox" id="edit-isorganizer" style="width:auto;margin:0">
      <label style="margin:0">👷 Staff <span style="font-size:0.78rem;color:#7c3aed">(shows organizer badge on Who's coming?)</span></label>
    </div>
    <hr class="divider">
    <div class="modal-field">
      <label class="org-label">🔒 Room number (organizers only)</label>
      <input type="text" id="edit-roomnum" placeholder="e.g. 214">
    </div>
    <div class="modal-field">
      <label class="org-label">💬 Additional info from booker</label>
      <textarea id="edit-freetext" placeholder="(none)" style="background:#fff;color:#111;border:1.5px solid #d1d5db"></textarea>
    </div>
    <div class="modal-field">
      <label class="org-label">🔒 Organizer comment (internal only)</label>
      <textarea id="edit-orgcomment" placeholder="Internal notes..."></textarea>
    </div>

    <div id="role-change-section" style="display:none;margin-top:1.25rem;border-top:1px solid var(--border);padding-top:1.25rem">
      <div style="font-weight:700;margin-bottom:0.75rem;font-size:0.95rem">🔄 Change role</div>

      <div id="role-joiner-to-primary" style="display:none">
        <div style="font-size:0.88rem;color:var(--muted);margin-bottom:0.6rem">This person is currently a <strong>joiner</strong>. Promote to primary booker by assigning a free room:</div>
        <div class="modal-field">
          <label>Assign room type</label>
          <select id="role-room-select"><option value="">— select room —</option></select>
        </div>
        <button id="btn-promote-to-primary" style="background:#16a34a;color:#fff;border:none;border-radius:4px;padding:0.5rem 1.25rem;font-size:0.9rem;cursor:pointer;margin-top:0.25rem">⬆️ Promote to primary booker</button>
      </div>

      <div id="role-primary-to-joiner" style="display:none">
        <div style="font-size:0.88rem;color:var(--muted);margin-bottom:0.6rem">This person is currently the <strong>primary booker</strong>. Move them as a joiner into another room:</div>
        <div class="modal-field">
          <label>Join room (booking ref)</label>
          <select id="role-target-room-select"><option value="">— select room —</option></select>
        </div>
        <div id="role-joiner-warning" style="display:none;background:#fffbeb;border:1px solid var(--accent);border-radius:4px;padding:0.6rem 0.8rem;font-size:0.85rem;margin-top:0.5rem;color:#92400e"></div>
        <button id="btn-move-to-joiner" style="background:#b45309;color:#fff;border:none;border-radius:4px;padding:0.5rem 1.25rem;font-size:0.9rem;cursor:pointer;margin-top:0.5rem">⬇️ Move to joiner</button>
      </div>

      <div id="role-change-result" style="display:none;margin-top:0.75rem;padding:0.6rem 0.8rem;border-radius:4px;font-size:0.88rem"></div>
    </div>

    <div class="modal-actions">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
        <input type="checkbox" id="edit-send-email" style="width:auto;margin:0" checked>
        <label for="edit-send-email" style="margin:0;font-size:0.85rem;color:var(--muted)">Send change notification email to guest</label>
      </div>
      <div style="display:flex;gap:0.75rem">
        <button class="btn-cancel" onclick="closeEdit()">Cancel</button>
        <button class="btn-save" id="edit-save-btn" onclick="saveEdit()">Save</button>
      </div>
    </div>
  </div>
</div>

<div id="acc-change-modal" onclick="if(event.target===this)closeAccChange()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;align-items:center;justify-content:center;padding:1rem">
  <div style="background:var(--surface);border-radius:8px;padding:1.5rem;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.3)">
    <h3 style="margin-bottom:0.25rem">🛏️ Change accommodation</h3>
    <div id="acc-change-who" style="font-family:var(--mono);font-size:0.85rem;color:var(--muted);margin-bottom:1.25rem"></div>

    <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.75rem;margin-bottom:1rem;font-size:0.88rem">
      <div style="font-weight:600;margin-bottom:0.2rem">Current</div>
      <div id="acc-current-desc" style="color:var(--muted)"></div>
      <div id="acc-current-price" style="font-family:var(--mono);margin-top:0.2rem"></div>
    </div>

    <div class="modal-field">
      <label>New accommodation type</label>
      <select id="acc-new-type" onchange="onAccTypeChange()">
        <option value="room">🏨 Hotel room</option>
        <option value="camper">🚐 Camper van spot</option>
        <option value="tent">⛺ Tent</option>
        <option value="singlebed">🛏️ Single bed (organizer-assigned)</option>
        <option value="dayvisitor">🎫 Day visitor</option>
      </select>
    </div>

    <div id="acc-room-picker" style="display:none">
      <div class="modal-field">
        <label>Room type</label>
        <select id="acc-new-room-id" onchange="onAccRoomChange()">
        </select>
      </div>
    </div>

    <div id="acc-new-info" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.75rem;margin-top:0.75rem;font-size:0.88rem;display:none">
      <div style="font-weight:600;margin-bottom:0.4rem">New accommodation</div>
      <div id="acc-new-desc" style="color:var(--muted);margin-bottom:0.2rem"></div>
      <div id="acc-new-capacity" style="color:var(--muted);margin-bottom:0.2rem"></div>
      <div id="acc-new-price" style="font-family:var(--mono);margin-top:0.2rem"></div>
      <div id="acc-price-diff" style="font-family:var(--mono);font-weight:600;margin-top:0.2rem"></div>
    </div>

    <div id="acc-warning" style="display:none;background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;padding:0.6rem 0.75rem;margin-top:0.75rem;font-size:0.85rem;color:#92400e"></div>

    <div style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:1rem;display:flex">
      <input type="checkbox" id="acc-send-email" style="width:auto;margin:0" checked>
      <label style="margin:0;font-size:0.9rem">Send change notification email to guest</label>
    </div>

    <div id="acc-save-msg" style="display:none;margin-top:0.75rem;font-size:0.85rem;padding:0.5rem 0.75rem;border-radius:4px"></div>

    <div style="display:flex;gap:0.75rem;margin-top:1.25rem">
      <button class="btn-cancel" onclick="closeAccChange()">Cancel</button>
      <button class="btn-save" id="acc-save-btn" onclick="saveAccChange()">Save change</button>
    </div>
  </div>
</div>`;
}


function buildAdminPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin — Nordic VUSHF 2026</title>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#0d1117;--surface:#161b22;--border:#30363d;
    --accent:#f0a500;--accent2:#58a6ff;--text:#e6edf3;--muted:#8b949e;
    --danger:#f85149;--success:#3fb950;
    --mono:'Share Tech Mono',monospace;--sans:'Barlow',sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;padding:2rem 1rem}
  h1{font-size:1.4rem;margin-bottom:0.25rem}
  h1 span{color:var(--accent)}
  .sub{color:var(--muted);font-size:0.8rem;margin-bottom:2rem}
  .login-box{max-width:360px;margin:4rem auto;background:var(--surface);border:1px solid var(--border);padding:2rem;border-radius:4px}
  .login-box h2{margin-bottom:1.5rem;font-size:1.1rem}
  input[type=password]{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.6rem 0.75rem;font-family:var(--mono);border-radius:3px;margin-bottom:1rem;outline:none}
  input[type=password]:focus{border-color:var(--accent2)}
  .btn{padding:0.6rem 1.25rem;background:var(--accent);color:#000;border:none;font-weight:700;cursor:pointer;border-radius:3px;font-family:var(--sans)}
  .btn:hover{background:#ffc107}
  .stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1rem;margin-bottom:2rem}
  .stat{background:var(--surface);border:1px solid var(--border);padding:1rem;border-radius:3px}
  .stat .label{font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:0.4rem}
  .stat .value{font-family:var(--mono);font-size:1.5rem;color:var(--accent)}
  table{width:100%;border-collapse:collapse;font-size:0.8rem}
  th{background:var(--surface);padding:0.5rem 0.75rem;text-align:left;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)}
  td{padding:0.45rem 0.75rem;border-bottom:1px solid rgba(48,54,61,0.5);vertical-align:top}
  tr:hover td{background:rgba(88,166,255,0.03)}
  .tag{display:inline-block;padding:0.15rem 0.4rem;border-radius:2px;font-size:0.65rem;font-family:var(--mono)}
  .tag.room{background:rgba(88,166,255,0.15);color:var(--accent2)}
  .tag.camper{background:rgba(240,165,0,0.15);color:var(--accent)}
  .tag.tent{background:rgba(63,185,80,0.15);color:var(--success)}
  .tag.yes{background:rgba(63,185,80,0.15);color:var(--success)}
  .tag.no{background:rgba(48,54,61,0.5);color:var(--muted)}
  .tag.solo{background:rgba(139,92,246,0.2);color:#a78bfa;font-weight:700;letter-spacing:0.05em}
  .tag.primary{background:rgba(180,83,9,0.15);color:var(--accent);font-weight:700;letter-spacing:0.05em}
  .tag.joiner{background:rgba(88,166,255,0.12);color:var(--accent2);letter-spacing:0.05em}
  .tag.tag-camper{background:rgba(240,165,0,0.18);color:var(--accent);font-weight:700;letter-spacing:0.05em}
  .tag.dayvisitor{background:rgba(63,185,80,0.15);color:var(--success);font-weight:700;letter-spacing:0.05em}
  .tag.status-CONFIRMED{background:rgba(63,185,80,0.15);color:var(--success)}
  .tag.status-CANCELLED{background:rgba(248,81,73,0.15);color:var(--danger)}
  .tag.status-NEEDS_ATTENTION{background:rgba(240,165,0,0.25);color:var(--accent)}
  tr.status-cancelled td{opacity:0.45;text-decoration:line-through}
  tr.status-attention td{background:rgba(240,165,0,0.08);}
  tr.status-attention td{background:rgba(240,165,0,0.07)}
  tr.status-attention{outline:1px solid rgba(240,165,0,0.4)}
  .err{color:var(--danger);padding:1rem}
  .table-wrap{overflow-x:auto}
  .settings-panel{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1.5rem;margin-bottom:2rem}
  .settings-panel h3{font-family:var(--mono);font-size:0.85rem;color:var(--accent);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:1.25rem}
  .settings-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;margin-bottom:1.25rem}
  .setting-item{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0.6rem 0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:4px}
  .setting-label{font-size:0.82rem;line-height:1.4}
  .setting-label .hint{font-size:0.72rem;color:var(--muted);margin-top:0.15rem}
  .toggle{position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0}
  .toggle input{opacity:0;width:0;height:0}
  .toggle-slider{position:absolute;inset:0;background:var(--border);border-radius:22px;cursor:pointer;transition:0.2s}
  .toggle-slider:before{content:"";position:absolute;width:16px;height:16px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:0.2s}
  .toggle input:checked + .toggle-slider{background:var(--success)}
  .toggle input:checked + .toggle-slider:before{transform:translateX(18px)}
  .setting-input{background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.35rem 0.6rem;font-family:var(--mono);font-size:0.85rem;border-radius:3px;width:130px;outline:none}
  .setting-input:focus{border-color:var(--accent2)}
  .btn-settings-save{padding:0.5rem 1.25rem;background:var(--accent);color:#000;border:none;font-weight:700;cursor:pointer;border-radius:3px;font-family:var(--sans);font-size:0.9rem}
  .btn-settings-save:hover{background:#ffc107}
  .settings-msg{font-size:0.82rem;margin-left:1rem;color:var(--success)}
  .export-btn{float:right;margin-bottom:1rem;padding:0.4rem 0.9rem;background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:0.8rem;cursor:pointer;border-radius:3px;font-family:var(--sans)}
  .export-btn:hover{border-color:var(--accent2)}
  .edit-btn{background:none;border:1px solid var(--border);color:var(--muted);padding:0.2rem 0.5rem;cursor:pointer;border-radius:3px;font-size:0.8rem}
  .edit-btn:hover{border-color:var(--accent2);color:var(--accent2)}
  .org-field{font-size:0.8rem}
  #edit-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;align-items:center;justify-content:center;padding:1rem}
  .modal-box{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:2rem;width:100%;max-width:520px;max-height:90vh;overflow-y:auto}
  .modal-box h3{font-size:1rem;margin-bottom:1.25rem;color:var(--accent);font-family:var(--mono)}
  .modal-field{margin-bottom:0.9rem}
  .modal-field label{display:block;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:0.3rem}
  .modal-field input,.modal-field select,.modal-field textarea{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.5rem 0.65rem;font-family:var(--sans);font-size:0.9rem;border-radius:3px;outline:none}
  .modal-field input:focus,.modal-field select:focus,.modal-field textarea:focus{border-color:var(--accent2)}
  .modal-field textarea{min-height:60px;resize:vertical}
  .modal-field .org-label{font-size:0.65rem;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em}
  .modal-row2{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem}
  .modal-actions{display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border)}
  .btn-cancel{padding:0.5rem 1rem;background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;border-radius:3px;font-family:var(--sans)}
  .btn-save{padding:0.5rem 1.25rem;background:var(--accent);color:#000;border:none;font-weight:700;cursor:pointer;border-radius:3px;font-family:var(--sans)}
  .btn-save:hover{background:#ffc107}
  .divider{border:none;border-top:1px solid var(--border);margin:1rem 0}
  @media(max-width:700px){
    body{font-size:14px}
    .stats{grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0.6rem}
    .stat{padding:0.75rem}
    .stat .value{font-size:1.2rem}
    .settings-grid{grid-template-columns:1fr}
    .export-btn{float:none;display:block;width:100%;margin-bottom:0.75rem;text-align:center}
    .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
    table{min-width:600px;font-size:0.75rem}
    th,td{padding:0.35rem 0.5rem;white-space:nowrap}
    #edit-modal{align-items:flex-end;padding:0}
    .modal-box{max-width:100%;width:100%;max-height:92vh;border-radius:10px 10px 0 0;padding:1.25rem 1rem}
    .modal-row2{grid-template-columns:1fr}
    .login-box{margin:1.5rem auto;padding:1.25rem 1rem}
  }
</style>
</head>
<body>

<div class="login-box" id="login-box">
  <h2>🔒 Admin — Nordic VUSHF 2026</h2>
  <input type="password" id="admin-pw" placeholder="Password">
  <button class="btn" id="login-btn">Login</button>
  <div style="color:var(--danger);font-size:0.8rem;margin-top:0.75rem" id="pw-err"></div>
</div>


<script>
let adminPw = '';
var currentAdminData = null;
let allRows = [];
let allHeaders = [];
const CONFIG_ADMIN = ${JSON.stringify(getAdminConfigJson_())};
console.log('%c Nordic VUSHF 2026 Admin %c v${VERSION} ', 'background:#7c3aed;color:#fff;font-weight:bold', 'background:#e5e7eb;color:#374151');

window.exportCSV = exportCSV;
window.openEdit = openEdit;
window.closeEdit = closeEdit;
window.saveEdit = saveEdit;
window.loadAdmin = loadAdmin;
window.openAccChange = openAccChange;
window.closeAccChange = closeAccChange;
window.saveAccChange = saveAccChange;
window.onAccTypeChange = onAccTypeChange;
window.onAccRoomChange = onAccRoomChange;
window.doRoleChange = doRoleChange;

function doRoleChange(newRole) {
  var ref = document.getElementById('edit-modal')._ref;
  var pw = adminPw;
  var params = { newRole: newRole };
  var resultBox = document.getElementById('role-change-result');

  console.log('doRoleChange called', newRole, 'ref:', ref, 'pw set:', !!pw);

  if (newRole === 'primary') {
    params.targetRoomId = document.getElementById('role-room-select').value;
    console.log('targetRoomId:', params.targetRoomId);
    if (!params.targetRoomId) { alert('Please select a room type.'); return; }
  } else {
    params.targetRoomRef = document.getElementById('role-target-room-select').value;
    console.log('targetRoomRef:', params.targetRoomRef);
    if (!params.targetRoomRef) { alert('Please select a target room.'); return; }
  }

  resultBox.style.display = 'none';
  console.log('Calling changeRole server function...');
  google.script.run
    .withSuccessHandler(function(res) {
      if (!res.success) {
        resultBox.style.cssText = 'display:block;background:rgba(248,81,73,0.1);border:1px solid var(--danger);border-radius:4px;padding:0.6rem 0.8rem;font-size:0.88rem;color:var(--danger)';
        resultBox.textContent = '❌ ' + res.error;
      } else {
        resultBox.style.cssText = 'display:block;background:rgba(22,163,74,0.1);border:1px solid #16a34a;border-radius:4px;padding:0.6rem 0.8rem;font-size:0.88rem;color:#16a34a';
        resultBox.textContent = '✅ ' + res.message;
        setTimeout(function() { closeEdit(); loadAdmin(); }, 1500);
      }
    })
    .withFailureHandler(function(err) {
      resultBox.style.cssText = 'display:block;background:rgba(248,81,73,0.1);border:1px solid var(--danger);border-radius:4px;padding:0.6rem 0.8rem;font-size:0.88rem;color:var(--danger)';
      resultBox.textContent = '❌ Server error: ' + err.message;
    })
    .changeRole(pw, ref, params);
}
window.saveSettings = saveSettings;
window.savePricing = savePricing;
window.saveRoomCounts = saveRoomCounts;
window.loadSettings = loadSettings;

function isDeadlinePassed() {
  var el = document.getElementById('s-reg-closes');
  if (!el || !el.value.trim()) return false;
  return new Date() > new Date(el.value.trim() + 'T23:59:59');
}
function checkRegDeadlineWarning() {
  var w = document.getElementById('reg-open-warning');
  if (!w) return;
  w.style.display = (document.getElementById('s-reg-open').checked && isDeadlinePassed()) ? 'block' : 'none';
}
function onRegOpenChange() { checkRegDeadlineWarning(); }
function generateBypassToken() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var t = '';
  for (var i = 0; i < 24; i++) t += chars.charAt(Math.floor(Math.random() * chars.length));
  document.getElementById('s-bypass-token').value = t;
  updateBypassLinkDisplay();
}
function clearBypassToken() {
  document.getElementById('s-bypass-token').value = '';
  updateBypassLinkDisplay();
}
function updateBypassLinkDisplay() {
  var t = document.getElementById('s-bypass-token').value.trim();
  var d = document.getElementById('bypass-link-display');
  if (!d) return;
  if (t) {
    var base = (typeof CONFIG_CLIENT !== 'undefined' && CONFIG_CLIENT.FRIENDLY_URL) ? CONFIG_CLIENT.FRIENDLY_URL : window.location.href.split('?')[0];
    d.style.display = 'block';
    d.textContent = base + '?bypass=' + t;
  } else { d.style.display = 'none'; }
}
window.isDeadlinePassed        = isDeadlinePassed;
window.checkRegDeadlineWarning = checkRegDeadlineWarning;
window.onRegOpenChange         = onRegOpenChange;
window.generateBypassToken     = generateBypassToken;
window.clearBypassToken        = clearBypassToken;
window.updateBypassLinkDisplay = updateBypassLinkDisplay;

function recalcAllPrices() {
  var btn = document.getElementById('recalc-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Recalculating...'; }
  google.script.run
    .withSuccessHandler(function(result) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Recalculate prices'; }
      if (result.success) {
        alert('Done! Updated ' + result.updated + ' bookings.');
        loadAdmin();
      } else {
        alert('Error: ' + result.error);
      }
    })
    .withFailureHandler(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Recalculate prices'; }
      alert('Error: ' + err.message);
    })
    .recalcAllPrices(adminPw);
}
window.recalcAllPrices = recalcAllPrices;
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('admin-pw').addEventListener('keydown', function(e) { if(e.key==='Enter') doLogin(); });
  // Auto-login if password saved
  var saved = localStorage.getItem('vushf_admin_pw');
  if (saved) {
    document.getElementById('admin-pw').value = saved;
    doLogin();
  }
  document.addEventListener('change', function(e) {
    if (e.target.id === 's-reg-open') onRegOpenChange();
  });
  document.addEventListener('click', function(e) {
    if (e.target.id === 'btn-promote-to-primary') { doRoleChange('primary'); return; }
    if (e.target.id === 'btn-move-to-joiner')     { doRoleChange('joiner');  return; }
    if (e.target.id === 'btn-generate-bypass')    { generateBypassToken();   return; }
    if (e.target.id === 'btn-clear-bypass')       { clearBypassToken();      return; }
    if (e.target.classList.contains('edit-btn') && !e.target.classList.contains('acc-btn')) {
      var ref = e.target.getAttribute('data-ref');
      if (ref) openEdit(ref);
    }
    if (e.target.classList.contains('acc-btn')) {
      var ref = e.target.getAttribute('data-ref');
      if (ref) openAccChange(ref);
    }
  });
});

var accChangeRef = null;
var accChangeData = null; // cached admin row data

function openAccChange(ref) {
  accChangeRef = ref;
  // Find row data from current table — rows are objects keyed by header name
  var rows = currentAdminData ? currentAdminData.rows : [];
  var obj = rows.find(function(r) { return r['BookingRef'] === ref; });
  if (!obj) { alert('Row data not found — try refreshing'); return; }
  accChangeData = obj;

  // Populate current info
  document.getElementById('acc-change-who').textContent = obj['Callsign'] + ' — ' + obj['Name'] + ' (' + ref + ')';
  var curType = obj['Type'] || '';
  var curRoomId = obj['RoomId'] || '';
  var curRoomCfg = CONFIG_CLIENT.ROOMS ? CONFIG_CLIENT.ROOMS.find(function(r){ return r.id === curRoomId; }) : null;
  var curDesc = curType === 'room' ? (curRoomCfg ? curRoomCfg.note_en : curRoomId) :
                curType === 'camper' ? 'Camper van spot' :
                curType === 'tent' ? 'Tent' :
                curType === 'singlebed' ? 'Single bed (organizer-assigned)' :
                curType === 'dayvisitor' ? 'Day visitor' : curType;
  document.getElementById('acc-current-desc').textContent = curDesc;
  document.getElementById('acc-current-price').textContent = '€' + (obj['TotalPrice'] || '?');

  // Set selector to current type
  document.getElementById('acc-new-type').value = curType;
  document.getElementById('acc-save-msg').style.display = 'none';
  document.getElementById('acc-warning').style.display = 'none';
  onAccTypeChange();

  var modal = document.getElementById('acc-change-modal');
  modal.style.display = 'flex';
}

function closeAccChange() {
  document.getElementById('acc-change-modal').style.display = 'none';
  accChangeRef = null;
  accChangeData = null;
}

function onAccTypeChange() {
  var type = document.getElementById('acc-new-type').value;
  var roomPicker = document.getElementById('acc-room-picker');
  var roomSel = document.getElementById('acc-new-room-id');

  if (type === 'room') {
    roomPicker.style.display = 'block';
    // Populate room options with availability
    var avail = window._adminAvail || {};
    var bookedByType = avail.bookedByType || {};
    roomSel.innerHTML = (CONFIG_CLIENT.ROOMS || []).map(function(r) {
      var booked = bookedByType[r.id] || 0;
      var free = r.count - booked;
      var livePrice = (CONFIG_CLIENT.ROOM_PRICES && CONFIG_CLIENT.ROOM_PRICES[r.id] !== undefined) ? CONFIG_CLIENT.ROOM_PRICES[r.id] : r.price_eur;
      var pricePerPerson = Math.round(livePrice / r.persons);
      var label = r.note_en + ' — €' + pricePerPerson + '/p · ' + free + '/' + r.count + ' free';
      return '<option value="' + r.id + '"' + (free <= 0 ? ' style="color:var(--muted)"' : '') + '>' + label + '</option>';
    }).join('');
    onAccRoomChange();
  } else {
    roomPicker.style.display = 'none';
    updateAccNewInfo(type, null);
  }
}

function onAccRoomChange() {
  var roomId = document.getElementById('acc-new-room-id').value;
  var roomCfg = (CONFIG_CLIENT.ROOMS || []).find(function(r){ return r.id === roomId; });
  updateAccNewInfo('room', roomCfg);
}

function updateAccNewInfo(type, roomCfg) {
  var infoEl = document.getElementById('acc-new-info');
  var descEl = document.getElementById('acc-new-desc');
  var capEl  = document.getElementById('acc-new-capacity');
  var priceEl = document.getElementById('acc-new-price');
  var diffEl  = document.getElementById('acc-price-diff');
  var warnEl  = document.getElementById('acc-warning');

  infoEl.style.display = 'block';
  warnEl.style.display = 'none';

  var newDesc = type === 'room' ? (roomCfg ? roomCfg.note_en : '') :
                type === 'camper' ? 'Camper van spot' :
                type === 'tent' ? 'Tent' :
                type === 'singlebed' ? 'Single bed (organizer-assigned)' :
                type === 'dayvisitor' ? 'Day visitor' : type;
  descEl.textContent = newDesc;

  if (type === 'room' && roomCfg) {
    var avail = window._adminAvail || {};
    var bookedByType = avail.bookedByType || {};
    var booked = bookedByType[roomCfg.id] || 0;
    var free = roomCfg.count - booked;
    capEl.textContent = 'Capacity: ' + roomCfg.persons + ' persons · ' + free + ' of ' + roomCfg.count + ' rooms free';
    capEl.style.color = free <= 0 ? 'var(--danger)' : 'var(--muted)';
    if (free <= 0) {
      warnEl.style.display = 'block';
      warnEl.textContent = '⚠️ No rooms of this type available.';
    }
    var livePrice = (CONFIG_CLIENT.ROOM_PRICES && CONFIG_CLIENT.ROOM_PRICES[roomCfg.id] !== undefined) ? CONFIG_CLIENT.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur;
    var pp = Math.round(livePrice / roomCfg.persons);
    priceEl.textContent = '€' + pp + '/person (room total €' + livePrice + ')';
  } else {
    capEl.textContent = '';
    priceEl.textContent = '';
  }

  // Check if current booking has joiners — warn if room type might not fit
  if (accChangeData && type === 'room' && roomCfg) {
    var joiners = (currentAdminData ? currentAdminData.rows : []).filter(function(r) {
      return r['RoomRef'] === accChangeRef && r['IsPrimaryBooker'] !== 'YES' && r['BookingRef'] !== accChangeRef;
    });
    if (joiners.length > 0 && joiners.length + 1 > roomCfg.persons) {
      warnEl.style.display = 'block';
      warnEl.textContent = '⚠️ Room has ' + joiners.length + ' joiner(s) — new room type only fits ' + roomCfg.persons + ' person(s) total. Move cannot be completed.';
    } else if (joiners.length > 0) {
      warnEl.style.display = 'block';
      warnEl.textContent = 'ℹ️ This booking has ' + joiners.length + ' joiner(s) who will remain in the same room group.';
      warnEl.style.background = '#eff6ff'; warnEl.style.borderColor = '#bfdbfe'; warnEl.style.color = '#1e40af';
    }
  }

  // Price diff vs current
  var curPrice = accChangeData ? parseFloat(accChangeData['TotalPrice']) || 0 : 0;
  diffEl.textContent = '';
  diffEl.style.color = 'var(--muted)';
}

function saveAccChange() {
  if (!accChangeRef) return;
  var type = document.getElementById('acc-new-type').value;
  var roomId = type === 'room' ? document.getElementById('acc-new-room-id').value : '';
  var sendEmail = document.getElementById('acc-send-email').checked;
  var btn = document.getElementById('acc-save-btn');
  var msgEl = document.getElementById('acc-save-msg');

  btn.disabled = true; btn.textContent = 'Saving...';
  msgEl.style.display = 'none';

  google.script.run
    .withSuccessHandler(function(result) {
      btn.disabled = false; btn.textContent = 'Save change';
      if (result.success) {
        msgEl.style.display = 'block';
        msgEl.style.background = '#f0fdf4'; msgEl.style.border = '1px solid #86efac'; msgEl.style.color = '#166534';
        var emailNote = sendEmail ? ' · notification sent' : '';
        msgEl.textContent = '✓ Saved — €' + result.oldPrice + ' → €' + result.newPrice + emailNote;
        setTimeout(function() { closeAccChange(); loadAdmin(adminPw); }, 1500);
      } else {
        msgEl.style.display = 'block';
        msgEl.style.background = '#fef2f2'; msgEl.style.border = '1px solid #fca5a5'; msgEl.style.color = '#b91c1c';
        msgEl.textContent = '✗ ' + result.error;
      }
    })
    .withFailureHandler(function(err) {
      btn.disabled = false; btn.textContent = 'Save change';
      msgEl.style.display = 'block';
      msgEl.style.background = '#fef2f2'; msgEl.style.border = '1px solid #fca5a5'; msgEl.style.color = '#b91c1c';
      msgEl.textContent = '✗ ' + err.message;
    })
    .changeAccommodation(adminPw, accChangeRef, { newType: type, newRoomId: roomId, sendEmail: sendEmail });
}

function doLogin() {
  const pw = document.getElementById('admin-pw').value;
  if (!pw) { document.getElementById('pw-err').textContent = 'Enter password'; return; }
  document.getElementById('pw-err').textContent = 'Checking...';
  google.script.run
    .withSuccessHandler(function(ok) {
      if (ok) {
        adminPw = pw;
        localStorage.setItem('vushf_admin_pw', pw);
        // Fetch admin panel HTML from server and inject before loading data
        google.script.run
          .withSuccessHandler(function(html) {
            if (!html) { document.getElementById('pw-err').textContent = 'Panel load failed'; return; }
            document.body.innerHTML = html;
            loadAdmin();
          })
          .withFailureHandler(function(err) {
            document.getElementById('pw-err').textContent = 'Error: ' + err.message;
          })
          .getAdminPanelHtml(pw);
      } else {
        document.getElementById('pw-err').textContent = 'Wrong password';
      }
    })
    .withFailureHandler(function(err) {
      document.getElementById('pw-err').textContent = 'Error: ' + err.message;
    })
    .checkAdminPassword(pw);
}

function loadAdmin() {
  // Set both refresh buttons to loading state
  ['header-refresh-btn','table-refresh-btn'].forEach(function(id) {
    var btn = document.getElementById(id);
    if (btn) { btn.textContent = '↺ Loading...'; btn.disabled = true; btn.style.opacity = '0.6'; }
  });

  function resetBtns() {
    ['header-refresh-btn','table-refresh-btn'].forEach(function(id) {
      var btn = document.getElementById(id);
      if (btn) { btn.textContent = '↺ Refresh'; btn.disabled = false; btn.style.opacity = ''; }
    });
  }

  google.script.run
    .withFailureHandler(function(err) {
      resetBtns();
      document.body.innerHTML += '<div style="color:red;padding:1rem">Admin load error: ' + (err.message||err) + '</div>';
    })
    .withSuccessHandler(function(result) {
      resetBtns();
      if (!result) {
        document.body.innerHTML += '<div class="err">Admin data error: server returned null.</div>';
        return;
      }
      if (!result.success) {
        document.body.innerHTML += '<div class="err">Admin data error: ' + (result.error || 'unknown error') + '</div>';
        return;
      }
      try {
        allRows = result.rows;
        allHeaders = result.headers;
        currentAdminData = { rows: result.rows, headers: result.headers };
        if (result.rooms) window.CONFIG_CLIENT = window.CONFIG_CLIENT || {};
        if (result.rooms) { window.CONFIG_CLIENT.ROOMS = result.rooms; window.CONFIG_CLIENT.ROOM_PRICES = result.roomPrices || {}; }
        if (result.bookedByType) window._adminAvail = { bookedByType: result.bookedByType };
        renderAdmin(result);
        loadSettings();
        var ts = document.getElementById('table-refresh-ts');
        var hts = document.getElementById('header-refresh-ts');
        var tsText = 'Updated ' + new Date().toLocaleTimeString();
        if (ts) ts.textContent = tsText;
        if (hts) hts.textContent = tsText;
      } catch(renderErr) {
        document.body.innerHTML += '<div class="err">renderAdmin error: ' + renderErr.message + '</div>';
      }
    })
    .getAdminData(adminPw);
}

function renderAdmin(data) {
  const rows = data.rows;
  const rooms      = rows.filter(function(r){return r.Type==='room'}).length;
  const campers    = rows.filter(function(r){return r.Type==='camper' && r.IsPrimaryBooker==='YES'}).length;
  const tents      = rows.filter(function(r){return r.Type==='tent'}).length;
  const singlebeds = rows.filter(function(r){return r.Type==='singlebed'}).length;
  const dayvisitors= rows.filter(function(r){return r.Type==='dayvisitor'}).length;
  const meals      = rows.filter(function(r){return r.FullBoard==='YES'}).length;
  const thu        = rows.filter(function(r){return r.ThuExtraNight==='YES'}).length;
  const total      = rows.reduce(function(s,r){return s+(parseFloat(r.TotalPrice)||0)},0);

  // Per room-type stats
  var roomStats = [];
  (CONFIG_ADMIN.ROOMS || []).forEach(function(rc) {
    var primaries = rows.filter(function(r){ return r.Type==='room' && r.RoomId===rc.id && r.IsPrimaryBooker==='YES'; });
    var bookedRooms = primaries.length;
    var totalCap = rc.count;
    if (bookedRooms === 0 && totalCap === 0) return;
    var full = [], partial = [];
    if (rc.persons > 1) {
      primaries.forEach(function(p) {
        var joiners = rows.filter(function(r){ return r.RoomRef===p.BookingRef && r.IsPrimaryBooker!=='YES'; }).length;
        var occupants = 1 + joiners;
        if (occupants >= rc.persons) full.push(p.BookingRef);
        else partial.push({ref: p.BookingRef, occupants: occupants, cap: rc.persons});
      });
    }
    var detail = bookedRooms + ' / ' + totalCap;
    var sub = '';
    if (rc.persons > 1 && bookedRooms > 0) {
      var parts = [];
      if (full.length)    parts.push('<span style="color:var(--danger)">' + full.length + ' full</span>');
      if (partial.length) parts.push('<span style="color:#b45309">' + partial.length + ' open</span>');
      if (parts.length) sub = '<div style="font-size:0.75rem;margin-top:0.2rem;line-height:1.4">' + parts.join(' · ') + '</div>';
      if (partial.length) {
        sub += '<div style="font-size:0.72rem;color:var(--muted);margin-top:0.15rem">' +
          partial.map(function(p){ return p.ref+' ('+p.occupants+'/'+p.cap+')'; }).join(', ') +
          '</div>';
      }
    }
    roomStats.push({id: rc.id, label: rc.note_en, detail: detail, sub: sub});
  });

  var statsHtml = [
    {l:'Total bookings', v:rows.length},
  ].map(function(s){
    return '<div class="stat"><div class="label">'+s.l+'</div><div class="value">'+s.v+'</div></div>';
  }).join('');

  // Room type breakdown
  statsHtml += roomStats.map(function(s){
    return '<div class="stat"><div class="label" style="font-size:0.75rem">'+s.label+'</div><div class="value" style="font-size:1rem">'+s.detail+'</div>'+s.sub+'</div>';
  }).join('');

  statsHtml += [
    {l:'Single beds',       v:singlebeds},
    {l:'Camper van',        v:campers+' / '+CONFIG_ADMIN.CAMPER_VAN_SPOTS},
    {l:'Tent spots',        v:tents+' / '+CONFIG_ADMIN.TENT_SPOTS},
    {l:'Day visitors',      v:dayvisitors},
    {l:'Full board meals',  v:meals},
    {l:'Thu extra night',   v:thu},
    {l:'Revenue (est.)',    v:'\u20AC'+total.toFixed(0)},
  ].map(function(s){
    return '<div class="stat"><div class="label">'+s.l+'</div><div class="value">'+s.v+'</div></div>';
  }).join('');

  document.getElementById('stats').innerHTML = statsHtml;

  const showCols = ['_guest','Email','Country','_room','ThuExtraNight','FullBoard','DayVisitorDays','Meals','Dietary','FreeText','TotalPrice','_status','OrgComment'];

  // Sort state
  if (!window._adminSort) window._adminSort = { col: null, dir: 1 };

  function buildHead() {
    var s = window._adminSort;
    var typeArrow = s.col === '_type' ? (s.dir === 1 ? ' ▲' : ' ▼') : ' <span style="opacity:0.25">⇅</span>';
    document.getElementById('table-head').innerHTML =
      '<th style="cursor:default"></th>' +
      '<th style="cursor:pointer;user-select:none;white-space:nowrap" data-sortcol="_type" title="Sort by type">Type' + typeArrow + '</th>' +
      showCols.map(function(h) {
        var label = h === '_guest'       ? 'Callsign / Name / Ref'
                  : h === '_room'        ? 'Room / №'
                  : h === '_status'      ? 'Status'
                  : h === 'ThuExtraNight'? 'Thu'
                  : h === 'FullBoard'    ? 'FB'
                  : h === 'DayVisitorDays' ? 'Days'
                  : h;
        var sortable = h[0] !== '_';
        if (!sortable) return '<th style="white-space:nowrap">' + label + '</th>';
        var arrow = s.col === h ? (s.dir === 1 ? ' ▲' : ' ▼') : ' <span style="opacity:0.25">⇅</span>';
        return '<th style="cursor:pointer;user-select:none;white-space:nowrap" data-sortcol="'+h+'">' + label + arrow + '</th>';
      }).join('');
    // Attach click handlers after innerHTML set
    document.getElementById('table-head').querySelectorAll('th[data-sortcol]').forEach(function(th) {
      th.addEventListener('click', function(){ adminSort(th.getAttribute('data-sortcol')); });
    });
  }

  window.adminSort = function(col) {
    var s = window._adminSort;
    if (s.col === col) { s.dir *= -1; } else { s.col = col; s.dir = 1; }
    buildHead();
    renderAdminRows(rows, showCols);
    document.getElementById('sort-reset-btn').style.opacity = '1';
    document.getElementById('sort-reset-btn').style.pointerEvents = 'auto';
  };

  window.adminResetSort = function() {
    window._adminSort = { col: null, dir: 1 };
    buildHead();
    renderAdminRows(rows, showCols);
    document.getElementById('sort-reset-btn').style.opacity = '0.35';
    document.getElementById('sort-reset-btn').style.pointerEvents = 'none';
  };

  // Hide clear-sort button initially (no sort active)
  var resetBtn = document.getElementById('sort-reset-btn');
  if (resetBtn) { resetBtn.style.opacity = '0.35'; resetBtn.style.pointerEvents = 'none'; }

  buildHead();

  function statusClass(s) {
    if (s==='CANCELLED') return 'status-cancelled';
    if (s==='NEEDS_ATTENTION') return 'status-attention';
    return '';
  }

  function renderRow(r, role) {
    const ref = r['BookingRef'] || '';
    const sc = statusClass(r['Status']);
    const staffBadge = r['IsOrganizer'] === 'YES' ? ' <span class="tag" style="background:rgba(124,58,237,0.15);color:#7c3aed;font-weight:700">👷 STAFF</span>' : '';
    let roleCell = '';
    if (role === 'primary' && r['Type'] === 'camper')
      roleCell = '<td><span style="font-size:1.1rem">🚐</span> <span class="tag tag-camper">PRIMARY</span>' + staffBadge + '</td>';
    else if (role === 'child' && r['Type'] === 'camper')
      roleCell = '<td style="padding-left:0.75rem"><span style="font-size:1rem;color:var(--muted)">↳</span> <span class="tag tag-camper">JOINER</span>' + staffBadge + '</td>';
    else if (role === 'primary')
      roleCell = '<td><span style="font-size:1.1rem">🏠</span> <span class="tag primary">PRIMARY BOOKER</span>' + staffBadge + '</td>';
    else if (role === 'child')
      roleCell = '<td style="padding-left:0.75rem"><span style="font-size:1rem;color:var(--muted)">↳</span> <span class="tag joiner">JOINER</span>' + staffBadge + '</td>';
    else if (r['Type'] === 'room')
      roleCell = '<td><span style="font-size:1.1rem">🏨</span> <span class="tag primary">HOTEL</span>' + staffBadge + '</td>';
    else if (r['Type'] === 'camper')
      roleCell = '<td><span style="font-size:1.1rem">🚐</span> <span class="tag tag-camper">CAMPER</span>' + staffBadge + '</td>';
    else if (r['Type'] === 'tent')
      roleCell = '<td><span style="font-size:1.1rem">⛺</span> <span class="tag tent">TENT</span>' + staffBadge + '</td>';
    else if (r['Type'] === 'dayvisitor')
      roleCell = '<td><span style="font-size:1.1rem">🎫</span> <span class="tag dayvisitor">DAY VISITOR</span>' + staffBadge + '</td>';
    else if (r['Type'] === 'singlebed')
      roleCell = '<td><span style="font-size:1.1rem">🛏️</span> <span class="tag joiner">SINGLE BED</span>' + staffBadge + '</td>';
    else
      roleCell = '<td>' + staffBadge + '</td>';
    return '<tr id="row-'+ref+'" class="'+sc+'"><td style="white-space:nowrap;text-align:center;padding:0.25rem 0.3rem"><button class="edit-btn" data-ref="'+ref+'" title="Edit booking" style="display:block;margin:0 auto 2px auto">\u270F\uFE0F</button><button class="edit-btn acc-btn" data-ref="'+ref+'" title="Change accommodation" style="display:block;margin:0 auto">\uD83D\uDECF\uFE0F</button></td>' + roleCell + showCols.map(function(h) {
      if (h === '_guest') {
        var cs = r['Callsign'] || '';
        var nm = r['Name'] || '';
        var bref = r['BookingRef'] || '';
        return '<td><span style="font-weight:700;font-family:var(--mono)">' + cs + '</span><br><span style="font-size:0.8rem;color:var(--muted)">' + nm + '</span><br><span style="font-size:0.72rem;color:var(--muted);font-family:var(--mono)">' + bref + '</span></td>';
      }
      if (h === '_room') {
        var rid = r['RoomId'] || '';
        if (r['SoloRoom'] === 'YES') rid += ' <span class="tag solo">SOLO</span>';
        var rnum = r['RoomNumber'] || '';
        var rnumHtml = '<span class="org-field room-num" data-ref="'+ref+'">' + (rnum || '<em style="opacity:0.4">&mdash;</em>') + '</span>';
        return '<td>' + rid + (rid ? '<br>' : '') + '<span style="font-size:0.8rem;color:var(--muted)">' + rnumHtml + '</span></td>';
      }
      if (h === '_status') {
        var st = r['Status'] || '';
        var pc = r['PublishConsent'] === 'YES'
          ? '<span style="color:var(--success);font-weight:600;font-size:0.78rem">\u2713 pub</span>'
          : '<span style="color:var(--danger);font-weight:600;font-size:0.78rem">\u2717 pub</span>';
        return '<td><span class="tag status-'+st+'" style="display:block;margin-bottom:2px">'+st+'</span>' + pc + '</td>';
      }
      let v = r[h] !== undefined ? r[h] : '';
      if (h==='FullBoard'||h==='ThuExtraNight') v = v==='YES' ? '✓' : '';
      if (h==='OrgComment') v = '<span class="org-field org-comment" data-ref="'+ref+'">' + (v || '<em style="opacity:0.4">&mdash;</em>') + '</span>';
      return '<td>'+v+'</td>';
    }).join('') + '</tr>';
  }

  window.renderAdminRows = function(rows, showCols) {
    var s = window._adminSort;
    var html = '';

    // Helper: render a primary room booking with its joiners beneath
    function renderGroup(primary) {
      var h = renderRow(primary, 'primary');
      rows.filter(function(r){
        return r.RoomRef === primary.BookingRef && r.IsPrimaryBooker !== 'YES';
      }).forEach(function(child){ h += renderRow(child, 'child'); });
      return h;
    }

    if (!s.col) {
      // Default grouped view
      var primaries = rows.filter(function(r){ return r.Type==='room' && r.IsPrimaryBooker==='YES'; });
      primaries.forEach(function(p){ html += renderGroup(p); });
      rows.filter(function(r){
        return r.Type==='room' && r.IsPrimaryBooker!=='YES' &&
               !primaries.find(function(p){ return p.BookingRef===r.RoomRef; });
      }).forEach(function(r){ html += renderRow(r, 'orphan'); });
      // Camper primaries with joiners beneath
      var camperPrimaries = rows.filter(function(r){ return r.Type==='camper' && r.IsPrimaryBooker==='YES'; });
      camperPrimaries.forEach(function(p){ html += renderGroup(p); });
      // Orphan camper joiners (primary not found)
      rows.filter(function(r){
        return r.Type==='camper' && r.IsPrimaryBooker!=='YES' &&
               !camperPrimaries.find(function(p){ return p.BookingRef===r.RoomRef; });
      }).forEach(function(r){ html += renderRow(r, 'orphan'); });
      ['singlebed','tent','dayvisitor'].forEach(function(t){
        rows.filter(function(r){ return r.Type===t; })
            .forEach(function(r){ html += renderRow(r, 'other'); });
      });

    } else if (s.col === '_type') {
      // Two-level type sort: groups ordered by type, joiners stay under their primary
      var typeOrder = s.dir === 1
        ? ['room','singlebed','camper','tent','dayvisitor']
        : ['dayvisitor','tent','camper','singlebed','room'];
      typeOrder.forEach(function(t) {
        if (t === 'room') {
          var primaries = rows.filter(function(r){ return r.Type==='room' && r.IsPrimaryBooker==='YES'; });
          primaries.forEach(function(p){ html += renderGroup(p); });
          rows.filter(function(r){
            return r.Type==='room' && r.IsPrimaryBooker!=='YES' &&
                   !primaries.find(function(p){ return p.BookingRef===r.RoomRef; });
          }).forEach(function(r){ html += renderRow(r, 'orphan'); });
        } else if (t === 'camper') {
          var camperPrimaries = rows.filter(function(r){ return r.Type==='camper' && r.IsPrimaryBooker==='YES'; });
          camperPrimaries.forEach(function(p){ html += renderGroup(p); });
          rows.filter(function(r){
            return r.Type==='camper' && r.IsPrimaryBooker!=='YES' &&
                   !camperPrimaries.find(function(p){ return p.BookingRef===r.RoomRef; });
          }).forEach(function(r){ html += renderRow(r, 'orphan'); });
        } else {
          rows.filter(function(r){ return r.Type===t; })
              .forEach(function(r){ html += renderRow(r, 'other'); });
        }
      });

    } else {
      // Sorted flat view by field
      var sorted = rows.slice().sort(function(a, b) {
        var av = (a[s.col] || '').toString().toLowerCase();
        var bv = (b[s.col] || '').toString().toLowerCase();
        if (s.col === 'TotalPrice') {
          av = parseFloat(a[s.col]) || 0;
          bv = parseFloat(b[s.col]) || 0;
          return (av - bv) * s.dir;
        }
        if (av < bv) return -1 * s.dir;
        if (av > bv) return  1 * s.dir;
        return 0;
      });
      sorted.forEach(function(r) {
        var role = (r.Type === 'room' || r.Type === 'camper')
          ? (r.IsPrimaryBooker === 'YES' ? 'primary' : 'child')
          : 'other';
        html += renderRow(r, role);
      });
    }
    document.getElementById('table-body').innerHTML = html;
  };

  renderAdminRows(rows, showCols);
}

function openEdit(ref) {
  const row = allRows.find(function(r){ return r['BookingRef'] === ref; });
  if (!row) return;
  const modal = document.getElementById('edit-modal');
  document.getElementById('edit-ref').textContent = ref;
  document.getElementById('edit-callsign').value  = row.Callsign  || '';
  document.getElementById('edit-name').value      = row.Name      || '';
  document.getElementById('edit-email').value     = row.Email     || '';
  document.getElementById('edit-phone').value     = row.Phone     || '';
  document.getElementById('edit-country').value   = row.Country   || '';
  document.getElementById('edit-dietary').value      = row.Dietary    || '';
  document.getElementById('edit-status').value       = row.Status     || 'CONFIRMED';
  document.getElementById('edit-fullboard').checked  = row.FullBoard  === 'YES';
  document.getElementById('edit-thuextra').checked   = row.ThuExtraNight === 'YES';
  document.getElementById('edit-soloroom').checked   = row.SoloRoom   === 'YES';
  document.getElementById('edit-publish').checked    = row.PublishConsent === 'YES';
  document.getElementById('edit-dayvisitor-days').value = row.DayVisitorDays || 'both';
  document.getElementById('edit-dayvisitor-days-row').style.display = row.Type === 'dayvisitor' ? '' : 'none';
  document.getElementById('edit-isorganizer').checked = row.IsOrganizer === 'YES';
  document.getElementById('edit-roomnum').value      = row.RoomNumber || '';
  document.getElementById('edit-freetext').value     = row.FreeText   || '';
  document.getElementById('edit-orgcomment').value   = row.OrgComment || '';
  modal.style.display = 'flex';
  modal._ref = ref;

  // Role change section — only for room/singlebed
  var type = row.Type || '';
  var isPrimary = row.IsPrimaryBooker === 'YES';
  var roleSection = document.getElementById('role-change-section');
  var j2p = document.getElementById('role-joiner-to-primary');
  var p2j = document.getElementById('role-primary-to-joiner');
  document.getElementById('role-change-result').style.display = 'none';

  if (type === 'room' || type === 'singlebed') {
    roleSection.style.display = 'block';
    j2p.style.display = isPrimary ? 'none' : 'block';
    p2j.style.display = isPrimary ? 'block' : 'none';

    if (!isPrimary) {
      // Populate free rooms for joiner→primary
      var avail = window._adminAvail || {};
      var roomSel = document.getElementById('role-room-select');
      roomSel.innerHTML = '<option value="">— select room —</option>';
      (CONFIG_ADMIN.ROOMS || []).forEach(function(r) {
        var a = avail.rooms ? avail.rooms[r.id] : null;
        var free = a ? (a.total - a.booked) : 0;
        if (free > 0) {
          var opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = r.note_en + ' — ' + free + ' free';
          roomSel.appendChild(opt);
        }
      });
    } else {
      // Populate rooms with space for primary→joiner
      var targetSel = document.getElementById('role-target-room-select');
      targetSel.innerHTML = '<option value="">— select room —</option>';
      allRows.forEach(function(r) {
        if (r.IsPrimaryBooker !== 'YES') return;
        if (r.BookingRef === ref) return;
        if (r.Status === 'CANCELLED') return;
        var roomCfg = (CONFIG_ADMIN.ROOMS || []).find(function(rc){ return rc.id === r.RoomId; });
        if (!roomCfg) return;
        var occupants = allRows.filter(function(x){
          return (x.BookingRef === r.BookingRef || x.RoomRef === r.BookingRef) && x.Status !== 'CANCELLED';
        }).length;
        var free = roomCfg.persons - occupants;
        if (free > 0) {
          var opt = document.createElement('option');
          opt.value = r.BookingRef;
          opt.textContent = r.BookingRef + ' (' + (r.Callsign||'?') + ') — ' + roomCfg.note_en + ' — ' + free + ' spot(s) free';
          targetSel.appendChild(opt);
        }
      });

      // Warn about existing joiners
      var joinerCount = allRows.filter(function(r){
        return r.RoomRef === ref && r.IsPrimaryBooker !== 'YES' && r.Status !== 'CANCELLED';
      }).length;
      var warn = document.getElementById('role-joiner-warning');
      if (joinerCount > 0) {
        warn.style.display = 'block';
        warn.textContent = '⚠️ This room has ' + joinerCount + ' joiner(s). They will be flagged as NEEDS_ATTENTION if you proceed.';
      } else {
        warn.style.display = 'none';
      }
    }
  } else {
    roleSection.style.display = 'none';
  }
}

function closeEdit() {
  document.getElementById('edit-modal').style.display = 'none';
}

function saveEdit() {
  const ref = document.getElementById('edit-modal')._ref;
  const fields = {
    Callsign:      document.getElementById('edit-callsign').value.trim().toUpperCase(),
    Name:          document.getElementById('edit-name').value.trim(),
    Email:         document.getElementById('edit-email').value.trim(),
    Phone:         document.getElementById('edit-phone').value.trim(),
    Country:       document.getElementById('edit-country').value.trim(),
    Dietary:       document.getElementById('edit-dietary').value.trim(),
    Status:        document.getElementById('edit-status').value,
    FullBoard:     document.getElementById('edit-fullboard').checked ? 'YES' : 'NO',
    ThuExtraNight: document.getElementById('edit-thuextra').checked  ? 'YES' : 'NO',
    SoloRoom:      document.getElementById('edit-soloroom').checked  ? 'YES' : 'NO',
    PublishConsent: document.getElementById('edit-publish').checked   ? 'YES' : 'NO',
    DayVisitorDays: document.getElementById('edit-dayvisitor-days').value,
    IsOrganizer:   document.getElementById('edit-isorganizer').checked ? 'YES' : 'NO',
    RoomNumber:    document.getElementById('edit-roomnum').value.trim(),
    FreeText:      document.getElementById('edit-freetext').value.trim(),
    OrgComment:    document.getElementById('edit-orgcomment').value.trim(),
  };
  const saveBtn = document.getElementById('edit-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  google.script.run
    .withSuccessHandler(function(result) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      if (result.success) {
        if (result.cascadedCount > 0) {
          alert('Saved. Primary booker cancelled — ' + result.cascadedCount + ' roommate(s) flagged as NEEDS_ATTENTION and notified by email.');
        }
        closeEdit();
        loadAdmin();
      } else {
        alert('Error: ' + result.error);
      }
    })
    .withFailureHandler(function(e) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      alert('Error: ' + e.message);
    })
    .updateBooking(adminPw, ref, fields, document.getElementById('edit-send-email').checked);
}

function loadSettings() {
  google.script.run
    .withSuccessHandler(function(result) {
      if (!result || !result.success) return;
      const s = result.settings;
      document.getElementById('s-reg-open').checked     = s.REGISTRATION_OPEN;
      document.getElementById('s-reg-closes').value     = s.REGISTRATION_CLOSES || '';
      // Show warning if deadline has passed
      checkRegDeadlineWarning();
      document.getElementById('s-solo-double').checked = s.ALLOW_SOLO_DOUBLE;
      document.getElementById('s-single-bed').checked  = s.ALLOW_SINGLE_BED_BOOKING;
      document.getElementById('s-tent-enabled').checked = s.TENT_ENABLED !== false;
      document.getElementById('s-announcement').value    = s.ANNOUNCEMENT    || '';
      document.getElementById('s-camper-info').value      = s.CAMPER_INFO      || '';
      document.getElementById('s-tent-info').value        = s.TENT_INFO        || '';
      document.getElementById('s-closed-message').value   = s.CLOSED_MESSAGE   || '';
      document.getElementById('s-bypass-token').value     = s.BYPASS_TOKEN     || '';
      updateBypassLinkDisplay();
      document.getElementById('s-price-disclaimer').value = s.PRICE_DISCLAIMER || '';
      // Pricing fields
      document.getElementById('s-fullboard-price').value = s.FULL_BOARD_PRICE || '';
      document.getElementById('s-camper-price').value    = s.CAMPER_VAN_PRICE_PER_NIGHT || '';
      document.getElementById('s-tent-price').value      = s.TENT_PRICE_WEEKEND || '';
      document.getElementById('s-singlebed-price').value = s.SINGLE_BED_PRICE || '';
      document.getElementById('s-singlebed-slots').value = s.SINGLE_BED_SLOTS !== undefined ? s.SINGLE_BED_SLOTS : 0;
      document.getElementById('s-meeting-fee-weekend').value = s.MEETING_FEE_WEEKEND || '';
      document.getElementById('s-meeting-fee-day').value = s.MEETING_FEE_DAY || '';
      renderRoomPricesGrid(s.ROOM_PRICES || {});
      renderRoomCountsGrid(s.ROOM_COUNTS || {});
      var camperEl = document.getElementById('rc-camper');
      var tentEl = document.getElementById('rc-tent');
      if (camperEl) camperEl.value = s.CAMPER_VAN_SPOTS !== undefined ? s.CAMPER_VAN_SPOTS : '';
      if (tentEl)   tentEl.value   = s.TENT_SPOTS       !== undefined ? s.TENT_SPOTS       : '';
    })
    .withFailureHandler(function(e) { console.error('loadSettings:', e.message); })
    .getAdminSettings(adminPw);
}

function renderRoomPricesGrid(prices) {
  var grid = document.getElementById('room-prices-grid');
  if (!grid) return;
  grid.innerHTML = '';
  ROOM_DEFS.forEach(function(r) {
    var val = prices[r.id] !== undefined ? prices[r.id] : '';
    var item = document.createElement('div');
    item.className = 'setting-item';
    item.innerHTML =
      '<div class="setting-label" style="flex:1">Room price: ' + r.label +
      '</div>' +
      '<input type="number" class="setting-input" id="rp-' + r.id + '" ' +
        'value="' + val + '" min="0" placeholder="default" style="width:90px;text-align:center">';
    grid.appendChild(item);
  });
}

function savePricing() {
  var msg = document.getElementById('pricing-msg');
  msg.textContent = 'Saving...';
  msg.style.color = 'var(--muted)';
  var roomPrices = {};
  ROOM_DEFS.forEach(function(r) {
    var el = document.getElementById('rp-' + r.id);
    if (el && el.value.trim() !== '') roomPrices[r.id] = el.value.trim();
  });
  var settings = {
    FULL_BOARD_PRICE:           document.getElementById('s-fullboard-price').value.trim(),
    CAMPER_VAN_PRICE_PER_NIGHT: document.getElementById('s-camper-price').value.trim(),
    TENT_PRICE_WEEKEND:         document.getElementById('s-tent-price').value.trim(),
    SINGLE_BED_PRICE:           document.getElementById('s-singlebed-price').value.trim(),
    SINGLE_BED_SLOTS:           document.getElementById('s-singlebed-slots').value.trim(),
    MEETING_FEE_WEEKEND:        document.getElementById('s-meeting-fee-weekend').value.trim(),
    MEETING_FEE_DAY:            document.getElementById('s-meeting-fee-day').value.trim(),
    ROOM_PRICES:                roomPrices,
  };
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        msg.textContent = '\u2713 Saved';
        msg.style.color = 'var(--success)';
        setTimeout(function(){ msg.textContent = ''; }, 3000);
      } else {
        msg.textContent = 'Error: ' + (result ? result.error : 'unknown');
        msg.style.color = 'var(--danger)';
      }
    })
    .withFailureHandler(function(e) {
      msg.textContent = 'Error: ' + e.message;
      msg.style.color = 'var(--danger)';
    })
    .saveAdminSettings(adminPw, settings);
}

var ROOM_DEFS = [
  { id: '1S-W',  label: 'Single w/ window (1S-W)',        default: 6  },
  { id: '1S-NW', label: 'Single no window (1S-NW)',       default: 3  },
  { id: '2S',    label: 'Double (2S)',                     default: 20 },
  { id: '3S-U',  label: 'Triple upstairs (3S-U)',         default: 3  },
  { id: '3S',    label: 'Triple downstairs (3S)',          default: 1  },
  { id: '4S',    label: 'Quad (4S)',                       default: 2  },
  { id: '7S',    label: 'Seven-person (7S)',               default: 1  },
];

function renderRoomCountsGrid(counts) {
  var grid = document.getElementById('room-counts-grid');
  grid.innerHTML = '';
  ROOM_DEFS.forEach(function(r) {
    var val = counts[r.id] !== undefined ? counts[r.id] : r.default;
    var item = document.createElement('div');
    item.className = 'setting-item';
    item.innerHTML =
      '<div class="setting-label" style="flex:1">' + r.label + '</div>' +
      '<input type="number" class="setting-input" id="rc-' + r.id + '" ' +
        'value="' + val + '" min="0" max="99" style="width:70px;text-align:center">';
    grid.appendChild(item);
  });
}

function saveRoomCounts() {
  var counts = {};
  ROOM_DEFS.forEach(function(r) {
    var el = document.getElementById('rc-' + r.id);
    if (el) counts[r.id] = el.value.trim();
  });
  var camperEl = document.getElementById('rc-camper');
  var tentEl = document.getElementById('rc-tent');
  var msg = document.getElementById('room-counts-msg');
  msg.textContent = 'Saving...';
  msg.style.color = 'var(--muted)';
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        msg.textContent = '\u2713 Saved';
        msg.style.color = 'var(--success)';
        setTimeout(function(){ msg.textContent = ''; }, 3000);
        loadAdmin();
      } else {
        msg.textContent = 'Error: ' + (result ? result.error : 'unknown');
        msg.style.color = 'var(--danger)';
      }
    })
    .withFailureHandler(function(e) {
      msg.textContent = 'Error: ' + e.message;
      msg.style.color = 'var(--danger)';
    })
    .saveAdminSettings(adminPw, {
      ROOM_COUNTS: counts,
      CAMPER_VAN_SPOTS: camperEl ? camperEl.value.trim() : '',
      TENT_SPOTS: tentEl ? tentEl.value.trim() : '',
    });
}

function saveSettings() {
  var regOpen = document.getElementById('s-reg-open').checked;
  if (regOpen && isDeadlinePassed()) {
    if (!confirm('Registration deadline has passed! You are opening registration after the set deadline. Remember to close it when done. Continue?')) return;
  }
  const settings = {
    REGISTRATION_OPEN:        regOpen,
    REGISTRATION_CLOSES:      document.getElementById('s-reg-closes').value.trim(),
    ALLOW_SOLO_DOUBLE:        document.getElementById('s-solo-double').checked,
    ALLOW_SINGLE_BED_BOOKING: document.getElementById('s-single-bed').checked,
    TENT_ENABLED:             document.getElementById('s-tent-enabled').checked,
    ANNOUNCEMENT:             document.getElementById('s-announcement').value,
    CLOSED_MESSAGE:           document.getElementById('s-closed-message').value,
    BYPASS_TOKEN:             document.getElementById('s-bypass-token').value.trim(),
    CAMPER_INFO:              document.getElementById('s-camper-info').value,
    TENT_INFO:                document.getElementById('s-tent-info').value,
    PRICE_DISCLAIMER:         document.getElementById('s-price-disclaimer').value,
  };
  const msg = document.getElementById('settings-msg');
  msg.textContent = 'Saving...';
  msg.style.color = 'var(--muted)';
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        msg.textContent = '\u2713 Saved';
        msg.style.color = 'var(--success)';
        setTimeout(function(){ msg.textContent = ''; }, 3000);
      } else {
        msg.textContent = 'Error: ' + (result ? result.error : 'unknown');
        msg.style.color = 'var(--danger)';
      }
    })
    .withFailureHandler(function(e) {
      msg.textContent = 'Error: ' + e.message;
      msg.style.color = 'var(--danger)';
    })
    .saveAdminSettings(adminPw, settings);
}

function exportCSV() {
  if (!allRows.length) return;
  const cols = Object.keys(allRows[0]);
  const lines = [cols.join(',')].concat(allRows.map(function(r){
    return cols.map(function(c){ return '"'+(r[c]||'').toString().replace(/"/g,'""')+'"'; }).join(',');
  }));
  const blob = new Blob([lines.join(String.fromCharCode(10))], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'NordicVUSHF2026_bookings.csv';
  a.click();
}
<\/script>
</body>
</html>`;
}