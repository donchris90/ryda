import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Closes a second, larger class of schema drift found the same way as
 * AddMissingRideColumns1789900000000: auditing every @Entity against every
 * existing migration. Where that migration found columns missing from an
 * existing table, this one found entire TABLES with no CREATE TABLE
 * migration anywhere, despite being actively used by live services:
 *
 *   - loyalty_accounts, loyalty_transactions   -> loyalty.service.ts
 *   - bank_accounts, withdrawal_requests       -> withdrawals.service.ts
 *   - wallet_transfer_requests                 -> wallet-transfers.service.ts
 *   - ledger_discrepancies                     -> ledger-audit.service.ts
 *   - geofences, geofence_events               -> geofence.service.ts
 *   - app_ratings                              -> app-ratings.service.ts
 *   - auth_tokens                              -> used for email verification
 *                                                  and password reset (auth.service.ts)
 *
 * Against any database that has only ever had migrations applied (i.e. any
 * environment that respects DB_SYNCHRONIZE=false, which is every deployed
 * environment), every one of the services above currently fails with
 * `relation "..." does not exist` (Postgres 42P01) the moment it runs -
 * a harder failure than a missing column, since there's no partial result
 * to fall back to. Of particular concern: withdrawal_requests and
 * bank_accounts back driver withdrawals, and ledger_discrepancies backs
 * the financial-integrity safety net described in the reconciliation
 * module's own doc comments - both are financially load-bearing, not
 * peripheral features.
 */
export class AddMissingTables1790000000000 implements MigrationInterface {
  name = 'AddMissingTables1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- loyalty ---
    await queryRunner.query(
      `CREATE TYPE "public"."loyalty_accounts_tier_enum" AS ENUM('bronze', 'silver', 'gold', 'platinum')`,
    );
    await queryRunner.query(`
      CREATE TABLE "loyalty_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" character varying NOT NULL,
        "pointsBalance" integer NOT NULL DEFAULT 0,
        "lifetimePoints" integer NOT NULL DEFAULT 0,
        "tier" "public"."loyalty_accounts_tier_enum" NOT NULL DEFAULT 'bronze',
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_loyalty_accounts_userId" UNIQUE ("userId"),
        CONSTRAINT "PK_loyalty_accounts_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "loyalty_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" character varying NOT NULL,
        "direction" character varying NOT NULL,
        "points" integer NOT NULL,
        "reason" character varying NOT NULL,
        "rideId" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loyalty_transactions_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_loyalty_transactions_userId" ON "loyalty_transactions" ("userId")`,
    );

    // --- driver bank accounts + withdrawals ---
    await queryRunner.query(`
      CREATE TABLE "bank_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" character varying NOT NULL,
        "bankName" character varying NOT NULL,
        "bankCode" character varying NOT NULL,
        "accountNumber" character varying NOT NULL,
        "accountName" character varying NOT NULL,
        "paystackRecipientCode" character varying NOT NULL,
        "isDefault" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bank_accounts_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_bank_accounts_userId" ON "bank_accounts" ("userId")`);

    await queryRunner.query(
      `CREATE TYPE "public"."withdrawal_requests_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed', 'expired')`,
    );
    await queryRunner.query(`
      CREATE TABLE "withdrawal_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" character varying NOT NULL,
        "bankAccountId" character varying NOT NULL,
        "amount" numeric(10,2) NOT NULL,
        "status" "public"."withdrawal_requests_status_enum" NOT NULL DEFAULT 'pending',
        "reference" character varying NOT NULL,
        "paystackTransferCode" character varying,
        "failureReason" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "completedAt" TIMESTAMP,
        "expiresAt" TIMESTAMP,
        CONSTRAINT "UQ_withdrawal_requests_reference" UNIQUE ("reference"),
        CONSTRAINT "PK_withdrawal_requests_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_withdrawal_requests_userId" ON "withdrawal_requests" ("userId")`);

    // --- wallet-to-wallet transfers ---
    await queryRunner.query(
      `CREATE TYPE "public"."wallet_transfer_requests_status_enum" AS ENUM('pending', 'completed', 'expired', 'cancelled')`,
    );
    await queryRunner.query(`
      CREATE TABLE "wallet_transfer_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "senderId" character varying NOT NULL,
        "recipientId" character varying NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "fee" numeric(14,2) NOT NULL DEFAULT 0,
        "note" text,
        "status" "public"."wallet_transfer_requests_status_enum" NOT NULL DEFAULT 'pending',
        "expiresAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallet_transfer_requests_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_transfer_requests_senderId" ON "wallet_transfer_requests" ("senderId")`);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_transfer_requests_recipientId" ON "wallet_transfer_requests" ("recipientId")`);

