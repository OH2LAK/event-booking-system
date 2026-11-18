# Hosting platform (control plane)

Lets you host the event booking system for other organisers for a small fee. Each paid event gets its **own
isolated instance**: its own container, its own database and role, its own address `<name>.hamradio-events.com`.
The app itself stays single-event; this folder only adds ordering, payment and automation around it.

## Flow

1. Organiser fills in the order form on the website (including the event type, overnight or one-day) → `POST /api/order` (honeypot, per-IP limit, name validation). The event type is passed to the new instance as `EVENT_MODE`.
2. You get an email and review it in the operator page (`/operator`): **Approve** (set the price) or **Reject**.
3. Approve creates a Stripe Checkout Session and emails the payment link (price 0 skips payment).
4. Stripe calls `/stripe/webhook` (signature verified, replays ignored) → the instance is provisioned:
   database + role, one-shot `init-event.js` container, app container with Traefik labels and resource limits.
5. The organiser gets the address and a one-time first-time setup code by email. They create their own account (the email address of the order) and set up two-factor authentication; there are no shared admin passwords.
6. Hourly job: warns before erasure, suspends after the event, erases database and container
   `RETENTION_DAYS` (default 30) after the event end.

## Pieces

| Path | What |
|---|---|
| `src/app.js` | Public order API, Stripe webhook, operator UI |
| `src/provisioner.js`, `src/tenantDb.js`, `src/runners/` | Create / suspend / resume / erase instances (Docker CLI via `execFile`) |
| `src/lifecycle.js` | Warning, suspension, erasure |
| `src/stripe.js` | Checkout Session over REST + webhook signature check |
| `deploy/` | docker-compose for Postgres + Traefik + cloudflared, systemd unit |
| `../infra/` | Terraform: Hetzner VPS, firewall, Cloudflare Tunnel, DNS |
| `tests/run.js` | Integration test (real Postgres, fake Docker, fake Stripe) |

## Setting it up

1. `infra/` → `terraform apply` (see `infra/README.md`), or any VPS with Docker + Node 22.
2. Publish the image: push to `main`; `.github/workflows/docker.yml` builds `ghcr.io/oh2lak/event-booking-system`.
   If the package is private, `docker login ghcr.io` on the server.
3. On the server: edit `/opt/ebs/host.env`, then `docker compose -f deploy/docker-compose.yml --env-file /opt/ebs/host.env up -d`.
4. Create the platform database: `docker exec -it ebs-host-ebs-postgres-1 psql -U postgres -c "CREATE DATABASE platform"`.
5. Copy `.env.example` to `/etc/ebs-platform.env` (mode 600), fill in, `cd platform && npm ci --omit=dev`,
   `systemctl enable --now ebs-platform`.
6. Stripe: create a webhook endpoint `https://platform.hamradio-events.com/stripe/webhook` for
   `checkout.session.completed`; put the signing secret and your secret key in the env file.
   Test with Stripe test keys first.
7. Test end to end with `RUNNER=fake` and price 0, then with a real order.

Price: set `EVENT_PRICE_CENTS` (default shown in the operator page; you can override it per order when approving).
Set `STRIPE_AUTOMATIC_TAX=1` only after configuring Stripe Tax.

## API

Every instance contains the public API ([../docs/API.md](../docs/API.md)). It is **off** when an event is created (`API_ENABLED: 'no'` is passed to `init-event`); the organiser switches it on in Event setup and creates keys there. Nothing in the platform needs to change for it: requests go to the event's own address like any other page.

## Own domains (Cloudflare for SaaS)

An organiser can order their own subdomain (for example `ilmo.myclub.fi`) for an extra fee. How it works:

1. The order form has an optional domain field. The platform accepts a domain only when `CF_API_TOKEN` and `CF_ZONE_ID` are set,
   and only subdomains (three or more labels; a CNAME cannot be set on a bare domain) outside `hamradio-events.com`.
2. When you approve the order, the domain fee (`CUSTOM_DOMAIN_FEE_CENTS`, or what you type in the operator page) is added to the hosting fee
   and shown as its own line in Stripe Checkout.
3. After payment the instance is created as usual and answers at `<slug>.hamradio-events.com` and at the own domain. Its public URL
   (join links in emails) is the own domain. The platform creates a **custom hostname** with the Cloudflare API and emails the organiser the
   DNS record to add: `CNAME <domain> → custom.hamradio-events.com` (plus an ownership TXT record if validation is slow).
4. Every 10 minutes the platform checks pending hostnames. When the hostname and its certificate are active, the organiser gets an email.
   The operator page shows the state (`pending`, `active`, `failed`) with buttons **Check domain** and **Retry domain**.
5. When the instance is erased, the custom hostname is deleted too (it counts against the Cloudflare quota until deleted).
   If that call fails you get an email to remove it by hand.

One-time setup:

1. Cloudflare dashboard → the `hamradio-events.com` zone → SSL/TLS → **Custom Hostnames**: enable Cloudflare for SaaS.
   `infra/` creates the proxied `custom` DNS record and the fallback origin; without Terraform, create a proxied CNAME `custom` → `<tunnel-id>.cfargotunnel.com`
   and set it as the fallback origin on that page.
2. The tunnel's last ingress rule must send unknown host names to Traefik (`http://localhost:8081`), not to a 404. `infra/` does this; with the tunnel
   managed in the dashboard, change the catch-all rule there.
3. Create an API token: Zone → SSL and Certificates: Edit, restricted to the `hamradio-events.com` zone. Put it in `CF_API_TOKEN`, the zone ID in `CF_ZONE_ID`.
4. Test with your own spare domain before selling it.

Cost: Cloudflare lists 100 custom hostnames as included on the Free, Pro and Business plans and $0.10 per extra hostname per month; check the current
terms in the Cloudflare docs. Limits: subdomains only; the customer needs a DNS provider that lets them add a CNAME. If the customer's DNS is on Cloudflare,
the record should be "DNS only".

**Not verified against live Cloudflare.** The code follows the Cloudflare for SaaS API documentation and is tested with a stubbed API only. Do the first
real hostname by hand to confirm the validation method (`http`) and the tunnel route work together.

## Security notes

- The control plane runs on the host, not in a container, so the Docker socket is never exposed to it.
  Whoever controls it controls Docker: keep the operator password long, and protect `platform.` with Cloudflare Access if you like.
- Tenant containers run with `--cap-drop ALL`, `no-new-privileges`, read-only root filesystem, memory/CPU/PID limits,
  and a database role that can only reach its own database (10 connections).
- Traefik reads the Docker socket read-only; only the tunnel can reach it (bound to localhost).
- The first-time setup code is random per instance and shown only in the email to the organiser; it only creates the first account.

## Data protection (checklist, not legal advice)

Hosting other organisers' attendee data makes you a **processor** (they are the controllers). You will need:
a data processing agreement, terms of service (what is promised, what happens at expiry), a privacy notice for
the order form, a backup and retention policy (this platform erases data automatically 30 days after the event by default),
and correct VAT handling on the fee. Have these reviewed by someone qualified.

## Not built yet

SumUp payments, guest payments (organiser's own Stripe via Connect), SMS with an alphanumeric sender,
automatic backups of tenant databases, upgrading running instances to a new image (recreate the container; data persists).

## Testing

`npm test` needs a Postgres: set `DATABASE_URL` to a throwaway database, or install `embedded-postgres` next to it.
The real Docker runner, real Stripe, real Cloudflare for SaaS and Terraform have **not** been exercised against live services yet.
