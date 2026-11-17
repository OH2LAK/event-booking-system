# Taking screenshots for documentation

1. Start the app with an **empty** database and passwords you know (`ADMIN_PASSWORD`, `SETUP_PASSWORD`).
2. Fill it with a fictional event: `npm run seed-demo` (Docker: `docker compose exec app npm run seed-demo`).
   Everything is fake: event "Example Radio Meeting 2027", callsigns `DEMO01`..`DEMO11`, `example.com` emails; no email is sent.
3. Open the screens below and capture them (browser width about 1200 px).

| Screen | URL | Notes |
|---|---|---|
| Booking form | `/` | Show a room selection with prices |
| Availability / price summary | `/` | Choose a room, tick full board |
| Public guest list | `/?public=1` | Only guests who allow publishing appear |
| Admin login | `/?admin=1` | Before logging in |
| Event setup, Currencies, Event structure and Room types cards | `/?setup=1` | Expand each card, after login with `SETUP_PASSWORD` |
| Pricing and room inventory | `/?setup=1` | Scroll down the setup page |
| Dashboard and registration settings | `/?admin=1` | Scroll through the panel |
| Bookings table | `/?admin=1` | Includes a cancelled and a checked-in row |
| Report: hotel list, check-in desk, summary | `/report` | Log in via the admin session |
| Printable slip | `/report` | Open a slip from the check-in view |

Do not capture real attendee data; use only the demo database.
