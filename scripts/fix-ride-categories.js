/**
 * Ryda - Ride Category Enum Shrink Fix
 *
 * Purpose:
 *   RideCategory was briefly expanded to 10 values (economy, comfort,
 *   executive, xl, suv, electric, motorcycle, tricycle, taxi, luxury),
 *   deployed, then reverted back down to just economy/comfort per an
 *   explicit product decision. Any real ride created during that
 *   window with one of the now-removed categories (e.g. category='xl')
 *   blocks Postgres from shrinking the rides_category_enum type -
 *   TypeORM's synchronize tries to convert every existing row to the
 *   new, smaller enum, and Postgres correctly refuses when a row's
 *   value no longer exists in it at all. This is exactly why the app
 *   fails to boot.
 *
 * IMPORTANT:
 *   - Only touches rides.category, and only for the specific values
 *     that no longer exist (executive/xl/suv/electric/motorcycle/
 *     tricycle/taxi/luxury). Rows already 'economy' or 'comfort' are
 *     never touched.
 *   - Reassigns affected rides to 'economy' - a real product decision,
 *     not a silent data-loss risk: the ride itself, its fare, its
 *     driver, its history are all untouched, only which category label
 *     it's filed under changes. Worth knowing which rides this affects
 *     if very few - this script prints them before changing anything.
 *   - Safe to re-run - a no-op once no rows reference a removed value.
 *
 * Run this ON RENDER, where DATABASE_URL points to the production DB.
 */

const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

const REMOVED_CATEGORIES = ['executive', 'xl', 'suv', 'electric', 'motorcycle', 'tricycle', 'taxi', 'luxury'];

function createClient() {
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
  });
}

async function main() {
  const client = createClient();

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('Connected successfully.');
    console.log('');

    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'rides'
      ) AS exists
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('The public.rides table does not exist yet - nothing to fix.');
      return;
    }

    const affected = await client.query(
      `SELECT id::text, category::text FROM rides WHERE category::text = ANY($1) ORDER BY id`,
      [REMOVED_CATEGORIES],
    );

    if (affected.rows.length === 0) {
      console.log('No rides found using a removed category. Nothing to migrate.');
      return;
    }

    console.log(`Found ${affected.rows.length} ride(s) using a category that no longer exists:`);
    for (const row of affected.rows) {
      console.log(`  ${row.id} — was '${row.category}'`);
    }
    console.log('');
    console.log("Reassigning these to 'economy' (fare, driver, and trip history are untouched).");

    const result = await client.query(
      `UPDATE rides SET category = 'economy' WHERE category::text = ANY($1)`,
      [REMOVED_CATEGORIES],
    );

    console.log(`Rows updated: ${result.rowCount}`);
    console.log('');
    console.log('SUCCESS. synchronize can now shrink the category enum safely.');
  } catch (error) {
    console.error('');
    console.error('MIGRATION FAILED');
    console.error('----------------');
    console.error(error.message);
    if (error.stack) {
      console.error('');
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore connection-close errors.
    }
  }
}

main();