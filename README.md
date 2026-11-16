# Event booking system

A self-hosted booking system for small and mid-sized events with accommodation: rooms, camper vans, tents, single beds and
day visitors. It runs as a containerized **Node.js + PostgreSQL** app and is configured for your own event from the admin panel
(name, organizer, dates, contact, logos, accent color).

Features: room / camper / tent / single-bed / day-visitor bookings, joining an existing room with a booking reference,
live availability, price calculation with admin-editable prices, confirmation and organizer emails, public
"Who's coming?" list, admin panel (event setup, settings, pricing, room inventory, editable bookings table, CSV export), and a
report & check-in tool (hotel list, check-in desk, summary, printable slips).

## Background

The system was first built as a Google Apps Script web app for the **Nordic VUSHF Meeting 2026** (organized by RATS ry at
Hotel Martinhovi, Raisio, Finland), where it handled the real bookings. It was then ported to Node.js + PostgreSQL and made
event-neutral. The original scripts (with secrets redacted) are kept in `legacy-apps-script/`.

## First-time event setup

1. Start the app (see below) and open `/?admin=1`, then log in with `ADMIN_PASSWORD`.
2. The **Event setup** card at the top opens automatically on a fresh install. Fill in event name, organizer, location, dates,
   check-in/out times, contact email, logos and accent color, then press **Save event setup**.
3. Until this is saved, visitors only see a "booking is not open yet" page.
4. Then set registration dates, prices and room inventory further down the admin panel.

Room types (id, description, persons per room, count, price) are defined in the **Room types** card of the admin panel. On first start they are seeded from the defaults in `src/config.js`. The days of the event, optional extra nights and the meal package are defined in the **Event structure** card (installs that already hold bookings keep the original Fri/Sat + Thursday shape automatically). The booking types (room, camper, tent, single bed, day visitor) are fixed.

## Demo data and screenshots

To get a fictional event with fake bookings (for documentation screenshots or trying things out) on an **empty** database:

```bash
npm run seed-demo        # needs DATABASE_URL; refuses to run on a non-empty database without --force
```

See `docs/SCREENSHOTS.md` for the list of screens to capture.

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env - see "Change the default passwords" below
docker compose up --build -d
```

Open http://localhost:3000 (booking page), `/?public=1` (Who's coming), `/?admin=1` (admin panel) and `/report`
(report & check-in tool; uses the same admin password). Data lives in the `pgdata` Docker volume.

## Making it reachable from the network

The app listens on port 3000 (change it with `PORT` in `.env`), published by Docker Compose on all host interfaces. So
`http://<server-ip>:3000` already works from the local network once the host firewall allows the port. How you expose it
to the internet depends on your platform and is standard Docker/web hosting practice, so it is not covered in detail here.
The usual setup is:

1. Point a DNS name at your server.
2. Put a reverse proxy with HTTPS in front of the app (Caddy, nginx or Traefik), forwarding to `localhost:3000`.
3. Set `PUBLIC_URL` in `.env` to the public address (e.g. `https://booking.example.org`) so join links in emails are correct.
4. Do not expose PostgreSQL: the `db` service has no published port, keep it that way.
5. Use HTTPS in production, since the admin login and booking data are sent over the connection.

Useful guides:

- [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/) and [published ports](https://docs.docker.com/engine/network/port-publishing/)
- [Docker and firewalls (ufw/iptables)](https://docs.docker.com/engine/network/packet-filtering-firewalls/): published ports can bypass ufw rules
- [Caddy reverse proxy quick start](https://caddyserver.com/docs/quick-starts/reverse-proxy) (automatic HTTPS)
- [nginx reverse proxy](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/) with [Let's Encrypt / certbot](https://certbot.eff.org/)
- [Traefik with Docker](https://doc.traefik.io/traefik/providers/docker/)

To make the app reachable only through the reverse proxy running on the same host, change the port line in
`docker-compose.yml` to `"127.0.0.1:${PORT:-3000}:3000"`.

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
- [docs/GDPR.md](docs/GDPR.md) - data protection: what the software does, what the organizer must do, handling requests, event shutdown
- [docs/LANGUAGES.md](docs/LANGUAGES.md) - offering the booking pages and emails in several languages (English, Finnish, Swedish, Norwegian, Danish, Icelandic, Estonian, Latvian, Lithuanian, Polish, German), editing translations

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

## Privacy and GDPR

The database contains personal data (names, emails, phone numbers, dietary requirements). The booking form shows a
privacy notice and requires confirmation; the full notice is generated from Event setup and served at `/privacy`.
The public participant list is opt-in. The admin panel can export or erase one person's data, warns when the retention
deadline (by default 30 days after the event) approaches, and has an Event shutdown tool that erases everything and
verifies it. See [docs/GDPR.md](docs/GDPR.md) for what the software covers and what you must still do as data controller.

Do not commit exports or database dumps; `.gitignore` excludes `.xlsx`, `.csv` and `.env`.
