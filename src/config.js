'use strict';
// Event configuration. Defaults for everything that the admin panel can override
// at runtime (see settings.js). Ported from the original Apps Script version.

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
  DATE_THU:       "Thursday 13 May 2027",  // optional extra night
  DATE_FRI:       "Friday 14 May 2027",
  DATE_SAT:       "Saturday 15 May 2027",
  DATE_SUN:       "Sunday 16 May 2027",
  DAY_FRI_SHORT:  "Friday 14.5",
  DAY_SAT_SHORT:  "Saturday 15.5",
  THU_NIGHT_LABEL:"13.5 \u2192 14.5",
  CHECKIN_TIME:   "From 15:00 on Thursday/Friday",
  CHECKOUT_TIME:  "Sunday by 12:00",
  HOME_URL:       "",
  HOME_LABEL:     "Back to the event page",
  LOGO1_URL:      "",
  LOGO2_URL:      "",
  ACCENT_COLOR:   "#b45309",
  SLUG:           "example-event",
  MEAL_PACKAGE_SUB: "Fri dinner \u00b7 Sat lunch + dinner",

  // --- Email ---
  EMAIL_SENDER_NAME: process.env.EMAIL_SENDER_NAME || "Example Event",
  REPLY_TO_EMAIL:    process.env.REPLY_TO_EMAIL || "",


  // --- Sheet name ---
  SHEET_NAME: "Bookings",

  // --- Room inventory ---
  // Room types (ids are used by the admin panel; counts and prices can be changed there)
  ROOMS: [
    { id: "1S-W",  type: "single",  persons: 1, floor: "upstairs", window: true,  count: 6,  price_eur: 220, note_en: "Single room, window" },
    { id: "1S-NW", type: "single",  persons: 1, floor: "upstairs", window: false, count: 3,  price_eur: 200, note_en: "Single room, no window" },
    { id: "2S",    type: "double",  persons: 2, floor: "upstairs", window: true,  count: 20, price_eur: 270, note_en: "Double room" },
    // Downstairs rooms
    // Upstairs triple rooms
    { id: "3S-U",  type: "triple",  persons: 3, floor: "upstairs",   window: true, count: 3, price_eur: 330, note_en: "Triple room, upstairs" },
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
    "Friday: dinner",
    "Saturday: lunch + dinner",
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
