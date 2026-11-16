# Database reference

PostgreSQL 16. The schema is in [`db/schema.sql`](../db/schema.sql); it is idempotent (`CREATE ... IF NOT EXISTS`) and is
applied automatically when the app starts (and by the `db` container on first start). There are three tables.

```
bookings      one row per registered person (all booking types)
settings      key/value store for settings edited in the admin panel
event_log     audit/diagnostic log written by the app
```

Money amounts are euros. Timestamps are `timestamptz` (stored in UTC, shown in the time zone set by `TZ`).

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
| `thu_extra_night` | boolean | `false` | Extra night Thursday 14 May (room and single-bed bookings only). Joiners inherit it from the room. |
| `full_board` | boolean | `false` | Meal package (Fri BBQ, Sat lunch, Sat Ham Dinner). |
| `dietary` | text | `''` | Free text. |
| `shirt_size` | text | `''` | Free text / size code. |
| `total_price` | numeric(8,2) | `0` | Price for this person, calculated by the app (see "Prices" below). |
| `price_breakdown` | text | `''` | Human-readable lines joined with ` | `, shown in emails. |
| `status` | text | `CONFIRMED` | `CONFIRMED`, `CHECKED_IN`, `NEEDS_ATTENTION` or `CANCELLED` (CHECK constraint). |
| `room_number` | text | `''` | Hotel room number, set by organizers. Shared by everyone in the same room. |
| `org_comment` | text | `''` | Internal organizer note. The app writes a note here when it flags a booking `NEEDS_ATTENTION`. |
| `publish_consent` | boolean | `true` | `true` = may appear on the public "Who's coming?" page (callsign and first name only). |
| `solo_room` | boolean | `false` | One person occupies a multi-person room alone and pays the whole room price; the room cannot be joined. |
| `day_visitor_days` | text | `''` | `fri`, `sat` or `both` for day visitors, otherwise empty (CHECK constraint). |
| `meals` | text | `''` | Comma-separated individual meals the guest ticked: `friBbq`, `friLunch`, `satLunch`, `satHam`. Informational: these are **not** included in `total_price`. |
| `is_organizer` | boolean | `false` | Staff/organizer; shows a badge on the public list. |
| `free_text` | text | `''` | "Additional information" written by the booker. |

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
(rounded) per person, or the whole price when `solo_room` is set; the Thursday extra night is half the room price divided
the same way. Meeting fee and meal package are added per person.

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
| `MEETING_FEE_WEEKEND`, `MEETING_FEE_DAY` | number | Meeting fee, full weekend / single day. |
| `MEAL_FRI_BBQ`, `MEAL_SAT_HAM_DINNER`, `MEAL_LUNCH` | number | Individual meal prices (stored; not currently added to `total_price`). |
| `THU_EXTRA_NIGHT_PRICE` | number | Fixed Thursday-night price; absent = derived from the room price. |
| `CAMPER_VAN_SPOTS`, `TENT_SPOTS` | integer | Camper / tent capacity. |
| `ROOM_PRICE_<id>`, `ROOM_COUNT_<id>` | | Legacy keys. Only read once, to seed `room_types` on first start; afterwards room counts and prices live in `room_types`. |
| `ROOMS_INITIALIZED` | `1` | Marks that `room_types` has been seeded. |

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
| `config` | jsonb | Keys such as `EVENT_NAME`, `EVENT_SHORT`, `ORGANIZER`, `LOCATION`, `DATES_TEXT`, `DATE_THU..SUN`, `CHECKIN_TIME`, `CHECKOUT_TIME`, `REPLY_TO_EMAIL`, `LOGO1_URL`, `LOGO2_URL`, `ACCENT_COLOR`, ... |
| `updated_at` | timestamptz | Last save |

No row means the event is not configured yet and the public booking page shows "not open yet".

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
| Country | `country` | DayVisitorDays | `day_visitor_days` |
| Type | `type` | IsOrganizer | `is_organizer` |
| RoomId | `room_id` | FreeText | `free_text` |
| RoomRef | `room_ref` | Meals | `meals` |
| IsPrimaryBooker | `is_primary` | ThuExtraNight | `thu_extra_night` |
| FullBoard | `full_board` | Dietary / ShirtSize / TotalPrice | `dietary` / `shirt_size` / `total_price` |

In the sheet, booleans were `YES`/`NO` text; in the database they are real booleans.

## Useful queries

Connect with `psql vushf` (native install) or `docker compose exec db psql -U vushf -d vushf` (Docker).

```sql
-- Bookings by type (active only)
SELECT type, count(*) FROM bookings WHERE status <> 'CANCELLED' GROUP BY type ORDER BY type;

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