    // --- ledger discrepancies (reconciliation safety net) ---
    await queryRunner.query(
      `CREATE TYPE "public"."ledger_discrepancies_accounttype_enum" AS ENUM('wallet', 'fleet_wallet', 'corporate_account')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ledger_discrepancies_status_enum" AS ENUM('open', 'resolved')`,
    );
    await queryRunner.query(`
      CREATE TABLE "ledger_discrepancies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "accountType" "public"."ledger_discrepancies_accounttype_enum" NOT NULL DEFAULT 'wallet',
        "walletId" character varying NOT NULL,
        "walletBalance" numeric(14,2) NOT NULL,
        "ledgerBalance" numeric(14,2) NOT NULL,
        "difference" numeric(14,2) NOT NULL,
        "status" "public"."ledger_discrepancies_status_enum" NOT NULL DEFAULT 'open',
        "resolvedBy" character varying,
        "resolutionNote" character varying,
        "detectedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "resolvedAt" TIMESTAMP,
        CONSTRAINT "PK_ledger_discrepancies_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_ledger_discrepancies_accountType" ON "ledger_discrepancies" ("accountType")`);
    await queryRunner.query(`CREATE INDEX "IDX_ledger_discrepancies_walletId" ON "ledger_discrepancies" ("walletId")`);
    await queryRunner.query(`CREATE INDEX "IDX_ledger_discrepancies_status" ON "ledger_discrepancies" ("status")`);

    // --- geofencing ---
    await queryRunner.query(
      `CREATE TYPE "public"."geofences_type_enum" AS ENUM('restricted', 'alert_zone', 'service_area', 'surge_zone')`,
    );
    await queryRunner.query(`
      CREATE TABLE "geofences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "type" "public"."geofences_type_enum" NOT NULL,
        "centerLat" double precision NOT NULL,
        "centerLng" double precision NOT NULL,
        "radiusKm" double precision NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_geofences_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_geofences_type" ON "geofences" ("type")`);

    await queryRunner.query(`
      CREATE TABLE "geofence_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "geofenceId" character varying NOT NULL,
        "geofenceName" character varying NOT NULL,
        "geofenceType" "public"."geofences_type_enum" NOT NULL,
        "driverUserId" character varying NOT NULL,
        "lat" double precision NOT NULL,
        "lng" double precision NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_geofence_events_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_geofence_events_geofenceId" ON "geofence_events" ("geofenceId")`);
    await queryRunner.query(`CREATE INDEX "IDX_geofence_events_driverUserId" ON "geofence_events" ("driverUserId")`);

    // --- app store rating prompt ---
    await queryRunner.query(`
      CREATE TABLE "app_ratings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" character varying NOT NULL,
        "rating" smallint NOT NULL,
        "comment" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_app_ratings_userId" UNIQUE ("userId"),
        CONSTRAINT "PK_app_ratings_id" PRIMARY KEY ("id")
      )
    `);

    // --- auth tokens: email verification / password reset ---
    await queryRunner.query(
      `CREATE TYPE "public"."auth_tokens_purpose_enum" AS ENUM('email_verification', 'password_reset')`,
    );
    await queryRunner.query(`
      CREATE TABLE "auth_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" character varying NOT NULL,
        "token" character varying NOT NULL,
        "purpose" "public"."auth_tokens_purpose_enum" NOT NULL,
        "isUsed" boolean NOT NULL DEFAULT false,
        "expiresAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_auth_tokens_token" UNIQUE ("token"),
        CONSTRAINT "PK_auth_tokens_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_auth_tokens_userId" ON "auth_tokens" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "auth_tokens"`);
    await queryRunner.query(`DROP TYPE "public"."auth_tokens_purpose_enum"`);

    await queryRunner.query(`DROP TABLE "app_ratings"`);

    await queryRunner.query(`DROP TABLE "geofence_events"`);
    await queryRunner.query(`DROP TABLE "geofences"`);
    await queryRunner.query(`DROP TYPE "public"."geofences_type_enum"`);

    await queryRunner.query(`DROP TABLE "ledger_discrepancies"`);
    await queryRunner.query(`DROP TYPE "public"."ledger_discrepancies_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."ledger_discrepancies_accounttype_enum"`);

    await queryRunner.query(`DROP TABLE "wallet_transfer_requests"`);
    await queryRunner.query(`DROP TYPE "public"."wallet_transfer_requests_status_enum"`);

    await queryRunner.query(`DROP TABLE "withdrawal_requests"`);
    await queryRunner.query(`DROP TYPE "public"."withdrawal_requests_status_enum"`);

    await queryRunner.query(`DROP TABLE "bank_accounts"`);

    await queryRunner.query(`DROP TABLE "loyalty_transactions"`);
    await queryRunner.query(`DROP TABLE "loyalty_accounts"`);
    await queryRunner.query(`DROP TYPE "public"."loyalty_accounts_tier_enum"`);
  }
}
