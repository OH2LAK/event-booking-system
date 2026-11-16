# Database reference

PostgreSQL 16. The schema is in [`db/schema.sql`](../db/schema.sql); it is idempotent (`CREATE ... IF NOT EXISTS`) and is
applied automatically when the app starts (and by the `db` container on first start). There are eight tables.

```
bookings         one row per registered person (all booking types)
settings         key/value store for settings edited in the admin panel
room_types       room type catalog (names, capacity, prices)
event_config     event identity, privacy and language settings (single row)
event_structure  days, nights, extra nights and meal package (single row)
translations     admin-edited texts per language (see LANGUAGES.md)
currency_rates   exchange rates for the extra (display-only) currencies (see CURRENCIES.md)
event_log        audit/diagnostic log written by the app
```

Money amounts are in the event's native currency (`CURRENCY` in `event_config`, default EUR; see [CURRENCIES.md](CURRENCIES.md)). The room price column is still called `price_eur` for historical reasons; it holds the amount in the native currency. Timestamps are `timestamptz` (stored in UTC, shown in the time zone set by `TZ`).

## `bookings`

One row per **person**, not per room. A room with three occupants is three rows linked by `room_ref`.

| Column | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | serial, PK | auto | Internal row id. Not shown anywhere. |
| `seq` | integer, unique | - | Running number. The numeric part of `booking_ref`. Next value = highest `seq` + 1. |
| `booking_ref` | text, unique | - | Public booking reference, `<CALLSIGN>-<seq>`, e.g. `OH2ABC-7`. Used in emails and join links. |
| `created_at` | timestamptz | `now()` | When the booking was made. |
| `callsign` | text | - | Upper case, `A-Z 0-9 / -`, 3-20 characters. |
| `name` | text | - | Full name. |
| `email` | text | - | Confirmation and change emails go here. |
| `phone` | text | `''` | Optional. |
| `country` | text | `''` | Optional. |
| `type` | text | - | `room`, `camper`, `tent`, `singlebed` or `dayvisitor` (CHECK constraint). |
| `room_id` | text | `''` | Room type id for `room` bookings (see below), `singlebed` for single-bed bookings, otherwise empty. |
| `room_ref` | text | - | `booking_ref` of the **primary booker** of the room / camper spot. A primary booker (and every tent, single-bed and day-visitor booking) points to its own `booking_ref`. |
| `is_primary` | boolean | `false` | `true` for the person who holds the room / camper spot, and for tent, single-bed and day-visitor bookings. `false` for joiners. |
| `extra_nights` | text | `''` | Comma-separated extra-night keys from the event structure, e.g. `x1,x2` (room and single-bed bookings only). Joiners inherit them from the room. |
| `nights` | text | `''` | Per-night mode only: comma-separated day keys for the nights a room or single-bed guest stays. Empty means all core nights. |
| `thu_extra_night` | boolean | `false` | **Deprecated**: legacy column, no longer written. Migrated into `extra_nights` (`thu`) on first start. |
| `full_board` | boolean | `false` | Meal package (contents defined in the event structure). |
| `dietary` | text | `''` | Free text. |
| `shirt_size` | text | `''` | Free text / size code. |
| `total_price` | numeric(8,2) | `0` | Price for this person, calculated by the app (see "Prices" below). |
| `price_breakdown` | text | `''` | Human-readable lines joined with ` | `, shown in emails. |
| `status` | text | `CONFIRMED` | `CONFIRMED`, `CHECKED_IN`, `NEEDS_ATTENTION` or `CANCELLED` (CHECK constraint). |
| `room_number` | text | `''` | Hotel room number, set by organizers. Shared by everyone in the same room. |
| `org_comment` | text | `''` | Internal organizer note. The app writes a note here when it flags a booking `NEEDS_ATTENTION`. |
| `publish_consent` | boolean | `true` | `true` = may appear on the public "Who's coming?" page (callsign and first name only). The booking form sends it explicitly and it is **opt-in** (unticked box = `false`); the column default only affects rows inserted outside the app. |
| `privacy_ack_at` | timestamptz | `NULL` | When the participant confirmed the privacy notice on the booking form. `NULL` for imported or older rows. |
| `language` | text | `''` | Language code the guest used when booking (`en`, `fi`, `sv`, `no`, `da`, `is`, `et`, `lv`, `lt`, `pl`, `de`). Emails to this guest use it. `''` = event default. |
| `solo_room` | boolean | `false` | One person occupies a multi-person room alone and pays the whole room price; the room cannot be joined. |
| `visitor_days` | text | `''` | Comma-separated day keys from the event structure that a day visitor attends, e.g. `d1,d2`; otherwise empty. |
| `day_visitor_days` | text | `''` | **Deprecated**: legacy column (`fri`/`sat`/`both`), no longer written. Migrated into `visitor_days` on first start. |
| `meals` | text | `''` | Legacy free-form list of individual meals (informational; not included in `total_price`). The booking form only offers the meal package. |
| `is_organizer` | boolean | `false` | Staff/organizer; shows a badge on the public list. |
| `free_text` | text | `''` | "Additional information" written by the booker. |
| `currency` | text | `'EUR'` | Native currency of the event when the booking was made (ISO 4217). `total_price` and `price_breakdown` are in it. |
| `display_currency` | text | `''` | Extra currency the guest picked for an indicative conversion, or empty. Never used for payment. |
| `display_rate` | numeric(18,8) | null | Units of `display_currency` per 1 native unit, fixed when the guest booked. Used for the approximate amount in emails. |

