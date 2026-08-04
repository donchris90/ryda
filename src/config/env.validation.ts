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
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
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

const INSECURE_DEFAULTS = ['dev-access-secret-change-me', 'dev-refresh-secret-change-me'];

/**
 * The one check that's actually worth hard-failing on: booting in
 * production with the placeholder JWT secrets literally checked into
 * `configuration.ts`'s defaults. This is narrow and specific — it doesn't
 * touch any of the optional-integration env vars — precisely so it can't
 * accidentally block a legitimate deployment the way a broad `.required()`
 * schema would.
 */
export function assertProductionSecretsAreSet(nodeEnv: string, accessSecret: string, refreshSecret: string): void {
  if (nodeEnv !== 'production') return;

  if (INSECURE_DEFAULTS.includes(accessSecret) || INSECURE_DEFAULTS.includes(refreshSecret)) {
    throw new Error(
      'Refusing to start with NODE_ENV=production while JWT_ACCESS_SECRET/JWT_REFRESH_SECRET ' +
        'are still set to their insecure development defaults. Set real secrets via env vars.',
    );
  }
}
