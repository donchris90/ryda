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
    // Progressive-radius search bounds for the shared live-driver
    // candidate engine (see live-driver-index/ and, once built, the
    // candidate-search service). Defaults intentionally preserve the
    // existing DriversService.findNearby() 8km behavior so introducing
    // this config doesn't change production matching radius on its own.
    initialRadiusKm: parseFloat(process.env.DISPATCH_INITIAL_RADIUS_KM ?? '8'),
    maxRadiusKm: parseFloat(process.env.DISPATCH_MAX_RADIUS_KM ?? '15'),
    // How far each progressive-expansion round widens the search by.
    // Default of 4 reproduces the exact 0-8/8-12/12-15 rounds requested
    // as the migration-safe starting behavior, purely from the
    // initial/max/step combination rather than a hardcoded round list.
    radiusStepKm: parseFloat(process.env.DISPATCH_RADIUS_STEP_KM ?? '4'),
    // Max raw candidates pulled from the Redis GEO index per round,
    // before eligibility filtering. Bounds the PostgreSQL lookup in
    // CandidateSearchService.applyEligibility() to a small, fixed set —
    // never a full online-driver scan.
    candidateFetchLimit: parseInt(process.env.DISPATCH_CANDIDATE_LIMIT ?? '50', 10),
    // How many of the (already distance-sorted) eligible candidates get a
    // real routing-API call during ranking. Kept small on purpose — see
    // the cost requirement doc comment in DriverRankingService.rank().
    etaCandidateLimit: parseInt(process.env.DISPATCH_ETA_CANDIDATE_LIMIT ?? '8', 10),
    ranking: {
      // Weighted multi-factor score, not pure ETA - see
      // DriverRankingService.rank(). Each weight applies to a 0-1
      // "goodness" component (higher always better), summed into a
      // single score candidates are sorted by, descending. Defaults
      // keep ETA dominant since pickup speed is what a waiting
      // passenger actually feels most - these are reasonable starting
      // points, not a finalized business decision, and are worth
      // tuning against real acceptance/completion data once there's
      // enough of it to look at.
      etaWeight: parseFloat(process.env.DISPATCH_RANKING_ETA_WEIGHT ?? '0.6'),
      ratingWeight: parseFloat(process.env.DISPATCH_RANKING_RATING_WEIGHT ?? '0.2'),
      cancellationWeight: parseFloat(process.env.DISPATCH_RANKING_CANCELLATION_WEIGHT ?? '0.1'),
      acceptanceWeight: parseFloat(process.env.DISPATCH_RANKING_ACCEPTANCE_WEIGHT ?? '0.1'),
      // A driver's cancellation/acceptance rate isn't meaningful until
      // they have enough history behind it - one cancelled trip out of
      // one total is a 100% cancellation rate on paper, but says
      // nothing real yet. Below this many trips (cancellation) or
      // offers (acceptance), that factor defaults to neutral (1.0)
      // instead of penalizing a driver for a small, noisy sample -
      // the "do not unfairly discriminate against drivers" requirement
      // applies most sharply to brand-new drivers with little history.
      minTripsForCancellationSignal: parseInt(process.env.DISPATCH_RANKING_MIN_TRIPS ?? '5', 10),
      minOffersForAcceptanceSignal: parseInt(process.env.DISPATCH_RANKING_MIN_OFFERS ?? '5', 10),
    },
  },
  driverLocation: {
    // How old a driver's last GPS fix can be before the live-driver index
    // stops returning them as a dispatch candidate. Matches the value
    // DriversService.findNearby() already hardcodes (2 minutes), kept
    // here so the new index and the legacy Postgres scan agree until the
    // legacy path is retired.
    staleSeconds: parseInt(process.env.DRIVER_LOCATION_STALE_SECONDS ?? '120', 10),
  },
  safetyMonitoring: {
    // Below FraudService's IMPOSSIBLE_SPEED_KMH (250, which flags GPS
    // spoofing/corrupted data) but well above real, if dangerous,
    // driving - a genuinely different concern (unsafe driving vs. fake
    // GPS data), not a duplicate of the fraud check.
    excessiveSpeedKmh: parseFloat(process.env.SAFETY_EXCESSIVE_SPEED_KMH ?? '130'),
    // How stale a driver's GPS fix can get mid-trip before it's worth a
    // human glance - separate from (and shorter than) the dispatch
    // staleness threshold above, since a driver already on a trip with
    // a passenger matters more than one sitting idle between rides.
    gpsStaleSeconds: parseInt(process.env.SAFETY_GPS_STALE_SECONDS ?? '180', 10),
    // Deliberately generous multipliers, not tight bounds - a normal
    // traffic jam, a legitimate detour around a closed road, or simply
    // a slow driver shouldn't trip these. "Do not automatically accuse
    // users of wrongdoing" applies directly here: false positives cost
    // more than a late true positive.
    tripDurationAnomalyMultiplier: parseFloat(process.env.SAFETY_DURATION_MULTIPLIER ?? '2.5'),
    routeDeviationDistanceMultiplier: parseFloat(process.env.SAFETY_DISTANCE_MULTIPLIER ?? '1.8'),
    // How long a driver can sit within a small radius mid-trip before
    // it's worth a look - not immediately, since every trip has brief,
    // completely normal stops (a red light, dropping something off).
    unusualStopMinutes: parseInt(process.env.SAFETY_UNUSUAL_STOP_MINUTES ?? '8', 10),
    unusualStopRadiusMeters: parseFloat(process.env.SAFETY_UNUSUAL_STOP_RADIUS_M ?? '100'),
    // A ride completed faster than this after starting is worth a
    // glance - not proof of anything, since a genuinely very short
    // trip is entirely possible.
    minPlausibleTripSeconds: parseInt(process.env.SAFETY_MIN_TRIP_SECONDS ?? '60', 10),
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