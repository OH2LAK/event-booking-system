# Project website (hamradio-events.com)

A static site, served by a Cloudflare Worker with static assets (no Worker code). The front page is
`public/index.html` (it includes the hosting order form, which posts to `platform.hamradio-events.com`; see `../platform/`),
`public/terms.html` and `public/privacy.html` are the legal pages (review them before launch), `public/_headers` sets security headers
(the CSP allows the form to call the platform). Content is in `public/`, the screenshots in `public/img/` are copies of `docs/screenshots/`.

## Deploy

On your own computer, with Node.js installed:

```bash
cd site
npx wrangler login        # once; opens the browser to sign in to Cloudflare
npx wrangler deploy       # uploads the site and attaches hamradio-events.com and www.hamradio-events.com
```

The domain must be in your Cloudflare account (it is). `wrangler deploy` creates the DNS records for the two custom
domains. Redeploy the same way after every change.

## Preview locally

```bash
cd site && npx wrangler dev        # http://localhost:8787
```

## Keeping the screenshots in sync

```bash
cp -r ../docs/screenshots/guest ../docs/screenshots/admin ../docs/screenshots/setup public/img/
```

If you change the demo passwords (`demo/.env.example`), change them in the "Demo addresses and passwords" box of
`public/index.html` too.

## Before launch

- Set up an `info@hamradio-events.com` address (Cloudflare Email Routing forwards it for free); it is named on the terms and privacy pages.
- Read `terms.html` and `privacy.html` and adjust them (operator name, price wording, VAT, retention); have them reviewed if the service will have paying customers.
- The order form only works once the platform is running at `platform.hamradio-events.com` (see `../platform/README.md`). Until then the form shows a connection error, so you can leave the Hosting section out of the first deploy.
