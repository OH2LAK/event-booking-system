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
5. The organiser gets the address and the generated setup/admin passwords by email.
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

## Security notes

- The control plane runs on the host, not in a container, so the Docker socket is never exposed to it.
  Whoever controls it controls Docker: keep the operator password long, and protect `platform.` with Cloudflare Access if you like.
- Tenant containers run with `--cap-drop ALL`, `no-new-privileges`, read-only root filesystem, memory/CPU/PID limits,
  and a database role that can only reach its own database (10 connections).
- Traefik reads the Docker socket read-only; only the tunnel can reach it (bound to localhost).
- Tenant passwords are random per instance and shown only in the email to the organiser.

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
The real Docker runner, real Stripe and Terraform have **not** been exercised against live services yet.
