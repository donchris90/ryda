// One-off script — run once, then delete. Marks migrations that already
// exist in this database (because they were originally applied via
// TypeORM's `synchronize: true`, before this project switched to
// tracked migrations) as "already run", without executing their SQL
// again. This lets `npm run migration:run` skip straight to whatever
// is genuinely new.
//
// Usage (PowerShell), from the backend folder, same env vars as
// migration:run:
//   node scripts/mark-legacy-migrations-applied.js

const { Client } = require('pg');

const ALREADY_APPLIED = [
  { timestamp: 1785688241033, name: 'InitialSchema1785688241033' },
  { timestamp: 1787610731738, name: 'MultiRoleAndRideCategoryTrim1787610731738' },
  { timestamp: 1787825914745, name: 'AddRideDispatchMode1787825914745' },
  { timestamp: 1787900000000, name: 'AddDeliveryDispatchMode1787900000000' },
  // Deliberately NOT including AddDriverServiceCapabilities1788000000000 —
  // that one is genuinely new and still needs to actually run.
];

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
    // Matches exactly what TypeORM itself creates on first migration:run —
    // safe to run even if this table doesn't exist yet.
    await client.query(`
      CREATE TABLE IF NOT EXISTS "migrations" (
        "id" SERIAL NOT NULL,
        "timestamp" bigint NOT NULL,
        "name" character varying NOT NULL,
        CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY ("id")
      )
    `);

    for (const migration of ALREADY_APPLIED) {
      const existing = await client.query(
        'SELECT 1 FROM "migrations" WHERE "name" = $1',
        [migration.name],
      );
      if (existing.rowCount > 0) {
        console.log(`Already marked: ${migration.name}`);
        continue;
      }
      await client.query(
        'INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)',
        [migration.timestamp, migration.name],
      );
      console.log(`Marked as applied: ${migration.name}`);
    }

    console.log('Done. Now run: npm run migration:run');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
