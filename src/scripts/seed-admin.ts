/**
 * Seeds the first admin user, since there's no public endpoint to create
 * one (an unauthenticated "make me an admin" endpoint would obviously be a
 * security hole). Run once against a fresh environment:
 *
 *   ADMIN_EMAIL=admin@ryda.ng ADMIN_PASSWORD='ChangeMe123!' \
 *   ADMIN_FIRST_NAME=Ryda ADMIN_LAST_NAME=Admin \
 *   npm run seed:admin
 *
 * Safe to re-run — it's a no-op if a user with that email already
 * exists (and prints their id/role instead of erroring).
 *
 * Seeded admins are created pre-verified (isEmailVerified: true) —
 * there's no inbox to click a link from during a seed script, and an
 * admin created this way has already been trusted by whoever ran it.
 */
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../app.module';
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

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
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
  await usersService.markEmailVerified(user.id);
  await walletsService.createForUser(user.id);

  console.log(`Admin user created: id=${user.id}, email=${user.email}`);
  await app.close();
}

run().catch((err) => {
  console.error('Failed to seed admin user:', err);
  process.exit(1);
});
