# Nordic VUSHF 2026 booking system

Event booking system for the Nordic VUSHF Meeting (RATS ry, Hotel Martinhovi, Raisio). Originally a Google Apps Script
web app; this repository contains the containerized **Node.js + PostgreSQL** version plus the original scripts.

Features: room / camper / tent / single-bed / day-visitor bookings, joining an existing room with a booking reference,
live availability, price calculation with admin-editable prices, confirmation and organizer emails, public
"Who's coming?" list, admin panel (settings, pricing, room inventory, editable bookings table, CSV export), and a
report & check-in tool (hotel list, check-in desk, summary, printable slips).

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env - see "Change the default passwords" below
docker compose up --build -d
```

Open http://localhost:3000 (booking page), `/?public=1` (Who's coming), `/?admin=1` (admin panel) and `/report`
(report & check-in tool; uses the same admin password). Data lives in the `pgdata` Docker volume.

## Change the default passwords

`.env.example` ships with placeholder defaults (`change-me-...`) so the stack starts out of the box. **They are public
knowledge. Change all of them before exposing the app to the internet:**

| Variable | What it protects |
| --- | --- |
| `ADMIN_PASSWORD` | Admin panel and the report & check-in tool |
| `SESSION_SECRET` | Signs admin session cookies (`openssl rand -hex 32`) |
| `POSTGRES_PASSWORD` | Database password (the data volume keeps the old one - see below) |
| `SMTP_PASS` | Mail server login |

While any default is still in use the app prints a warning at startup and shows a red banner in the admin panel.

Note: PostgreSQL only reads `POSTGRES_PASSWORD` when the data volume is first created. If you change it afterwards,
either remove the volume (`docker compose down -v`, **deletes data**) or change it inside the database with
`ALTER USER`.

## Documentation

- [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) - guide for event organizers (admin panel, report and check-in tool)
- [docs/DATABASE.md](docs/DATABASE.md) - tables, columns, constraints, settings keys, queries, backup

## Configuration

All settings are in `.env` (see `.env.example`). `PUBLIC_URL` is used for join links in emails. Leave `SMTP_HOST`
empty to disable email (messages are then only logged to the console). Event data (dates, rooms, base prices) is in
`src/config.js`; prices, room counts, registration open/close, announcement, etc. are edited live in the admin panel
and stored in the database.

To brand the pages for another event, edit `src/config.js` and the logo/links in `src/pages.js`.

## Migrating from the Apps Script version

1. **Bookings**: export the "Bookings" sheet as `.xlsx` and import it:
   `DATABASE_URL=postgres://... npm install && npm run import-xlsx -- bookings.xlsx`
   (re-running skips bookings that already exist).
2. **Settings are not in the sheet.** Apps Script kept admin settings (price overrides, room counts, registration
   open/close, bypass token, announcement) in *Script Properties*. Re-enter them in the new admin panel, otherwise the
   defaults from `src/config.js` apply. Compare prices before going live.
3. Point your DNS / Cloudflare redirect at the new server instead of the `script.google.com` URL.

The original scripts are kept in `legacy-apps-script/` with secrets removed (placeholders `REDACTED_...`).

## Differences from the Apps Script version

Security
- The public availability call no longer returns the admin password (it returned the whole config object).
- No password in the browser: admin login sets an HttpOnly, SameSite=Strict session cookie (12 h); login attempts are
  throttled; the password is no longer stored in `localStorage` or sent with every request.
- Guest-supplied text has `<` and `>` removed and callsigns are validated, because several pages render values as HTML.
- CSV exports neutralize spreadsheet formulas.
- Secrets and deployment URLs moved out of the code into `.env`.

Correctness
- Bookings run in a database transaction under a lock, so simultaneous bookings cannot overbook a room or reuse a
  booking reference. One active booking per callsign is enforced by the database.
- Validation errors (empty callsign/name/email) now return the proper message instead of "Server error".
- Solo-occupied rooms are charged the whole room price on the server (the booking page already showed this).
- Recalculating prices no longer charges camper-spot joiners for the camper spot again.
- Server enforces the admin switches for tents, single beds and solo rooms; joining a room no longer bypasses a closed
  registration for non-room bookings.

Not carried over: the Excel export button of the report tool (use CSV) and the `?debug=admin` endpoint.

## Development and tests

```bash
npm install
# needs a PostgreSQL; schema is applied automatically on start
DATABASE_URL=postgres://user:pass@localhost:5432/vushf ADMIN_PASSWORD=secret SESSION_SECRET=x node src/server.js
BASE_URL=http://localhost:3000 ADMIN_PASSWORD=secret node tests/smoke.js   # creates TEST* bookings!
```

Structure: `src/service.js` (booking logic), `src/pricing.js`, `src/settings.js`, `src/emails.js`, `src/pages.js` (HTML
pages), `src/report.js` + `src/reportRoutes.js` (report & check-in), `public/rpc-shim.js` (maps the old
`google.script.run` calls used by the pages to `/api/rpc/<method>`), `db/schema.sql`.

## Privacy

The database contains personal data (names, emails, phone numbers, dietary requirements). Do not commit exports or
database dumps; `.gitignore` excludes `.xlsx`, `.csv` and `.env`.
