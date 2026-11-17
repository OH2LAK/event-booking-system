'use strict';
// Event configuration. Defaults for everything that the admin panel can override
// at runtime (see settings.js).

const VERSION = '20260504-2136-node';

const CONFIG = {
  // Public URL used in emails and join links (set PUBLIC_URL in .env)
  FRIENDLY_URL: process.env.PUBLIC_URL || "http://localhost:3000",


  // --- Event info ---
  // Placeholder defaults only. The real values are stored in the database (table event_config),
  // edited in the admin panel ("Event setup") and applied by eventConfig.js at startup.
  EVENT_NAME:     "Example Event 2027",
  EVENT_SHORT:    "Example Event",
  ORGANIZER:      "Example Organization",
  ORGANIZER_SHORT:"Example Org",
  LOCATION:       "Example Venue, Example City",
  LOCATION_SHORT: "Example City",
  DATES_TEXT:     "13-16 May 2027",
  CHECKIN_TIME:   "Check-in from 15:00",
  CHECKOUT_TIME:  "Check-out by 12:00",
  HOME_URL:       "",
  HOME_LABEL:     "Back to the event page",
  // Privacy and data retention (edited in the admin panel: Event setup)
  CONTROLLER_NAME: "", CONTROLLER_ADDRESS: "", PRIVACY_CONTACT_EMAIL: "", PRIVACY_URL: "",
  EVENT_END_DATE: "", RETENTION_DAYS: "30", RETENTION_HOLD: "",
  LANGUAGES: "en", DEFAULT_LANGUAGE: "en",
  // Native currency (all prices and payments) and extra currencies for indicative display only (see currency.js)
  CURRENCY: "EUR", CURRENCIES: "",
  LOGO1_URL:      "",
  LOGO2_URL:      "",
  ACCENT_COLOR:   "#b45309",
  SLUG:           "example-event",
  // Event structure (days, extra nights, meal package): defaults here, stored in event_structure (see structure.js)
  STRUCTURE: { days: [{ key: "d1", label: "Day 1", short: "Day 1" }, { key: "d2", label: "Day 2", short: "Day 2" }], coreNights: 2, extraNights: [], package: { enabled: true, sub: "", includes: [] } },
  MEAL_PACKAGE_SUB: "",

  // --- Email ---
  EMAIL_SENDER_NAME: process.env.EMAIL_SENDER_NAME || "Example Event",
  REPLY_TO_EMAIL:    process.env.REPLY_TO_EMAIL || "",


  // --- Room inventory ---
  // Default room types. They are copied into the database (room_types) on first start and are then
  // edited in the admin panel (Room types card).
  ROOMS: [
    { id: "1S-W",  persons: 1, count: 6,  price_eur: 220, note_en: "Single room, window",           note_fi: "1hh huone, ikkuna" },
    { id: "1S-NW", persons: 1, count: 3,  price_eur: 200, note_en: "Single room, no window",        note_fi: "1hh huone ilman ikkunaa" },
    { id: "2S",    persons: 2, count: 20, price_eur: 270, note_en: "Double room",                   note_fi: "2hh huone" },
    { id: "3S-U",  persons: 3, count: 3,  price_eur: 330, note_en: "Triple room, upstairs",         note_fi: "3hh huone, yläkerta" },
    { id: "3S",    persons: 3, count: 1,  price_eur: 330, note_en: "Triple room, downstairs",       note_fi: "3hh huone, alakerta" },
    { id: "4S",    persons: 4, count: 2,  price_eur: 400, note_en: "Quad room, downstairs",         note_fi: "4hh huone, alakerta" },
    { id: "7S",    persons: 7, count: 1,  price_eur: 540, note_en: "Seven-person room, downstairs", note_fi: "7hh huone, alakerta" },
  ],

  // Extra bed add-on (per person, whole event 2 nights)
  EXTRA_BED_PRICE: 74,

  // Event type: 'overnight' (rooms, camping, nights) or 'day' (one-day event: registration plus optional extras)
  EVENT_MODE: 'overnight',
  // How guests pay (shown on the booking page and in the confirmation email), e.g. "Pay at the door by card or cash."
  PAYMENT_INFO: '',
  // Optional extras (meals, excursions ...); loaded from the database by addons.js
  ADDONS: [],

  // --- Meal package ---
  FULL_BOARD_PRICE: 75,
  FULL_BOARD_INCLUDES_EN: [],

  // --- Camping / camper van ---
  CAMPER_VAN_SPOTS: 10,
  CAMPER_VAN_PRICE_PER_NIGHT: 20,  // includes electricity
  TENT_SPOTS: 5,
  TENT_PRICE_WEEKEND: 10,
  TENT_PRICE_DAY: 5,  // day visitor camping (not handled in booking — on-site only)

  // Camping nights (nights included in the room price)
  CAMPING_NIGHTS: 2,   // overwritten by the event structure (nights included in the room price)

  // Additional info shown to camper van and tent bookers
  CAMPER_INFO: "This is additional information for camper van guests. Electricity hookup (230V) is available at each spot. Please bring your own extension cable. The camper area is located adjacent to the hotel parking area. More details will be provided closer to the event.",
  TENT_INFO: "This is additional information for tent campers. The tent area is located on the hotel grounds. Shower and toilet facilities in the hotel are available for campers. Please note that open fires are not permitted. More details will be provided closer to the event.",


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

module.exports = { CONFIG, VERSION };
