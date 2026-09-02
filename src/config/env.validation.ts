import * as Joi from 'joi';

/**
 * Deliberately does NOT make anything `.required()` — nearly every env var
 * in this project has a working default in `configuration.ts` (including
 * DB_HOST, DB_USERNAME, JWT secrets, etc.), and every external integration
 * (Paystack, Maps, Twilio, Sentry, S3...) has a tested simulated/disabled
 * fallback when unconfigured. A hard requirement here would silently
 * contradict that pattern and break local dev / CI the moment someone
 * forgets to set an env var that was always meant to be optional.
 *
 * What this DOES catch: type/format mistakes — a non-numeric PORT, an
 * invalid NODE_ENV value, a malformed DB_PORT — the kind of typo that
 * would otherwise fail confusingly deep inside a library rather than with
 * a clear message at boot.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),

  DB_HOST: Joi.string().optional(),
  DB_PORT: Joi.number().optional(),
  DB_USERNAME: Joi.string().optional(),
  DB_PASSWORD: Joi.string().optional(),
  DB_NAME: Joi.string().optional(),
  DB_SYNCHRONIZE: Joi.string().valid('true', 'false').optional(),

  JWT_ACCESS_SECRET: Joi.string().optional(),
  JWT_REFRESH_SECRET: Joi.string().optional(),

  REDIS_HOST: Joi.string().optional(),
  REDIS_PORT: Joi.number().optional(),
  REDIS_URL: Joi.string().optional(),
}).unknown(true); // this project reads many more env vars directly via ConfigService — don't reject those

const INSECURE_DEFAULTS = [
  'dev-access-secret-change-me',
  'dev-refresh-secret-change-me',
];

/**
 * The one check that's actually worth hard-failing on: booting in
 * production with the placeholder JWT secrets literally checked into
 * `configuration.ts`'s defaults. This is narrow and specific — it doesn't
 * touch any of the optional-integration env vars — precisely so it can't
 * accidentally block a legitimate deployment the way a broad `.required()`
 * schema would.
 */
export function assertProductionSecretsAreSet(
  nodeEnv: string,
  accessSecret: string,
  refreshSecret: string,
): void {
  if (nodeEnv !== 'production') return;

  if (
    INSECURE_DEFAULTS.includes(accessSecret) ||
    INSECURE_DEFAULTS.includes(refreshSecret)
  ) {
    throw new Error(
      'Refusing to start with NODE_ENV=production while JWT_ACCESS_SECRET/JWT_REFRESH_SECRET ' +
        'are still set to their insecure development defaults. Set real secrets via env vars.',
    );
  }
}

/**
 * Local disk storage means driver documents, chat attachments, etc. live
 * on the container's own (usually ephemeral, single-instance) filesystem —
 * fine for local dev, a real problem in production: files vanish on
 * redeploy, and there's nothing to genuinely protect them beyond
 * whatever the app itself enforces. If `STORAGE_DRIVER` is set to `s3`
 * or `r2` but the required credentials for that driver aren't actually
 * present, `StorageService` would silently fall back to local disk
 * instead of failing loudly — refuse to boot in that situation instead.
 */
export function assertProductionStorageIsConfigured(
  nodeEnv: string,
  driver: string,
  s3Configured: boolean,
  r2Configured: boolean,
): void {
  if (nodeEnv !== 'production') return;

  if (driver === 'local') {
    throw new Error(
      'Refusing to start with NODE_ENV=production while STORAGE_DRIVER=local. ' +
        'Set STORAGE_DRIVER=s3 or STORAGE_DRIVER=r2 with real credentials — local disk storage ' +
        "doesn't survive a redeploy and isn't an acceptable place to keep driver documents in production.",
    );
  }
  if (driver === 's3' && !s3Configured) {
    throw new Error(
      'Refusing to start with NODE_ENV=production while STORAGE_DRIVER=s3 but S3 credentials ' +
        '(S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY) are not fully set — StorageService would ' +
        'otherwise silently fall back to local disk.',
    );
  }
  if (driver === 'r2' && !r2Configured) {
    throw new Error(
      'Refusing to start with NODE_ENV=production while STORAGE_DRIVER=r2 but R2 credentials ' +
        '(R2_ACCOUNT_ID/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY) are not fully set — ' +
        'StorageService would otherwise silently fall back to local disk.',
    );
  }
}

/**
 * PaymentsService.chargeSavedCard()/initBankTransfer() both fall back
 * to a clearly-flagged "simulated" success (PaymentStatus.SUCCESS,
 * simulated: true) when Paystack isn't configured - genuinely useful
 * for local dev/CI (see PaymentsService's own doc comments), but a
 * real, serious hole if that fallback were ever live in production:
 * every card/bank-transfer ride payment would silently "succeed"
 * with no money ever actually moving. Same "refuse to boot" pattern
 * as the JWT-secret/storage checks above.
 */
export function assertProductionPaymentsAreConfigured(
  nodeEnv: string,
  paystackConfigured: boolean,
): void {
  if (nodeEnv !== 'production') return;

  if (!paystackConfigured) {
    throw new Error(
      'Refusing to start with NODE_ENV=production while Paystack is not configured ' +
        '(PAYSTACK_SECRET_KEY not set). PaymentsService falls back to simulated/fake payment ' +
        'success when Paystack is unconfigured — acceptable in dev/CI, never in production, ' +
        'where it would mean real rides "succeed" payment with no money ever moving. Set a real ' +
        'PAYSTACK_SECRET_KEY.',
    );
  }
}