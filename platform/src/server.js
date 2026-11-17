'use strict';
const config = require('./config');
const db = require('./db');
const provisioner = require('./provisioner');
const lifecycle = require('./lifecycle');
const { build } = require('./app');

(async () => {
  for (const k of ['databaseUrl', 'operatorPassword', 'sessionSecret']) if (!config[k]) { console.error(`Missing setting: ${k}`); process.exit(1); }
  if (config.priceCents > 0 && !(config.stripeSecretKey && config.stripeWebhookSecret)) { console.error('EVENT_PRICE_CENTS > 0 needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET'); process.exit(1); }
  await db.init();
  const cloudflare = require('./cloudflare');
  const prov = provisioner.create({ runner: require('./runners/' + config.runner), tenantDb: require('./tenantDb'), cloudflare });
  lifecycle.start(prov);
  const app = build({ provisioner: prov, cloudflare });
  app.set('trust proxy', 1);
  app.listen(config.port, () => console.log('platform listening on', config.port));
})();