### Constraints and indexes

| Name | Rule |
| --- | --- |
| `bookings_pkey` | `id` |
| unique `seq`, unique `booking_ref` | No duplicate references. |
| `bookings_active_callsign_uq` | Unique `callsign` **where `status <> 'CANCELLED'`**: one active booking per callsign. A cancelled booking does not block a new one. |
| `bookings_room_ref_idx`, `bookings_room_id_idx` | Lookup speed for room groups. |
| CHECK on `type`, `status`, `day_visitor_days` | Only the values listed above. |

Capacity limits (rooms left, camper spots, tent spots, room full) are **not** database constraints. The app enforces them
inside a transaction that takes a global advisory lock (`pg_advisory_xact_lock(2026051501)`), so simultaneous bookings
cannot overbook.

### Row patterns

| Situation | `type` | `room_id` | `is_primary` | `room_ref` |
| --- | --- | --- | --- | --- |
| Person who books a hotel room | `room` | e.g. `2S` | `true` | own `booking_ref` |
| Person who joins that room | `room` | same as primary | `false` | primary's `booking_ref` |
| Camper van holder | `camper` | empty | `true` | own `booking_ref` |
| Person travelling in the same van | `camper` | empty | `false` | holder's `booking_ref` |
| Tent | `tent` | empty | `true` | own `booking_ref` |
| Single bed (organizer-assigned room) | `singlebed` | `singlebed` | `true` | own `booking_ref` |
| Day visitor | `dayvisitor` | empty | `true` | own `booking_ref` |

"Active" bookings are those with status `CONFIRMED`, `CHECKED_IN` or `NEEDS_ATTENTION`. Only these count for capacity,
availability, the public list and price recalculation. `CANCELLED` rows are kept for the record.

### Status meaning

| Status | Meaning |
| --- | --- |
| `CONFIRMED` | Normal active booking. |
| `CHECKED_IN` | Guest has arrived (set by the check-in desk in `/report`). |
| `NEEDS_ATTENTION` | Set automatically on roommates when their primary booker is cancelled or moved away; needs reassignment. |
| `CANCELLED` | No longer counts anywhere. |

### Room type ids (`room_id`)

Defined in [`src/config.js`](../src/config.js). Default counts and prices can be overridden in the admin panel (stored in
`settings`).

| id | Room | Persons | Default count | Default price (room, EUR) |
| --- | --- | --- | --- | --- |
| `1S-W` | Single, window, upstairs | 1 | 6 | 220 |
| `1S-NW` | Single, no window, upstairs | 1 | 3 | 200 |
| `2S` | Double, upstairs | 2 | 20 | 270 |
| `3S-U` | Triple, upstairs | 3 | 3 | 330 |
| `3S` | Triple, downstairs | 3 | 1 | 330 |
| `4S` | Quad, downstairs | 4 | 2 | 400 |
| `7S` | Seven-person, downstairs | 7 | 1 | 540 |

