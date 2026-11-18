# Event booking system

**Registration and accommodation booking for events, on your own server.** Guests book a room, a camper van spot, a tent
or a day pass, see live availability and get a priced confirmation by email. Organizers run everything from a browser:
no spreadsheets, no code, no third-party service.

![Booking form](docs/screenshots/guest/booking-form.png)

Built for club weekends, conferences, camps, retreats and meetups: anything where people sign up, stay somewhere and pay a
fee. One Docker command starts it, and the whole event (name, dates, rooms, prices, languages, branding) is set up in a
web page.

## Why you might want it

- **Accommodation is the hard part, and it is solved.** Rooms of different sizes, people joining an existing room with a
  booking reference, camper vans, tents, single beds and day visitors, with availability that updates as people book.
- **Prices calculate themselves.** Room price, extra nights, meal package and meeting fee add up to a total that is shown
  before booking, written into the confirmation email and kept in the booking.
- **It speaks your guests' language.** 20 languages are built in and guests switch with one click. The currency is yours
  too, and guests can see an approximate price in theirs.
- **Day-of-event tools are included.** A hotel list for the venue, a check-in desk and printable slips, so the event runs
  from the same data as the registration.
- **Privacy is built in rather than bolted on.** Consent at booking, an opt-in public guest list, per-person export and
  erasure, retention reminders and a verified "erase everything" button for after the event.
- **You own it.** Your server, your database, your data. Three runtime dependencies (Express, PostgreSQL driver,
  Nodemailer), no build step, no CDNs, trackers or analytics.

## Features

| | |
|---|---|
| **Event profiles and modules** | Switches in Event setup turn rooms, camping, day attendance and vendor spaces on or off. Profiles (overnight event, one-day event, hamfest/fair) are only presets, so hybrid events work. |
| **Vendor spaces** | Flea market tables, trunk sales, sales and demo booths or your own space types, with price, day and times, size, power and location, a question to the booker and capacity. Vendors can register without accommodation (one contact person plus a list of names for entry tickets) or add a space to a normal booking. |
| **Optional extras** | A free list of extras (dinner, excursion, workshop ...) with price, optional capacity, sign-up deadline and maximum per booking. Guests tick what they want when registering; the price is added to the total and the organizer sees totals per extra. |
| **Payments** | Prices and a "how to pay" text (for example "pay at the door") are shown to guests; the organizer marks bookings paid in the booking list. Online payment (Stripe/SumUp) is not built in yet. |
| **Booking types** | Rooms (any sizes you define), camper van spots, tent spots, organizer-assigned single beds, day visitors who pick their days. Join an existing booking with its reference. Optional solo use of a double room. |
| **Event structure** | Event days, optional extra nights ("Thursday night"), rooms booked for the whole event or per night, optional meal package. All defined in the browser. |
| **Pricing** | Per room type, camper van per night, tent, single bed, meal package and meeting fee (full event or single day). Totals and breakdown are stored with each booking. |
| **Currencies** | One native currency for all payments, plus optional display currencies with approximate conversion. Exchange rates entered by hand or fetched from the European Central Bank. |
| **Languages** | English, Finnish, Swedish, Norwegian, Danish, Icelandic, Estonian, Latvian, Lithuanian, Polish, German, Spanish, Portuguese, Italian, French, Dutch, Greek, Ukrainian, Czech and Hungarian. Translations are plain JSON files, easy to improve on GitHub, and event texts can be translated in the browser. |
| **Emails** | Booking confirmation to the guest and a notification to the organizer, plus updates when a booking or its accommodation changes. Optional: without SMTP, messages are only logged. |
| **Registration control** | Open and close manually or by date, announcement banner, closed message, and a secret bypass link for late registrants. |
| **Booking admin** | Live dashboard, sortable bookings table, edit any booking, change accommodation with the price difference calculated, CSV export. Its own password for the whole registration team. |
| **Event setup** | Event details, branding, structure, room types, prices, currencies and translations, kept apart from the booking admin with a separate password so a helper cannot break the event. |
| **Report and check-in** | Hotel list, check-in desk, summary and printable slips for use at the venue. |
| **Public guest list** | An opt-in "Who's coming?" page showing callsign, first name and the kind of stay, only for guests who agreed. |
| **API and webhooks** | A REST API with named, revocable API keys (counts only, read bookings, or create/change/cancel bookings), CSV/JSON exports, and signed webhooks when bookings change, so other systems (accounting, a club register, a web shop) can be connected. Off until the organizer switches it on. OpenAPI description included. |
| **Data protection** | Generated privacy notice, consent checkbox, per-person data export and erasure, retention deadline with warnings, and an event shutdown that erases all personal data and verifies the result. |

