/**
 * Ryda - Legacy User Email Migration
 *
 * Purpose:
 *   Safely migrate existing users whose email is NULL so that the
 *   production database can enforce users.email as NOT NULL.
 *
 * IMPORTANT:
 *   - Existing real emails are NEVER changed.
 *   - Phone numbers are NEVER used as email addresses.
 *   - Passwords are NEVER changed.
 *   - User IDs are NEVER changed.
 *   - Wallets/rides/documents/etc. are NEVER changed.
 *   - The generated address is ONLY a temporary internal placeholder.
 *
 * Run this ON RENDER, where DATABASE_URL points to the production DB.
 */

const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

/**
 * Render PostgreSQL requires SSL for external connections.
 *
 * rejectUnauthorized:false is intentional here because this is a
 * one-time migration script and Render provides the TLS endpoint.
 */
function createClient() {
  return new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
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

    // ------------------------------------------------------------
    // 1. Check that the users table exists
    // ------------------------------------------------------------

    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'users'
      ) AS exists
    `);

    if (!tableCheck.rows[0].exists) {
      throw new Error('The public.users table does not exist.');
    }

    // ------------------------------------------------------------
    // 2. Count users before migration
    // ------------------------------------------------------------

    const before = await client.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE email IS NULL)::int AS null_email_users,
        COUNT(*) FILTER (
          WHERE email IS NOT NULL
        )::int AS users_with_email
      FROM users
    `);

    console.log('Before migration:');
    console.log(`  Total users:       ${before.rows[0].total_users}`);
    console.log(`  Users with email:  ${before.rows[0].users_with_email}`);
    console.log(`  NULL email users:  ${before.rows[0].null_email_users}`);
    console.log('');

    const nullCount = Number(before.rows[0].null_email_users);

    if (nullCount === 0) {
      console.log('No users with NULL email were found.');
      console.log('Nothing needs to be migrated.');
      return;
    }

    // ------------------------------------------------------------
    // 3. Show which records are going to be changed
    //
    // We deliberately use the user's database ID rather than their
    // phone number.
    // ------------------------------------------------------------

    const preview = await client.query(`
      SELECT
        id::text AS user_id,
        phone
      FROM users
      WHERE email IS NULL
      ORDER BY id
      LIMIT 20
    `);

    console.log(
      `Users requiring migration: ${nullCount}`
    );

    if (preview.rows.length > 0) {
      console.log('');
      console.log('First users requiring migration:');

      for (const row of preview.rows) {
        console.log(
          `  ID: ${row.user_id} | phone: ${
            row.phone ? '[present]' : '[none]'
          }`
        );
      }

      if (nullCount > 20) {
        console.log(`  ... and ${nullCount - 20} more`);
      }
    }

    console.log('');

    // ------------------------------------------------------------
    // 4. Perform the migration atomically
    // ------------------------------------------------------------

    await client.query('BEGIN');

    try {
      /**
       * Generate a unique internal placeholder from the user's
       * database ID.
       *
       * Example:
       *
       * legacy-550e8400-e29b-41d4-a716-446655440000@placeholder.ryda.ng
       *
       * We intentionally DO NOT use:
       *
       *   phone + '@placeholder.ryda.ng'
       *
       * because phone numbers can be changed, duplicated, missing,
       * or later become sensitive login identifiers.
       */
      const result = await client.query(`
        UPDATE users
        SET email =
          'legacy-' || id::text || '@placeholder.ryda.ng'
        WHERE email IS NULL
      `);

      console.log(`Rows updated: ${result.rowCount}`);

      // ----------------------------------------------------------
      // 5. Verify that no NULL emails remain
      // ----------------------------------------------------------

      const remaining = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE email IS NULL
      `);

      const remainingNulls = Number(remaining.rows[0].count);

      if (remainingNulls !== 0) {
        throw new Error(
          `${remainingNulls} users still have NULL email after migration.`
        );
      }

      // ----------------------------------------------------------
      // 6. Verify that generated placeholder emails are unique
      // ----------------------------------------------------------

      const duplicates = await client.query(`
        SELECT email, COUNT(*)::int AS count
        FROM users
        WHERE email LIKE 'legacy-%@placeholder.ryda.ng'
        GROUP BY email
        HAVING COUNT(*) > 1
        LIMIT 1
      `);

      if (duplicates.rows.length > 0) {
        throw new Error(
          `Duplicate placeholder email detected: ${duplicates.rows[0].email}`
        );
      }

      await client.query('COMMIT');

      console.log('');
      console.log('Migration committed successfully.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    // ------------------------------------------------------------
    // 7. Final verification
    // ------------------------------------------------------------

    const after = await client.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE email IS NULL)::int AS null_email_users,
        COUNT(*) FILTER (
          WHERE email LIKE 'legacy-%@placeholder.ryda.ng'
        )::int AS legacy_placeholder_users
      FROM users
    `);

    console.log('');
    console.log('After migration:');
    console.log(`  Total users:             ${after.rows[0].total_users}`);
    console.log(`  NULL email users:        ${after.rows[0].null_email_users}`);
    console.log(
      `  Legacy placeholder users: ${after.rows[0].legacy_placeholder_users}`
    );

    console.log('');
    console.log('SUCCESS.');
    console.log(
      'Existing real email addresses were preserved.'
    );
    console.log(
      'Legacy NULL-email accounts now have temporary internal identifiers.'
    );
    console.log(
      'Those accounts should be required to replace the placeholder with a real email during account recovery/profile setup.'
    );
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