### Prices

`total_price` and `price_breakdown` are calculated by [`src/pricing.js`](../src/pricing.js) when a booking is made and are
**stored**. Changing a price in the admin panel does not change existing bookings until the booking is edited or an
organizer runs **Recalculate prices** (which updates every active booking). Room bookings pay `room price / persons`
(rounded) per person, or the whole price when `solo_room` is set; each extra night costs the room price divided by the nights included
in the room price (`coreNights` in the event structure), shared the same way. Day visitors pay the day fee per selected day, or
the full-event fee when they select every day. Meeting fee and meal package are added per person.

## `settings`

Key/value store that replaces Apps Script "Script Properties". A key that is absent means "use the default from
`src/config.js`". Values are always text.

| Column | Type | Description |
| --- | --- | --- |
| `key` | text, PK | Setting name. |
| `value` | text | Value. Booleans are `true`/`false`, numbers are plain decimals. |

Keys written by the admin panel:

| Key | Type | Meaning |
| --- | --- | --- |
| `REGISTRATION_OPEN` | boolean | Registration open switch. |
| `REGISTRATION_CLOSES` | text `YYYY-MM-DD` | Registration closes automatically at 23:59 (server time zone `TZ`) on this date. |
| `ALLOW_SOLO_DOUBLE` | boolean | Allow one person to book a whole multi-person room. |
| `ALLOW_SINGLE_BED_BOOKING` | boolean | Enable the single-bed option. |
| `TENT_ENABLED` | boolean | Show/accept tent bookings (default on). |
| `ANNOUNCEMENT` | text | Banner on the booking page. |
| `CLOSED_MESSAGE` | text | Message shown when registration is closed. |
| `BYPASS_TOKEN` | text | Secret value for the "register even when closed" link (`/?bypass=<token>`). |
| `CAMPER_INFO`, `TENT_INFO` | text | Info shown to campers/tenters and in their emails. |
| `PRICE_DISCLAIMER` | text | Note shown under prices and in emails. |
| `FULL_BOARD_PRICE` | number | Meal package, EUR per person. |
| `CAMPER_VAN_PRICE_PER_NIGHT` | number | Camper spot, EUR per night (2 nights are charged). |
| `TENT_PRICE_WEEKEND` | number | Tent spot, EUR. |
| `SINGLE_BED_PRICE` | number | Single bed, EUR. |
| `SINGLE_BED_SLOTS` | integer | How many single-bed bookings may be offered (0 = none). |
| `MEETING_FEE_WEEKEND`, `MEETING_FEE_DAY` | number | Meeting fee for the full event / for a single day (day visitors). |
| `CAMPER_VAN_SPOTS`, `TENT_SPOTS` | integer | Camper / tent capacity. |
| `ROOM_PRICE_<id>`, `ROOM_COUNT_<id>` | | Legacy keys. Only read once, to seed `room_types` on first start; afterwards room counts and prices live in `room_types`. |
| `ROOMS_INITIALIZED` | `1` | Marks that `room_types` has been seeded. |
| `LAST_SHUTDOWN` | JSON | Written by Event shutdown: `{at, bookingsErased, noticesSent, noticesFailed, verified}`. Contains no personal data. |

## `room_types`

The room catalog, edited in the admin panel's **Room types** card. Seeded from `src/config.js` on first start.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | Short code, e.g. `2S` (letters, digits, `-`, max 12). Referenced by `bookings.room_id` |
| `sort` | integer | Display order |
| `persons` | integer | Capacity of one room (1-20). Cannot change once bookings exist |
| `count` | integer | Number of rooms of this type |
| `price_eur` | numeric(10,2) | Price per room for the whole event |
| `note_en` | text | English description shown to guests |
| `note_fi` | text | Optional Finnish description for the report tool |

