# Public demo (hamradio-events.com)

A sandbox that anyone can open and try to break, running on your own server and published through a Cloudflare Tunnel.
The visitors get the guest pages, the booking admin and the event setup with the passwords shown in the banner at the
top of every page.

## What demo mode does

Demo mode is switched on with `DEMO_MODE=1` (the compose file in this folder does it). The code is in `src/demo.js`.

- **Banner:** every page says it is a demo and shows the admin and setup passwords (public by design).
- **Automatic reset:** the database is emptied and the fictional "Example Radio Meeting 2027" is created again
  - every night at `DEMO_RESET_HOUR` (default 03:00 in `TZ`),
  - when something has been changed and nobody has used the demo for `DEMO_IDLE_MINUTES` (default 30),
  - and at the latest `DEMO_MAX_DIRTY_HOURS` (default 6) after the first change, so a visitor who keeps clicking cannot
    leave it broken for long.
  - The app also seeds itself on the first start, so an empty database is fine.
- **Abuse limits:** at most `DEMO_MAX_BOOKINGS` bookings (default 200), at most 120 changes per minute from one address,
  no search-engine indexing (`X-Robots-Tag`), and a Content Security Policy that blocks images, scripts and fonts from
  other sites (so a logo URL typed into the setup page cannot be used for tracking).
- **No email:** `SMTP_HOST` is empty, messages are only written to the log.
- **Fictional data only:** the banner asks visitors not to enter real names or addresses. The nightly reset is the
  safety net.

## Set it up

1. **Tunnel.** In the Cloudflare dashboard open Zero Trust, Networks, Tunnels, create a tunnel of the type
   "Cloudflared" and copy its token. (The menu names change from time to time. Look for Tunnels under Zero Trust.)
2. **Public hostname.** In the tunnel, add a public hostname `demo.hamradio-events.com` with the service
   `HTTP` and the URL `app:3000`. Cloudflare creates the DNS record by itself.
3. **Configuration.** On the server:

   ```bash
   git clone https://github.com/OH2LAK/event-booking-system.git
   cd event-booking-system/demo
   cp .env.example .env      # set the two random secrets and paste the tunnel token
   docker compose up -d --build
   ```

4. **Check.** `curl -I http://127.0.0.1:3000/healthz` on the server answers `200`, and
   https://demo.hamradio-events.com shows the demo with the yellow banner.

## Recommended: a rate-limit rule in Cloudflare

The app limits writes per address, but Cloudflare can stop floods before they reach your server. In the dashboard for the
domain open Security, WAF, Rate limiting rules and add a rule for the host `demo.hamradio-events.com` that blocks an
address for a minute after about 100 requests per 10 seconds.

## Update or reset by hand

```bash
cd event-booking-system && git pull
cd demo && docker compose up -d --build     # new version, demo data rebuilt
docker compose restart app                  # just reset the demo
docker compose logs -f app                  # "[demo] reset done" lines show the resets
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `DEMO_RESET_HOUR` | `3` | Nightly reset hour (0-23, in `TZ`) |
| `DEMO_IDLE_MINUTES` | `30` | Reset after this many idle minutes when something was changed |
| `DEMO_MAX_DIRTY_HOURS` | `6` | Reset at the latest this long after the first change |
| `DEMO_MAX_BOOKINGS` | `200` | Stop accepting bookings above this number |

The passwords (`ADMIN_PASSWORD`, `SETUP_PASSWORD`) are shown to everyone. If you change them, change them on the website
too (`site/public/index.html`).

## Security notes

- The demo database is separate and holds no real data. Keep it that way: do not point demo mode at a real event.
- `POSTGRES_PASSWORD`, `SESSION_SECRET` and `TUNNEL_TOKEN` stay secret. `.env` is not committed.
- Anything visitors type is public to other visitors until the next reset. That is why the banner asks for fictional data.
