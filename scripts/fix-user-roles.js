/**
 * Ryda - Multi-Role Backfill Fix
 *
 * Purpose:
 *   users.roles was added as a new array column with a default of
 *   {passenger}. The intended migration (see
 *   1787610731738-MultiRoleAndRideCategoryTrim.ts) would have backfilled
 *   it from each user's existing `role` column - but this project uses
 *   TypeORM's synchronize, not real migration:run, so that backfill
 *   query never actually executed. synchronize just added the column
 *   with its static default applied to every existing row.
 *
 *   Real impact: every account that existed before this column was
 *   added - drivers, admins, everyone - ended up with roles=[passenger]
 *   regardless of their real role. Login still works fine (it doesn't
 *   check role/roles at all), but every role-gated endpoint
 *   (RolesGuard, PermissionsGuard) silently rejects them, since those
 *   check `roles`, not the legacy `role` field.
 *
 * IMPORTANT:
 *   - Only touches accounts where the primary `role` is missing from
 *     `roles` entirely - a clear signal this account was never
 *     correctly backfilled, not a genuine multi-role account someone
 *     built up since (unlikely given this bug, but this stays targeted
 *     rather than blindly overwriting every row).
 *   - Sets roles = ARRAY[role] for those accounts - the exact same
 *     statement the unrun migration itself would have executed.
 *   - Passwords, emails, and every other field are untouched.
 *   - Safe to re-run - a no-op once every account's roles already
 *     includes its own primary role.
 *
 * Run this ON RENDER, where DATABASE_URL points to the production DB.
 */

const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

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
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'roles'
      ) AS exists
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('users.roles does not exist yet - nothing to fix.');
      return;
    }

    const affected = await client.query(
      `SELECT id::text, email, role::text, roles::text[] FROM users WHERE NOT (role::text = ANY(roles::text[])) ORDER BY id`,
    );

    if (affected.rows.length === 0) {
      console.log("Every account's roles already includes its own primary role. Nothing to migrate.");
      return;
    }

    console.log(`Found ${affected.rows.length} account(s) never correctly backfilled:`);
    for (const row of affected.rows) {
      console.log(`  ${row.email} — role='${row.role}', roles was [${row.roles.join(', ')}]`);
    }
    console.log('');

    // Postgres requires an explicit cast to the real enum type name for
    // this assignment - a bare text[] does NOT auto-coerce even though
    // the target column's type is known at UPDATE time (confirmed this
    // directly; "column is of type X[] but expression is of type
    // text[]" is a hard error, not a warning). Discovering the actual
    // type name here rather than hardcoding it, since role and roles
    // turned out to use two separately-named enum types in production
    // (users_role_enum vs users_roles_enum) despite having identical
    // values - not something worth assuming stays true or guessing at.
    const typeNameResult = await client.query(`
      SELECT t.typname AS element_type_name
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_type arr_t ON arr_t.oid = a.atttypid
      JOIN pg_type t ON t.oid = arr_t.typelem
      WHERE c.relname = 'users' AND a.attname = 'roles'
    `);
    const rolesElementType = typeNameResult.rows[0]?.element_type_name;
    if (!rolesElementType) {
      throw new Error('Could not determine the roles column element type - aborting rather than guessing.');
    }

    console.log(`Setting roles = ARRAY[role] for these accounts, cast to "${rolesElementType}"[] (same as the original, unrun migration).`);

    const result = await client.query(
      `UPDATE users SET roles = ARRAY[role::text]::text[]::"${rolesElementType}"[] WHERE NOT (role::text = ANY(roles::text[]))`,
    );

    console.log(`Rows updated: ${result.rowCount}`);
    console.log('');
    console.log('SUCCESS. Every account now has its primary role correctly reflected in roles.');
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
