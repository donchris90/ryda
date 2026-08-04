export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    name: process.env.DB_NAME ?? 'ryda',
    synchronize: (process.env.DB_SYNCHRONIZE ?? 'true') === 'true',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  otp: {
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '300', 10),
    length: parseInt(process.env.OTP_LENGTH ?? '6', 10),
  },
  pricing: {
    currency: process.env.DEFAULT_CURRENCY ?? 'NGN',
    baseFare: parseFloat(process.env.BASE_FARE ?? '500'),
    perKm: parseFloat(process.env.PER_KM_RATE ?? '120'),
    perMinute: parseFloat(process.env.PER_MINUTE_RATE ?? '25'),
    minimumFare: parseFloat(process.env.MINIMUM_FARE ?? '700'),
    bookingFee: parseFloat(process.env.BOOKING_FEE ?? '100'),
  },
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY ?? '',
    baseUrl: process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co',
    // Small charge (kobo) used to tokenize a card the first time a
    // passenger adds one, refunded immediately after verification.
    cardVerificationKobo: parseInt(process.env.PAYSTACK_CARD_VERIFY_KOBO ?? '5000', 10),
  },
  referral: {
    refereeBonus: parseFloat(process.env.REFERRAL_REFEREE_BONUS ?? '500'),
    referrerBonus: parseFloat(process.env.REFERRAL_REFERRER_BONUS ?? '500'),
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
    offerTimeoutSeconds: parseInt(process.env.DISPATCH_OFFER_TIMEOUT_SECONDS ?? '20', 10),
    offerRadiusKm: parseFloat(process.env.DISPATCH_OFFER_RADIUS_KM ?? '8'),
    expiryCheckIntervalMs: parseInt(process.env.DISPATCH_EXPIRY_CHECK_MS ?? '15000', 10),
    scheduledRideLeadMinutes: parseInt(process.env.SCHEDULED_RIDE_LEAD_MINUTES ?? '10', 10),
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
    localBaseUrl: process.env.STORAGE_LOCAL_BASE_URL ?? 'http://localhost:3000/api/v1/storage/files',
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
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  incentives: {
    defaultStreakReward: parseFloat(process.env.DEFAULT_STREAK_REWARD ?? '2000'),
  },
  observability: {
    sentryDsn: process.env.SENTRY_DSN ?? '',
    otelExporterUrl: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
    otelServiceName: process.env.OTEL_SERVICE_NAME ?? 'ryda-backend',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  },
});
