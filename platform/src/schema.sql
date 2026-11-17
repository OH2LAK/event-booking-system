CREATE TABLE IF NOT EXISTS orders (
  id            SERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested','approved','paid','active','rejected','cancelled','failed')),
  slug          TEXT NOT NULL,
  event_name    TEXT NOT NULL,
  event_short   TEXT NOT NULL,
  organizer     TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  event_end     DATE,
  event_mode    TEXT NOT NULL DEFAULT 'overnight' CHECK (event_mode IN ('overnight','day')),
  notes         TEXT,
  price_cents   INTEGER,
  currency      TEXT NOT NULL DEFAULT 'eur',
  stripe_session_id TEXT UNIQUE,
  checkout_url  TEXT,
  paid_at       TIMESTAMPTZ,
  decided_at    TIMESTAMPTZ
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS event_mode TEXT NOT NULL DEFAULT 'overnight' CHECK (event_mode IN ('overnight','day'));
-- one live order per slug; rejected/cancelled/failed orders free the name again
CREATE UNIQUE INDEX IF NOT EXISTS orders_live_slug ON orders (slug) WHERE status IN ('requested','approved','paid','active');

CREATE TABLE IF NOT EXISTS tenants (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  slug        TEXT NOT NULL UNIQUE,
  state       TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','suspended','erased')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  erase_after TIMESTAMPTZ,
  warned_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_log (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  order_id INTEGER,
  message TEXT NOT NULL
);
