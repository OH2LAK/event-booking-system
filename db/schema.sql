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

-- Payment tracking. Today payment happens at the event: the admin marks bookings as paid.
-- (Online payment via Stripe/SumUp can set the same field later.)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'UNPAID';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_chk CHECK (payment_status IN ('UNPAID','PAID','WAIVED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Optional extras the organizer offers (meals, excursions, workshops ...), edited in Event setup.
-- capacity 0 = unlimited. closes = last day guests can add it (empty = until registration closes).
CREATE TABLE IF NOT EXISTS addons (
  id          TEXT PRIMARY KEY,
  sort        INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  max_qty     INTEGER NOT NULL DEFAULT 1 CHECK (max_qty BETWEEN 1 AND 20),
  capacity    INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  closes      DATE,
  enabled     BOOLEAN NOT NULL DEFAULT true
);

-- What each booking chose. name and unit_price are a snapshot, so history survives catalog edits.
CREATE TABLE IF NOT EXISTS booking_addons (
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  addon_id    TEXT NOT NULL,
  qty         INTEGER NOT NULL CHECK (qty >= 1),
  unit_price  NUMERIC(10,2) NOT NULL,
  name        TEXT NOT NULL,
  PRIMARY KEY (booking_id, addon_id)
);

-- ---- Public API (see docs/API.md) ----
-- Named API keys. Only a SHA-256 hash of the key is stored; the key itself is shown once when it is created.
-- scopes: stats (no personal data), bookings:read, bookings:write.
CREATE TABLE IF NOT EXISTS api_keys (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,                      -- first characters of the key, to recognise it in the list
  key_hash      TEXT NOT NULL UNIQUE,
  scopes        TEXT NOT NULL,                      -- comma-separated
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  request_count BIGINT NOT NULL DEFAULT 0,
  revoked_at    TIMESTAMPTZ
);

-- Idempotency-Key support for POST /api/v1/bookings: the stored response is replayed on a retry (kept 24 hours).
CREATE TABLE IF NOT EXISTS api_idempotency (
  key_id       INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  idem_key     TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code  INTEGER,
  response     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, idem_key)
);

-- Webhook endpoints. secret signs every delivery (HMAC-SHA256), payload 'full' or 'minimal' (no personal data).
CREATE TABLE IF NOT EXISTS webhooks (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  secret        TEXT NOT NULL,
  events        TEXT NOT NULL,                      -- comma-separated event types
  payload       TEXT NOT NULL DEFAULT 'full' CHECK (payload IN ('full','minimal')),
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status   TEXT NOT NULL DEFAULT '',
  last_at       TIMESTAMPTZ,
  failures      INTEGER NOT NULL DEFAULT 0          -- consecutive failed deliveries
);

-- Delivery queue and log. The payload is removed once a delivery has succeeded (it holds personal data).
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID PRIMARY KEY,
  webhook_id      INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  booking_ref     TEXT NOT NULL DEFAULT '',
  payload         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_code       INTEGER,
  last_error      TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

-- ---- Admin accounts with two-factor authentication (see docs/ADMIN-GUIDE.md) ----
-- Named users replace the shared admin/setup passwords. role: setup (event setup + bookings) or admin (bookings only).
-- Secrets: password_hash is scrypt; totp_secret is AES-256-GCM encrypted with a key derived from SESSION_SECRET;
-- recovery codes and invite/reset tokens are stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS admin_users (
  id               SERIAL PRIMARY KEY,
  email            TEXT NOT NULL,
  name             TEXT NOT NULL DEFAULT '',
  role             TEXT NOT NULL CHECK (role IN ('setup','admin')),
  password_hash    TEXT NOT NULL DEFAULT '',
  totp_secret      TEXT NOT NULL DEFAULT '',
  totp_enabled     BOOLEAN NOT NULL DEFAULT false,
  totp_last_step   BIGINT NOT NULL DEFAULT 0,
  email_otp_enabled BOOLEAN NOT NULL DEFAULT false,
  recovery_codes   JSONB NOT NULL DEFAULT '[]',
  disabled         BOOLEAN NOT NULL DEFAULT false,
  token_hash       TEXT NOT NULL DEFAULT '',
  token_kind       TEXT NOT NULL DEFAULT '',
  token_expires    TIMESTAMPTZ,
  failed_logins    INTEGER NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_idx ON admin_users (lower(email));

CREATE TABLE IF NOT EXISTS admin_passkeys (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  cred_id      TEXT NOT NULL UNIQUE,
  public_key   TEXT NOT NULL,
  counter      BIGINT NOT NULL DEFAULT 0,
  transports   TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- Login sessions. stage: mfa (password ok, waiting for the second factor), enrol (password ok, must set up 2FA), ok (fully signed in).
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL CHECK (stage IN ('mfa','enrol','ok')),
  meta        JSONB NOT NULL DEFAULT '{}',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions (user_id);
