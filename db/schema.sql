-- Event booking system schema (PostgreSQL). Applied when the app starts; every statement is idempotent.

CREATE TABLE IF NOT EXISTS bookings (
  id               SERIAL PRIMARY KEY,
  seq              INTEGER NOT NULL UNIQUE,          -- numeric part of BookingRef
  booking_ref      TEXT NOT NULL UNIQUE,             -- e.g. OH2ABC-7
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  callsign         TEXT NOT NULL,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT NOT NULL DEFAULT '',
  country          TEXT NOT NULL DEFAULT '',
  type             TEXT NOT NULL CHECK (type IN ('room','camper','tent','singlebed','dayvisitor')),
  room_id          TEXT NOT NULL DEFAULT '',
  room_ref         TEXT NOT NULL,                    -- primary booking_ref of the room/spot
  is_primary       BOOLEAN NOT NULL DEFAULT false,
  extra_nights     TEXT NOT NULL DEFAULT '',         -- comma-separated extra-night keys from the event structure
  nights           TEXT NOT NULL DEFAULT '',         -- per-night mode: core nights booked (day keys); empty = all core nights
  visitor_days     TEXT NOT NULL DEFAULT '',         -- day visitors: comma-separated day keys
  full_board       BOOLEAN NOT NULL DEFAULT false,   -- meal package
  dietary          TEXT NOT NULL DEFAULT '',
  shirt_size       TEXT NOT NULL DEFAULT '',
  total_price      NUMERIC(8,2) NOT NULL DEFAULT 0,  -- in `currency`
  price_breakdown  TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'CONFIRMED'
                   CHECK (status IN ('CONFIRMED','CHECKED_IN','NEEDS_ATTENTION','CANCELLED')),
  room_number      TEXT NOT NULL DEFAULT '',
  org_comment      TEXT NOT NULL DEFAULT '',
  publish_consent  BOOLEAN NOT NULL DEFAULT true,    -- show callsign and first name on the public list
  solo_room        BOOLEAN NOT NULL DEFAULT false,
  is_organizer     BOOLEAN NOT NULL DEFAULT false,
  free_text        TEXT NOT NULL DEFAULT '',
  privacy_ack_at   TIMESTAMPTZ,                      -- when the person confirmed the privacy notice
  language         TEXT NOT NULL DEFAULT '',         -- language used when booking (emails use it); '' = event default
  currency         TEXT NOT NULL DEFAULT 'EUR',      -- native currency of the event when booked
  display_currency TEXT NOT NULL DEFAULT '',         -- extra currency the guest picked for an indicative conversion
  display_rate     NUMERIC(18,8)                     -- its rate (units per 1 native unit), fixed when booked
);

-- One active booking per callsign (cancelled bookings do not block a new one)
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_callsign_uq
  ON bookings (callsign) WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS bookings_room_ref_idx ON bookings (room_ref);
CREATE INDEX IF NOT EXISTS bookings_room_id_idx  ON bookings (room_id);

-- Admin-editable settings (key/value)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Diagnostic and audit log
CREATE TABLE IF NOT EXISTS event_log (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level      TEXT NOT NULL,
  event      TEXT NOT NULL,
  callsign   TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT ''
);

-- Event identity and branding, edited in the admin panel ("Event setup").
-- Single row (id = 1). While the row does not exist the app shows a "not set up yet" page.
CREATE TABLE IF NOT EXISTS event_config (
  id         SMALLINT PRIMARY KEY CHECK (id = 1),
  config     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Room catalog (editable in the admin panel). Seeded from src/config.js defaults on first start.
-- price_eur is the price in the event's native currency.
CREATE TABLE IF NOT EXISTS room_types (
  id         TEXT PRIMARY KEY,
  sort       INTEGER NOT NULL DEFAULT 0,
  persons    INTEGER NOT NULL CHECK (persons BETWEEN 1 AND 20),
  count      INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  price_eur  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price_eur >= 0),
  note_en    TEXT NOT NULL,
  note_fi    TEXT NOT NULL DEFAULT ''
);

-- Event structure (days, extra nights, meal package), edited in the admin panel.
CREATE TABLE IF NOT EXISTS event_structure (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  structure JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin-edited texts per language (overrides of the built-in catalog and translated event content)
CREATE TABLE IF NOT EXISTS translations (
  lang       TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, key)
);

-- Exchange rates for the extra display currencies (event_config.CURRENCIES). The event has one native currency
-- (event_config.CURRENCY, default EUR). rate = units of `code` per 1 unit of `base` (the native currency when saved).
CREATE TABLE IF NOT EXISTS currency_rates (
  code        TEXT PRIMARY KEY,
  rate        NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  manual      BOOLEAN NOT NULL DEFAULT true,        -- true = entered by hand, kept when fetching ECB rates
  base        TEXT NOT NULL DEFAULT 'EUR',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
