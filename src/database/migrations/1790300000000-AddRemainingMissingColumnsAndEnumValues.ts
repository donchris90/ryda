import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remaining gaps found by a full audit of every enum column's code-side
 * values against the database, run after AddMissingIncidentStatusEnumValues
 * surfaced the same class of bug on incidents.status. Two categories:
 *
 * 1. Columns missing entirely (their enum type was never created at all):
 *    - notifications.category  (NotificationCategory)
 *    - incidents.severity      (IncidentSeverity)
 *    - delivery_orders.vehicleType (DeliveryVehicleType)
 *
 * 2. Enum types that exist but are missing values the code has used for
 *    some time - each of these is a live "invalid input value for enum"
 *    crash waiting to happen the moment that specific value is written:
 *    - wallet_transactions_category_enum (split-fare, tips, transfers, admin adjustment)
 *    - fraud_flags_type_enum (most of the fraud-detection signal types)
 *    - driver_availability_logs_status_enum / driver_profiles_availability_enum
 *      (multi-service availability - online_for_rides/deliveries/both, break)
 *    - support_tickets_category_enum (wallet_issue, package_issue)
 */
export class AddRemainingMissingColumnsAndEnumValues1790300000000 implements MigrationInterface {
  name = 'AddRemainingMissingColumnsAndEnumValues1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- notifications.category ---
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."notifications_category_enum" AS ENUM('ride', 'wallet', 'promotion', 'support', 'security', 'general');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'category'
        ) THEN
          ALTER TABLE "notifications" ADD "category" "public"."notifications_category_enum" NOT NULL DEFAULT 'general';
        END IF;
      END $$;
    `);

    // --- incidents.severity ---
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."incidents_severity_enum" AS ENUM('low', 'medium', 'high', 'critical');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'severity'
        ) THEN
          ALTER TABLE "incidents" ADD "severity" "public"."incidents_severity_enum" NOT NULL DEFAULT 'medium';
        END IF;
      END $$;
    `);

    // --- delivery_orders.vehicleType ---
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."delivery_orders_vehicletype_enum" AS ENUM('bike', 'keke', 'car', 'van', 'pickup', 'truck');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'vehicleType'
        ) THEN
          ALTER TABLE "delivery_orders" ADD "vehicleType" "public"."delivery_orders_vehicletype_enum" NOT NULL DEFAULT 'car';
        END IF;
      END $$;
    `);

    // --- wallet_transactions.category: add every value used by TransactionCategory ---
    for (const value of [
      'split_fare_payment',
      'split_fare_received',
      'tip_payment',
      'tip_received',
      'transfer_sent',
      'transfer_received',
      'admin_adjustment',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "public"."wallet_transactions_category_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    // --- fraud_flags.type: add every value used by FraudFlagType ---
    for (const value of [
      'new_device_login',
      'high_risk_withdrawal_attempt',
      'critical_risk_withdrawal_blocked',
      'repeated_payment_failures',
      'multiple_cards_added',
      'repeated_promo_redemption',
      'repeated_cancellations',
      'excessive_refunds',
      'unusual_wallet_velocity',
      'chargeback_history',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "public"."fraud_flags_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    // --- driver availability: two separate DB enum types share the same
    // gap against DriverAvailability (driver_profiles.lastOnlineAvailability
    // reuses driver_profiles_availability_enum, so fixing it here covers
    // that column too) ---
    for (const enumType of ['driver_availability_logs_status_enum', 'driver_profiles_availability_enum']) {
      for (const value of ['online_for_rides', 'online_for_deliveries', 'online_for_both', 'break']) {
        await queryRunner.query(`ALTER TYPE "public"."${enumType}" ADD VALUE IF NOT EXISTS '${value}'`);
      }
    }

    // --- support_tickets.category: add remaining TicketCategory values ---
    for (const value of ['wallet_issue', 'package_issue']) {
      await queryRunner.query(
        `ALTER TYPE "public"."support_tickets_category_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "vehicleType"`);
    await queryRunner.query(`DROP TYPE "public"."delivery_orders_vehicletype_enum"`);

    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN "severity"`);
    await queryRunner.query(`DROP TYPE "public"."incidents_severity_enum"`);

    await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "category"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_category_enum"`);

    // Enum values added above are intentionally not removed on rollback -
    // see AddMissingIncidentStatusEnumValues's down() for why Postgres
    // makes safely reversing ADD VALUE impractical without knowing no row
    // uses the value being removed.
  }
}
