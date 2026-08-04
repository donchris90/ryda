import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';

/**
 * A deliberately narrow alternative to AppModule for one-off scripts
 * (seeding, one-time data fixes) that only need database access.
 *
 * AppModule wires up BullModule at the top level, which means ANY
 * script bootstrapping the full app — via
 * NestFactory.createApplicationContext(AppModule) — needs a reachable
 * Redis connection too, even if the script itself never touches a
 * queue. That's a real, avoidable friction point on a host like
 * Render's free tier, where the Key Value instance defaults to
 * internal-only network access (see render.yaml) — a script run from
 * your own machine would need that opened up just to seed one admin
 * user, for a dependency it never actually uses.
 *
 * This module only pulls in what seed-admin actually needs: config,
 * the database connection, and the two services it calls.
 */
@Module({
  imports: [ConfigModule, EventEmitterModule.forRoot(), DatabaseModule, UsersModule, WalletsModule],
})
export class SeedAppModule {}
