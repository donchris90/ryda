/**
 * Same as seed-admin.ts, but bootstraps SeedAppModule instead of the
 * full AppModule — deliberately avoids the BullModule/Redis dependency
 * that AppModule wires up at the top level for real request handling,
 * which this one-time task never touches. Use this variant specifically
 * when running against a hosted database from your own machine and you
 * don't want to also open up external access to your Redis/Key Value
 * instance just to seed one admin user.
 *
 *   DATABASE_URL=... DB_SSL=true \
 *   ADMIN_EMAIL=admin@ryda.ng ADMIN_PASSWORD='ChangeMe123!' \
 *   ADMIN_FIRST_NAME=Ryda ADMIN_LAST_NAME=Admin \
 *   npm run seed:admin:standalone
 *
 * Safe to re-run — it's a no-op if a user with that email already
 * exists (and prints their id/role instead of erroring). Seeded admins
 * are created pre-verified.
 */
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { SeedAppModule } from './seed-app.module';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { UserRole } from '../common/enums/user-role.enum';

async function run() {
  const email = process.env.ADMIN_EMAIL;
  const phone = process.env.ADMIN_PHONE; // optional
  const password = process.env.ADMIN_PASSWORD;
  const firstName = process.env.ADMIN_FIRST_NAME ?? 'Ryda';
  const lastName = process.env.ADMIN_LAST_NAME ?? 'Admin';

  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(SeedAppModule, { logger: ['error', 'warn'] });
  const usersService = app.get(UsersService);
  const walletsService = app.get(WalletsService);

  const existing = await usersService.findByEmail(email);
  if (existing) {
    console.log(`User with email ${email} already exists (id: ${existing.id}, role: ${existing.role}).`);
    if (existing.role !== UserRole.ADMIN) {
      console.log('That user is not an admin. Promote manually if needed.');
    }
    await app.close();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await usersService.create({
    email,
    phone: phone ?? null,
    firstName,
    lastName,
    passwordHash,
    role: UserRole.ADMIN,
  });
  await walletsService.createForUser(user.id);

  console.log(`Admin user created: id=${user.id}, phone=${user.phone}`);
  await app.close();
}

run().catch((err) => {
  console.error('Failed to seed admin user:', err);
  process.exit(1);
});
