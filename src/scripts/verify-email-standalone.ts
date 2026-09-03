/**
 * One-off: marks a single user's email as verified directly, bypassing
 * the link-click flow. For use when psql isn't installed locally and
 * you just need to fix one account (e.g. a CLI-seeded admin).
 *
 *   DATABASE_URL=... DB_SSL=true EMAIL=someone@example.com \
 *   npm run verify-email:standalone
 */
import { Client } from 'pg';

async function run() {
  const email = process.env.EMAIL;
  if (!email) {
    console.error('EMAIL environment variable is required.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  const result = await client.query(
    `UPDATE users SET "isEmailVerified" = true WHERE email = $1 RETURNING id, email, "isEmailVerified"`,
    [email],
  );

  if (result.rowCount === 0) {
    console.log(`No user found with email ${email}.`);
  } else {
    console.log('Updated:', result.rows[0]);
  }

  await client.end();
}

run().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