## Screenshots

Booking form for guests, booking admin for the registration team and event setup for the organizer (full tour with
descriptions: [docs/screenshots](docs/screenshots/README.md)).

| Who's coming? | Booking admin | Event setup |
|---|---|---|
| [![Who's coming](docs/screenshots/guest/whos-coming.png)](docs/screenshots/README.md#whos-coming-public1) | [![Booking admin](docs/screenshots/admin/bookings-table.png)](docs/screenshots/README.md#bookings-table) | [![Event setup](docs/screenshots/setup/pricing.png)](docs/screenshots/README.md#pricing-and-room-inventory) |

## Try it in five minutes

You need Docker. Everything below is fictional demo data.

```bash
git clone https://github.com/OH2LAK/event-booking-system.git
cd event-booking-system
cp .env.example .env            # the passwords in it are placeholders, fine for a local try-out
docker compose up --build -d
docker compose exec app npm run seed-demo
```

Then open http://localhost:3000 (what guests see), http://localhost:3000/?admin=1 (booking admin) and
http://localhost:3000/?setup=1 (event setup). The passwords are in `.env`, and the data lives in the `pgdata` Docker volume. To start your own event instead of the demo,
skip the last command and fill in the event details on the setup page. Before putting it on the internet, read
[Change the default passwords](#change-the-default-passwords) and [Making it reachable from the network](#making-it-reachable-from-the-network).

## Live demo and website

A public sandbox runs at https://demo.hamradio-events.com and the project website is at https://hamradio-events.com.
Visitors can book, change prices or delete the whole event: the demo rebuilds itself every night and after a quiet period.
The code for both is in this repository: `DEMO_MODE=1` ([demo/](demo/README.md), `src/demo.js`) and the static website
([site/](site/README.md)).

## How it fits together

| Part | Address | For | Sign-in |
|---|---|---|---|
| Guest pages | `/`, `/?public=1` | Participants | none |
| Booking admin | `/?admin=1` | Everyone who handles bookings | admin account + 2FA |
| Event setup | `/?setup=1` | The one or two people who configure the event | setup account + 2FA |
| Report and check-in | `/report` | The team at the venue | admin account + 2FA |

Every admin has a named account with a password and a required second factor (authenticator app, passkey or email code), roles, invitations and an audit log. See the [admin guide](docs/ADMIN-GUIDE.md#1-signing-in-and-two-factor-authentication).

Node.js 22, Express and PostgreSQL, started with Docker Compose. Settings live in `.env`, event data in the database.

## First-time event setup

1. Start the app (see below) and open `/?setup=1`. On a fresh install enter the setup code (`SETUP_PASSWORD` from `.env`, or the code printed in `docker compose logs app` when you kept the placeholder) and create the first account, then set up two-factor authentication and save your recovery codes.
2. The **Event setup** card at the top opens automatically on a fresh install. Fill in event name, organizer, location, dates,
   check-in/out times, contact email, logos and accent color, then press **Save event setup**.
3. Until this is saved, visitors only see a "booking is not open yet" page.
4. Then set prices and room inventory further down the setup page, and open registration in the booking admin (`/?admin=1`). Invite your team from "Admin users" on the setup page.
5. Optional: choose the **native currency** (default EUR) and the languages in **Event setup**. Enter all prices in the native
   currency. Extra currencies for an approximate conversion and their exchange rates are set in the **Currencies** card
   (see [docs/CURRENCIES.md](docs/CURRENCIES.md)); translations are edited in the **Translations** card (see
   [docs/LANGUAGES.md](docs/LANGUAGES.md)).

Room types (id, description, persons per room, count, price) are defined in the **Room types** card of the setup page. On first start they are seeded from the defaults in `src/config.js`. The days of the event, optional extra nights and the meal package are defined in the **Event structure** card. The booking types (room, camper, tent, single bed, day visitor) are fixed.

## Demo data and screenshots

To get a fictional event with fake bookings (for documentation screenshots or trying things out) on an **empty** database, also without Docker:

```bash
npm run seed-demo        # needs DATABASE_URL; refuses to run on a non-empty database without --force
```

See `docs/SCREENSHOTS.md` for the list of screens to capture.

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
| `SETUP_PASSWORD` | The **first-time setup code**: lets you create the first Event setup account on a fresh system, nothing else. After that, people sign in with their own accounts (password + 2FA). If it is empty or still a `change-me-...` placeholder, the app generates a random code at startup and prints it in the log (`docker compose logs app`), so the default `.env` is never a way in |
| `OWNER_EMAIL` | Optional: fixes the email address of the first account (used by the hosting service) |
| `SESSION_SECRET` | Key for encrypting the authenticator-app secrets (`openssl rand -hex 32`). Changing it later makes registered authenticator apps unusable: reset 2FA afterwards |
| `POSTGRES_PASSWORD` | Database password (the data volume keeps the old one - see below) |
| `SMTP_PASS` | Mail server login |

While any default is still in use the app prints a warning at startup and shows a red banner in both the admin and setup pages.

Note: PostgreSQL only reads `POSTGRES_PASSWORD` when the data volume is first created. If you change it afterwards,
either remove the volume (`docker compose down -v`, **deletes data**) or change it inside the database with
`ALTER USER`.

## Documentation

- [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) - guide for event organizers (booking admin, event setup, report and check-in tool)
- [docs/DATABASE.md](docs/DATABASE.md) - tables, columns, constraints, settings keys, queries, backup
- [docs/API.md](docs/API.md) - API and webhooks for connecting other systems (curl examples, signature verification); [docs/openapi.json](docs/openapi.json) is the OpenAPI description
- [docs/GDPR.md](docs/GDPR.md) - data protection: what the software does, what the organizer must do, handling requests, event shutdown
- [docs/CURRENCIES.md](docs/CURRENCIES.md) - native currency, extra display currencies and exchange rates (manual or ECB)
- [docs/LANGUAGES.md](docs/LANGUAGES.md) - offering the booking pages and emails in several languages (English, Finnish, Swedish, Norwegian, Danish, Icelandic, Estonian, Latvian, Lithuanian, Polish, German, Spanish, Portuguese, Italian, French, Dutch, Greek, Ukrainian, Czech, Hungarian), editing translations

## Configuration

Server settings (passwords, database, SMTP, `PUBLIC_URL`) are in `.env` (see `.env.example`). `PUBLIC_URL` is used for join
links in emails. Leave `SMTP_HOST` empty to disable email (messages are then only logged to the console).

**SMS (optional).** Set `SMS_GATEWAY_URL`, `SMS_API_TOKEN` and `SMS_SENDER_ID` to send a short confirmation SMS (booking reference) to guests who entered a phone number. The sender ID is the alphanumeric name shown to the recipient: at most 11 letters/digits and approved by your SMS provider. The request format is that of the Setera HTTP gateway (`token` header, JSON body); other gateways need a small change in `src/sms.js`. Numbers need a country prefix (`+`, `00` or a leading `0`, which gets `SMS_DEFAULT_COUNTRY_CODE`). `SMS_MAX_PER_INSTANCE` caps the number of messages. SMS is always off in demo mode. The hamradio-events.com hosting uses the sender `HamEvents`. Check that your terms and privacy notice mention SMS before enabling it.

Everything about the event itself is edited in the browser and stored in the database: event details and branding
(logos, accent colour) in **Event setup**, and prices, room counts, registration open/close and announcements on the setup
page and in the booking admin. `src/config.js` only holds the defaults used on the first start.

## Development and tests

```bash
npm install
# needs a PostgreSQL; schema is applied automatically on start
DATABASE_URL=postgres://user:pass@localhost:5432/vushf SETUP_PASSWORD=a-real-secret SESSION_SECRET=x node src/server.js
BASE_URL=http://localhost:3000 SETUP_PASSWORD=a-real-secret node tests/smoke.js   # fresh database; creates test admin accounts and TEST* bookings!
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

## Background

The first version of this system ran on the Google Apps Script platform. This is a rewrite in Node.js + PostgreSQL,
kept event-neutral so it can be used for any event.
