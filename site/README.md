# Project website (hamradio-events.com)

A static one-page site, served by a Cloudflare Worker with static assets (no Worker code). Content is in
`public/index.html`, the screenshots in `public/img/` are copies of `docs/screenshots/`.

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
