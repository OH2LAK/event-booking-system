-- Nordic VUSHF 2026 booking system schema (PostgreSQL)

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
  thu_extra_night  BOOLEAN NOT NULL DEFAULT false,
  full_board       BOOLEAN NOT NULL DEFAULT false,
  dietary          TEXT NOT NULL DEFAULT '',
  shirt_size       TEXT NOT NULL DEFAULT '',
  total_price      NUMERIC(8,2) NOT NULL DEFAULT 0,
  price_breakdown  TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'CONFIRMED'
                   CHECK (status IN ('CONFIRMED','CHECKED_IN','NEEDS_ATTENTION','CANCELLED')),
  room_number      TEXT NOT NULL DEFAULT '',
  org_comment      TEXT NOT NULL DEFAULT '',
  publish_consent  BOOLEAN NOT NULL DEFAULT true,
  solo_room        BOOLEAN NOT NULL DEFAULT false,
  day_visitor_days TEXT NOT NULL DEFAULT '' CHECK (day_visitor_days IN ('','fri','sat','both')),
  meals            TEXT NOT NULL DEFAULT '',         -- comma-separated meal keys
  is_organizer     BOOLEAN NOT NULL DEFAULT false,
  free_text        TEXT NOT NULL DEFAULT ''
);

-- One active booking per callsign (cancelled bookings do not block a new one)
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_callsign_uq
  ON bookings (callsign) WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS bookings_room_ref_idx ON bookings (room_ref);
CREATE INDEX IF NOT EXISTS bookings_room_id_idx  ON bookings (room_id);

-- Admin-editable settings (replaces Apps Script Script Properties)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Event log (replaces the "Log" sheet)
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

-- Generic replacements for thu_extra_night and day_visitor_days (comma-separated structure keys).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS extra_nights TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS visitor_days TEXT NOT NULL DEFAULT '';
-- One-time, idempotent data migration (legacy keys: thu, fri, sat).
UPDATE bookings SET extra_nights = 'thu' WHERE thu_extra_night AND extra_nights = '';
UPDATE bookings SET visitor_days = CASE day_visitor_days WHEN 'both' THEN 'fri,sat' ELSE day_visitor_days END
  WHERE day_visitor_days <> '' AND visitor_days = '';
-- The legacy columns are no longer written; the old CHECK would block new keys only on them.

-- Per-night accommodation mode: core nights a room / single-bed booking stays (comma-separated day keys; empty = all core nights).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS nights TEXT NOT NULL DEFAULT '';

-- GDPR: when the person confirmed the privacy notice at registration (NULL for imported or older rows)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS privacy_ack_at TIMESTAMPTZ;
