'use strict';
// All settings come from environment variables (see .env.example).
const env = process.env;
const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

module.exports = {
  port: int(env.PORT, 8080),
  databaseUrl: env.DATABASE_URL,
  baseDomain: env.BASE_DOMAIN || 'hamradio-events.com',
  publicUrl: env.PLATFORM_PUBLIC_URL || 'https://platform.hamradio-events.com',
  allowedOrigins: (env.ALLOWED_ORIGINS || 'https://hamradio-events.com,https://www.hamradio-events.com').split(',').map(s => s.trim()),
  operatorPassword: env.OPERATOR_PASSWORD,
  sessionSecret: env.SESSION_SECRET,
  operatorEmail: env.OPERATOR_EMAIL,           // gets "new order" notifications
  priceCents: int(env.EVENT_PRICE_CENTS, 0),   // set by the owner; 0 = free (no Stripe session is created)
  currency: (env.EVENT_CURRENCY || 'eur').toLowerCase(),
  productName: env.PRODUCT_NAME || 'Event booking system hosting',
  stripeSecretKey: env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
  stripeAutomaticTax: env.STRIPE_AUTOMATIC_TAX === '1',
  retentionDays: int(env.RETENTION_DAYS, 30),  // data is erased this long after the event ends
  warnDays: int(env.WARN_DAYS, 7),
  runner: env.RUNNER || 'docker',              // 'docker' | 'fake'
  image: env.APP_IMAGE || 'ghcr.io/oh2lak/event-booking-system:latest',
  dockerNetwork: env.DOCKER_NETWORK || 'ebs-net',
  tenantDbHost: env.TENANT_DB_HOST || 'ebs-postgres',
  pgAdminUrl: env.PG_ADMIN_URL,                // superuser URL of the shared Postgres (create/drop tenant DBs)
  smtp: {
    host: env.SMTP_HOST, port: int(env.SMTP_PORT, 587),
    user: env.SMTP_USER, pass: env.SMTP_PASS,
    from: env.SMTP_FROM || 'Hamradio Events <noreply@hamradio-events.com>'
  },
  tenantLimits: { memory: env.TENANT_MEMORY || '256m', cpus: env.TENANT_CPUS || '0.5', pids: int(env.TENANT_PIDS, 200) }
};
