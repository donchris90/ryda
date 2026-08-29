/**
 * Ryda - Delivery Dispatch Mode Column Repair
 *
 * WHY THIS EXISTS:
 *   scripts/mark-legacy-migrations-applied.js marks
 *   AddDeliveryDispatchMode1787900000000 as "already applied" on the
 *   assumption that `synchronize: true` had already created the column
 *   before that script ran. If DB_SYNCHRONIZE was actually turned off
 *   (in the Render dashboard, not just render.yaml) BEFORE this
 *   particular entity change was ever synced, that assumption is wrong:
 *   the `migrations` table now says this migration ran, so
 *   `npm run migration:run` will forever skip it — but the column was
 *   never actually created. Every POST /deliveries with
 *   dispatchMode=manual then fails with a genuine 500 the moment
 *   ordersRepo.save(order) tries to write a column that doesn't exist.
 *
 * WHAT THIS SCRIPT DOES:
 *   1. Connects directly to DATABASE_URL (bypassing the migrations
 *      table entirely) and checks pg_type / information_schema directly
 *      — the ground truth, not what any bookkeeping table claims.
 *   2. Reports exactly what it found.
 *   3. If the enum type and/or column are missing, creates them with
 *      the exact same DDL the migration itself uses (safe no-ops if
 *      they already exist).
 *
 * This never drops or rewrites existing data — it only adds a type
 * and/or a NOT NULL column with a default, which is always additive.
 *
 * This is wired into render.yaml's startCommand to run automatically on
 * every boot (Render's free plan has no Shell, so there's no other way
 * to run a true one-off against production) — it's cheap and fully
 * idempotent, so leaving it in the boot chain permanently is safe. You
 * generally don't need to run it manually. If you ever do (e.g. testing
 * locally against a copy of the production DB), from the backend
 * folder with DATABASE_URL/DB_SSL set to the target database:
 *
 *   node scripts/fix-delivery-dispatch-mode-column.js
 */

const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set in this shell session.');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: (process.env.DB_SSL ?? 'false') === 'true' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  try {
    const tableCheck = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'delivery_orders'`,
    );
    if (tableCheck.rowCount === 0) {
      // Brand-new database (nothing created yet at all) — nothing to
      // repair here. migration:run (which runs right after this script)
      // creates delivery_orders from scratch via InitialSchema, already
      // with the dispatchMode column in its final form. Exiting quietly
      // avoids ALTER TABLE-ing a table that doesn't exist yet.
      console.log('delivery_orders table does not exist yet — nothing to repair, migration:run will create it.');
      return;
    }

    const enumCheck = await client.query(
      `SELECT 1 FROM pg_type WHERE typname = 'delivery_orders_dispatchmode_enum'`,
    );
    const enumExists = enumCheck.rowCount > 0;
    console.log(`delivery_orders_dispatchmode_enum type exists: ${enumExists}`);

    if (!enumExists) {
      await client.query(
        `CREATE TYPE "public"."delivery_orders_dispatchmode_enum" AS ENUM('auto', 'manual')`,
      );
      console.log('Created delivery_orders_dispatchmode_enum.');
    }

    const columnCheck = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'dispatchMode'`,
    );
    const columnExists = columnCheck.rowCount > 0;
    console.log(`delivery_orders.dispatchMode column exists: ${columnExists}`);

    if (!columnExists) {
      await client.query(
        `ALTER TABLE "delivery_orders" ADD "dispatchMode" "public"."delivery_orders_dispatchmode_enum" NOT NULL DEFAULT 'auto'`,
      );
      console.log('Added delivery_orders.dispatchMode column (defaulted existing rows to \'auto\').');
    }

    // Reconcile the migrations bookkeeping table too, so a future
    // `npm run migration:run` doesn't have a false "already applied"
    // record fighting reality, nor try to re-run and fail on a
    // CREATE TYPE that now genuinely already exists (the migration file
    // itself now guards against that too, but this keeps the table
    // honest either way). CREATE TABLE IF NOT EXISTS first — this script
    // now runs on every boot, including against a brand-new database
    // where `migrations` doesn't exist at all yet (matches exactly what
    // TypeORM itself creates on its own first migration:run).
    await client.query(`
      CREATE TABLE IF NOT EXISTS "migrations" (
        "id" SERIAL NOT NULL,
        "timestamp" bigint NOT NULL,
        "name" character varying NOT NULL,
        CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY ("id")
      )
    `);
    const migrationRow = await client.query(
      `SELECT 1 FROM "migrations" WHERE "name" = 'AddDeliveryDispatchMode1787900000000'`,
    );
    if (migrationRow.rowCount === 0) {
      await client.query(
        'INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)',
        [1787900000000, 'AddDeliveryDispatchMode1787900000000'],
      );
      console.log('Recorded AddDeliveryDispatchMode1787900000000 as applied.');
    }

    console.log('Done. The manual-courier delivery flow should work now — try "Find couriers" again.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
