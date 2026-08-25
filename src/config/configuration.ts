import { resolveDatabaseConfig } from './resolve-db-config.util';

/**
 * Most hosts (Render, Railway, Upstash, Heroku-style add-ons) hand you a
 * single REDIS_URL rather than discrete host/port/password — supporting
 * both here, in one place, means every consumer (BullMQ setup, the
 * health check) benefits without needing its own parsing logic. Falls
 * back to the discrete REDIS_HOST/REDIS_PORT/REDIS_PASSWORD vars (the
 * original local-dev shape) when REDIS_URL isn't set.
 */
function resolveRedisConfig() {
  if (process.env.REDIS_URL) {
    try {
      const url = new URL(process.env.REDIS_URL);
      return {
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 6379,
        password: url.password || undefined,
      };
    } catch {
      // Falls through to the discrete vars below if REDIS_URL is malformed
      // rather than crashing config resolution over a typo.
    }
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Comma-separated list of browser origins allowed to call this API —
  // e.g. "https://admin.ryda.app,https://partner.ryda.app". Mobile apps
  // don't send a browser Origin header at all, so they're unaffected by
  // this either way; this only matters for admin/partner web dashboards.
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  database: {
    ...resolveDatabaseConfig(),
    // Off by default (local Postgres has no TLS listener) — most hosted
    // Postgres (Render, Heroku, Railway) requires it. Their certs
    // typically aren't in Node's default trust store, hence
    // rejectUnauthorized: false — the standard, widely-used pattern for
    // connecting to these hosts, not a real security loosening for a
    // connection that's already authenticated by username/password.
    ssl:
      (process.env.DB_SSL ?? 'false') === 'true'
        ? { rejectUnauthorized: false }
        : false,
    synchronize: (process.env.DB_SYNCHRONIZE ?? 'true') === 'true',
  },
  jwt: {
    accessSecret:
      process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  otp: {
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '300', 10),
    length: parseInt(process.env.OTP_LENGTH ?? '6', 10),
  },
  mail: {
    // Brevo's transactional email API, not Gmail SMTP - see
    // mailer.service.ts for why. `user` here is really "the verified
    // sender address", kept under this name since it was already set
    // as GMAIL_USER on Render and there's no reason to make anyone
    // rename an env var that already works.
    user: process.env.GMAIL_USER ?? '',
    brevoApiKey: process.env.BREVO_API_KEY ?? '',
    fromName: process.env.MAIL_FROM_NAME ?? 'Ryda',
    verificationTtlHours: parseInt(
      process.env.EMAIL_VERIFICATION_TTL_HOURS ?? '24',
      10,
    ),
    passwordResetTtlMinutes: parseInt(
      process.env.PASSWORD_RESET_TTL_MINUTES ?? '30',
      10,
    ),
    // The app deep link / web URL the verification and reset emails
    // point to - e.g. https://app.ryda.ng or a custom scheme like
    // ryda://verify-email. Left blank fails loudly rather than silently
    // sending broken links in production.
    appBaseUrl: process.env.APP_BASE_URL ?? '',
  },
  pricing: {
    currency: process.env.DEFAULT_CURRENCY ?? 'NGN',
    perKm: parseFloat(process.env.PER_KM_RATE ?? '120'),
    minimumFare: parseFloat(process.env.MINIMUM_FARE ?? '700'),
    bookingFee: parseFloat(process.env.BOOKING_FEE ?? '100'),
    // Tiered time-based fare (replaces the old flat baseFare + linear
    // perMinute rate as the primary time component): the first
    // `tierMinutes` of estimated trip duration cost `tierBaseFare` flat;
    // every additional block of `tierMinutes` (or part thereof) adds
    // `tierIncrementFare`. Distance (perKm above) is still added on top,
    // since a highway trip and a traffic-jam trip covering the same
    // duration shouldn't cost the same.
    tierMinutes: parseFloat(process.env.RIDE_TIER_MINUTES ?? '5'),
    tierBaseFare: parseFloat(process.env.RIDE_TIER_BASE_FARE ?? '1700'),
    tierIncrementFare: parseFloat(
      process.env.RIDE_TIER_INCREMENT_FARE ?? '700',
    ),
  },
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY ?? '',
    baseUrl: process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co',
    // Small charge (kobo) used to tokenize a card the first time a
    // passenger adds one, refunded immediately after verification.
    cardVerificationKobo: parseInt(
      process.env.PAYSTACK_CARD_VERIFY_KOBO ?? '5000',
      10,
    ),
  },
  referral: {
    refereeBonus: parseFloat(process.env.REFERRAL_REFEREE_BONUS ?? '500'),
    referrerBonus: parseFloat(process.env.REFERRAL_REFERRER_BONUS ?? '500'),
  },
  wallet: {
    minWithdrawalAmount: parseFloat(process.env.MIN_WITHDRAWAL_AMOUNT ?? '500'),
    minTopUpAmount: parseFloat(process.env.MIN_TOPUP_AMOUNT ?? '100'),
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    fromNumber: process.env.TWILIO_FROM_NUMBER ?? '',
    whatsappFromNumber: process.env.TWILIO_WHATSAPP_FROM ?? '', // e.g. whatsapp:+14155238886
  },
  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY ?? '',
    fromEmail: process.env.SENDGRID_FROM_EMAIL ?? 'no-reply@ryda.example',
  },
  fcm: {
    // Legacy HTTP server-key API — simplest to wire without OAuth. Migrate
    // to FCM HTTP v1 (OAuth2 service-account) before relying on this in
    // production; Google has deprecated the legacy endpoint.
    serverKey: process.env.FCM_SERVER_KEY ?? '',
  },
  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
  },
  pricingExtra: {
    nightStartHour: parseInt(process.env.NIGHT_START_HOUR ?? '22', 10),
    nightEndHour: parseInt(process.env.NIGHT_END_HOUR ?? '5', 10),
    nightMultiplier: parseFloat(process.env.NIGHT_MULTIPLIER ?? '1.15'),
    airportFee: parseFloat(process.env.AIRPORT_FEE ?? '1000'),
    freeWaitMinutes: parseInt(process.env.FREE_WAIT_MINUTES ?? '5', 10),
    perMinuteWaitRate: parseFloat(process.env.PER_MINUTE_WAIT_RATE ?? '30'),
    cancellationFee: parseFloat(process.env.CANCELLATION_FEE ?? '500'),
  },
  dispatch: {
    offerTimeoutSeconds: parseInt(
      process.env.DISPATCH_OFFER_TIMEOUT_SECONDS ?? '60',
      10,
    ),
    offerRadiusKm: parseFloat(process.env.DISPATCH_OFFER_RADIUS_KM ?? '8'),
    expiryCheckIntervalMs: parseInt(
      process.env.DISPATCH_EXPIRY_CHECK_MS ?? '15000',
      10,
    ),
    scheduledRideLeadMinutes: parseInt(
      process.env.SCHEDULED_RIDE_LEAD_MINUTES ?? '10',
      10,
    ),
  },
  logistics: {
    baseFare: parseFloat(process.env.LOGISTICS_BASE_FARE ?? '300'),
    perKm: parseFloat(process.env.LOGISTICS_PER_KM_RATE ?? '100'),
    perKg: parseFloat(process.env.LOGISTICS_PER_KG_RATE ?? '50'),
    minimumFare: parseFloat(process.env.LOGISTICS_MINIMUM_FARE ?? '500'),
  },
  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local', // 'local' | 's3' | 'r2'
    localUploadDir: process.env.STORAGE_LOCAL_DIR ?? 'uploads',
    localBaseUrl:
      process.env.STORAGE_LOCAL_BASE_URL ??
      'http://localhost:3000/api/v1/storage/files',
    s3Bucket: process.env.S3_BUCKET ?? '',
    s3Region: process.env.S3_REGION ?? 'us-east-1',
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    r2AccountId: process.env.R2_ACCOUNT_ID ?? '',
    r2Bucket: process.env.R2_BUCKET ?? '',
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
  search: {
    driver: process.env.SEARCH_DRIVER ?? 'postgres', // 'postgres' | 'opensearch'
    openSearchUrl: process.env.OPENSEARCH_URL ?? '',
    openSearchUsername: process.env.OPENSEARCH_USERNAME ?? '',
    openSearchPassword: process.env.OPENSEARCH_PASSWORD ?? '',
  },
  redis: resolveRedisConfig(),
  incentives: {
    defaultStreakReward: parseFloat(
      process.env.DEFAULT_STREAK_REWARD ?? '2000',
    ),
  },
  observability: {
    sentryDsn: process.env.SENTRY_DSN ?? '',
    otelExporterUrl: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
    otelServiceName: process.env.OTEL_SERVICE_NAME ?? 'ryda-backend',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  },
});