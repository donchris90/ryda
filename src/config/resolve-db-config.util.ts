/**
 * Most hosts (Render, Railway, Heroku-style add-ons, Supabase, Neon) hand
 * you a single DATABASE_URL rather than discrete host/port/user/password —
 * supporting both here, in one shared place, means the running app's
 * config (configuration.ts) and the standalone migration CLI
 * (data-source.ts) stay in sync rather than each parsing it separately.
 * Falls back to the discrete DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/
 * DB_NAME vars (the original local-dev shape) when DATABASE_URL isn't set.
 */
export function resolveDatabaseConfig() {
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      return {
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 5432,
        username: decodeURIComponent(url.username) || 'postgres',
        password: decodeURIComponent(url.password) || 'postgres',
        name: url.pathname.replace(/^\//, '') || 'ryda',
      };
    } catch {
      // Falls through to the discrete vars below if DATABASE_URL is
      // malformed rather than crashing config resolution over a typo.
    }
  }
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    name: process.env.DB_NAME ?? 'ryda',
  };
}
