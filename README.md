# Event booking system

A self-hosted booking system for small and mid-sized events with accommodation: rooms, camper vans, tents, single beds and
day visitors. It runs as a containerized **Node.js + PostgreSQL** app and is configured for your own event from the setup page
(name, organizer, dates, contact, logos, accent color).

Features: room / camper / tent / single-bed / day-visitor bookings, joining an existing room with a booking reference,
live availability, price calculation with admin-editable prices, confirmation and organizer emails, public
"Who's coming?" list, a setup page (event details, currencies, structure, room types, prices, translations) and a booking admin panel
(registration settings, editable bookings table, CSV export), and a
report & check-in tool (hotel list, check-in desk, summary, printable slips).

## Background

The first version of this system ran on the Google Apps Script platform. This is a rewrite in Node.js + PostgreSQL,
kept event-neutral so it can be used for any event.

## First-time event setup

1. Start the app (see below) and open `/?setup=1`, then log in with `SETUP_PASSWORD`.
2. The **Event setup** card at the top opens automatically on a fresh install. Fill in event name, organizer, location, dates,
   check-in/out times, contact email, logos and accent color, then press **Save event setup**.
3. Until this is saved, visitors only see a "booking is not open yet" page.
4. Then set prices and room inventory further down the setup page, and open registration in the booking admin (`/?admin=1`, `ADMIN_PASSWORD`).
5. Optional: choose the **native currency** (default EUR) and the languages in **Event setup**. Enter all prices in the native
   currency. Extra currencies for an approximate conversion and their exchange rates are set in the **Currencies** card
   (see [docs/CURRENCIES.md](docs/CURRENCIES.md)); translations are edited in the **Translations** card (see
   [docs/LANGUAGES.md](docs/LANGUAGES.md)).

Room types (id, description, persons per room, count, price) are defined in the **Room types** card of the setup page. On first start they are seeded from the defaults in `src/config.js`. The days of the event, optional extra nights and the meal package are defined in the **Event structure** card. The booking types (room, camper, tent, single bed, day visitor) are fixed.

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

Open http://localhost:3000 (booking page), `/?public=1` (Who's coming), `/?admin=1` (booking admin), `/?setup=1` (event setup) and `/report`
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
| `ADMIN_PASSWORD` | Booking admin (`/?admin=1`) and the report & check-in tool. For everyone who handles bookings; it cannot change the event setup |
| `SETUP_PASSWORD` | Event setup (`/?setup=1`): event details, prices, room types, translations, event shutdown. Also works in the booking admin. If unset, `ADMIN_PASSWORD` is used for both (single-password mode) |
| `SESSION_SECRET` | Signs admin session cookies (`openssl rand -hex 32`) |
| `POSTGRES_PASSWORD` | Database password (the data volume keeps the old one - see below) |
| `SMTP_PASS` | Mail server login |

While any default is still in use the app prints a warning at startup and shows a red banner in both the admin and setup pages.

Note: PostgreSQL only reads `POSTGRES_PASSWORD` when the data volume is first created. If you change it afterwards,
either remove the volume (`docker compose down -v`, **deletes data**) or change it inside the database with
`ALTER USER`.

## Documentation

- [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) - guide for event organizers (booking admin, event setup, report and check-in tool)
- [docs/DATABASE.md](docs/DATABASE.md) - tables, columns, constraints, settings keys, queries, backup
- [docs/GDPR.md](docs/GDPR.md) - data protection: what the software does, what the organizer must do, handling requests, event shutdown
- [docs/CURRENCIES.md](docs/CURRENCIES.md) - native currency, extra display currencies and exchange rates (manual or ECB)
- [docs/LANGUAGES.md](docs/LANGUAGES.md) - offering the booking pages and emails in several languages (English, Finnish, Swedish, Norwegian, Danish, Icelandic, Estonian, Latvian, Lithuanian, Polish, German), editing translations

## Configuration

All settings are in `.env` (see `.env.example`). `PUBLIC_URL` is used for join links in emails. Leave `SMTP_HOST`
empty to disable email (messages are then only logged to the console). Event data (dates, rooms, base prices) is in
`src/config.js`; prices, room counts, registration open/close, announcement, etc. are edited live in the setup page and the booking admin
and stored in the database.

To brand the pages for another event, edit `src/config.js` and the logo/links in `src/pages.js`.

## Development and tests

```bash
npm install
# needs a PostgreSQL; schema is applied automatically on start
DATABASE_URL=postgres://user:pass@localhost:5432/vushf ADMIN_PASSWORD=secret SESSION_SECRET=x node src/server.js
BASE_URL=http://localhost:3000 ADMIN_PASSWORD=secret SETUP_PASSWORD=other node tests/smoke.js   # creates TEST* bookings!
npm run test:unit        # currency unit tests, no database needed
npm run check-locales    # validates the translation files in src/locales/
```

Structure: `src/service.js` (booking logic), `src/pricing.js`, `src/settings.js`, `src/emails.js`, `src/pages.js` (HTML
pages), `src/report.js` + `src/reportRoutes.js` (report & check-in), `public/rpc-shim.js` (maps the
`rpc.run` calls used by the pages to `/api/rpc/<method>`), `src/i18n.js` + `src/locales/*.json`
(translations, see `src/locales/README.md`), `src/currency.js` (native currency, display currencies, exchange rates),
`scripts/locales.js` (translation check and CSV export/import), `db/schema.sql`.

## Privacy and GDPR

The database contains personal data (names, emails, phone numbers, dietary requirements). The booking form shows a
privacy notice and requires confirmation; the full notice is generated from Event setup and served at `/privacy`.
The public participant list is opt-in. The admin panel can export or erase one person's data, warns when the retention
deadline (by default 30 days after the event) approaches, and the setup page has an Event shutdown tool that erases everything and
verifies it. See [docs/GDPR.md](docs/GDPR.md) for what the software covers and what you must still do as data controller.

Do not commit exports or database dumps; `.gitignore` excludes `.xlsx`, `.csv` and `.env`.