A room type that has bookings (even cancelled ones) cannot be deleted; set `count` to 0 instead.

## `event_config`

Single-row table (`id` is always 1) holding the event identity set in the admin panel's Event setup card.

| Column | Type | Notes |
|---|---|---|
| `id` | smallint PK | Always 1 (CHECK constraint) |
| `config` | jsonb | Keys such as `EVENT_NAME`, `EVENT_SHORT`, `ORGANIZER`, `LOCATION`, `DATES_TEXT`, `CHECKIN_TIME`, `CHECKOUT_TIME`, `REPLY_TO_EMAIL`, `LOGO1_URL`, `LOGO2_URL`, `ACCENT_COLOR`, ... and the privacy keys `CONTROLLER_NAME`, `CONTROLLER_ADDRESS`, `PRIVACY_CONTACT_EMAIL`, `PRIVACY_URL`, `EVENT_END_DATE` (`YYYY-MM-DD`), `RETENTION_DAYS` (0-365, default 30) and `RETENTION_HOLD` (reason text, empty = no hold), the language keys `LANGUAGES` and `DEFAULT_LANGUAGE`, and the currency keys `CURRENCY` (native currency, default `EUR`) and `CURRENCIES` (comma list of extra display currencies) |
| `updated_at` | timestamptz | Last save |

No row means the event is not configured yet and the public booking page shows "not open yet".

## `translations`

Admin-edited texts for multi-language support (see [LANGUAGES.md](LANGUAGES.md)). One row per language and text key.

| Column | Type | Notes |
|---|---|---|
| `lang` | text | Language code |
| `key` | text | Catalog key such as `form.confirm`, or `content.*` for event content you typed (for example `content.event.EVENT_NAME`) |
| `value` | text | The text shown instead of the built-in one. `<` and `>` are removed on save. |
| `updated_at` | timestamptz | Last save |

Primary key `(lang, key)`. Delete a row to return to the built-in text. The `event_config` keys `LANGUAGES` (comma list) and `DEFAULT_LANGUAGE` choose what is offered.

## `currency_rates`

Exchange rates for the extra currencies guests may pick for an indicative conversion (see [CURRENCIES.md](CURRENCIES.md)).

| Column | Type | Notes |
|---|---|---|
| `code` | text PK | Extra currency, ISO 4217 (e.g. `USD`) |
| `rate` | numeric(18,8) | Units of `code` per 1 unit of `base` (CHECK > 0) |
| `manual` | boolean | `true` = entered by hand; kept when ECB rates are fetched |
| `base` | text | Native currency the rate was saved for. A rate whose `base` differs from the current native currency is ignored. |
| `updated_at` | timestamptz | Last save or fetch |

## `event_structure`

Single-row table (`id` is always 1) describing the shape of the event, edited in the admin panel's **Event structure** card.

| Column | Type | Notes |
|---|---|---|
| `id` | smallint PK | Always 1 |
| `structure` | jsonb | `days` (core event days: `key`, `label`, `short`), `accommodation` (`period` or `per_night`), `coreNights` (nights included in the room price; equals the number of days in `per_night` mode), `extraNights` (optional nights: `key`, `label`, `includes`) and `package` (`enabled`, `sub`, `includes[]`) |
| `updated_at` | timestamptz | Last save |

Keys are stored on bookings (`bookings.extra_nights`, `bookings.visitor_days`), so a day or extra night that is in use
cannot be removed. On first start the row is created automatically: installs that already have bookings get the original
shape (days `fri`, `sat`; extra night `thu`) so old data stays valid, fresh installs get "Day 1" and "Day 2".

## `event_log`

Append-only diagnostic log (replaces the "Log" sheet).

| Column | Type | Description |
| --- | --- | --- |
| `id` | bigserial, PK | |
| `created_at` | timestamptz | |
| `level` | text | `OK`, `WARN` or `ERROR`. |
| `event` | text | `booking_confirmed`, `booking_rejected`, `email_failed`, `accommodation_changed`, `role_changed`, `checked_in`. |
| `callsign` | text | Callsign (or booking reference for `checked_in`). |
| `detail` | text | Free text, e.g. `ref=OH2ABC-7 type=room price=EUR135`, or the rejection reason. |

Entries are removed when the person they mention is erased (callsign, booking reference or email match). Event shutdown deletes the whole table and then writes one `event_shutdown` line; per-person erasure writes a `data_erased` line with only the numeric `seq`. No names or email addresses are logged on purpose.

## Mapping to the old Google Sheet

The admin table and the importer still use the old sheet header names.

| Sheet header | Column | Sheet header | Column |
| --- | --- | --- | --- |
| Timestamp | `created_at` | PriceBreakdown | `price_breakdown` |
| BookingRef | `booking_ref` | Status | `status` |
| Callsign | `callsign` | RoomNumber | `room_number` |
| Name | `name` | OrgComment | `org_comment` |
| Email | `email` | PublishConsent | `publish_consent` |
| Phone | `phone` | SoloRoom | `solo_room` |
| Country | `country` | DayVisitorDays | `visitor_days` (now generic day keys) |
| Type | `type` | IsOrganizer | `is_organizer` |
| RoomId | `room_id` | FreeText | `free_text` |
| RoomRef | `room_ref` | Meals | `meals` |
| IsPrimaryBooker | `is_primary` | ThuExtraNight | `extra_nights` (now generic extra-night keys) |
| FullBoard | `full_board` | Dietary / ShirtSize / TotalPrice | `dietary` / `shirt_size` / `total_price` |
| Language | `language` | (new, no sheet equivalent) | |

In the sheet, booleans were `YES`/`NO` text; in the database they are real booleans.

## Useful queries

Connect with `psql vushf` (native install) or `docker compose exec db psql -U vushf -d vushf` (Docker).

```sql
-- Bookings by type (active only)
SELECT type, count(*) FROM bookings WHERE status <> 'CANCELLED' GROUP BY type ORDER BY type;

-- Guests per language ('' = event default)
SELECT language, count(*) FROM bookings WHERE status <> 'CANCELLED' GROUP BY language ORDER BY language;

-- Texts edited in the admin panel for one language
SELECT key, left(value, 60) AS value, updated_at FROM translations WHERE lang = 'fi' ORDER BY key;

-- Who is in which room
SELECT room_ref, room_id, string_agg(callsign, ', ' ORDER BY is_primary DESC) AS occupants, max(room_number) AS room_no
FROM bookings WHERE type = 'room' AND status <> 'CANCELLED' GROUP BY room_ref, room_id ORDER BY room_ref;

-- Booked rooms per room type
SELECT room_id, count(*) AS booked FROM bookings
WHERE type = 'room' AND is_primary AND status <> 'CANCELLED' GROUP BY room_id ORDER BY room_id;

-- Meal package count and estimated revenue
SELECT count(*) FILTER (WHERE full_board) AS full_board, sum(total_price) AS revenue
FROM bookings WHERE status <> 'CANCELLED';

-- Bookings that need attention
SELECT booking_ref, callsign, org_comment FROM bookings WHERE status = 'NEEDS_ATTENTION';

-- Recent log entries
SELECT created_at, level, event, callsign, detail FROM event_log ORDER BY id DESC LIMIT 50;
```

## Backup and restore

The database holds personal data. Keep dumps out of Git (`backups/` is ignored by `.gitignore`).

```bash
mkdir -p backups
# native PostgreSQL
pg_dump vushf > backups/vushf-$(date +%Y%m%d-%H%M).sql
# Docker
docker compose exec -T db pg_dump -U vushf vushf > backups/vushf-$(date +%Y%m%d-%H%M).sql
```

Restore into an empty database:

```bash
psql vushf < backups/vushf-YYYYMMDD-HHMM.sql
docker compose exec -T db psql -U vushf -d vushf < backups/vushf-YYYYMMDD-HHMM.sql
```

## Schema changes

Edit `db/schema.sql` and keep it idempotent. For existing databases add an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
statement: the app re-applies the whole file on every start, so new statements run automatically. Update `src/repo.js`
(column mapping) and this document at the same time.
