import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates split_fare_requests and split_fare_participants - discovered
 * while adding expiration support that NEITHER table had a creation
 * migration anywhere in this codebase's history, despite SplitFareService
 * being fully implemented and reachable (POST /rides/:id/split-fare and
 * friends). In a real migrated deployment this feature would fail
 * outright with "relation does not exist" the first time anyone used
 * it - it only ever worked in an environment relying on TypeORM's
 * synchronize:true to silently create tables from entities, which is
 * not how this project's other 16 migrations get the schema into
 * production. Includes expiresAt and the 'expired' status from the
 * start, since there's no prior state to build on top of here.
 */
export class CreateSplitFareTables1789200000000 implements MigrationInterface {
  name = 'CreateSplitFareTables1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."split_fare_requests_status_enum" AS ENUM('pending', 'completed', 'cancelled', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TABLE "split_fare_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "rideId" character varying NOT NULL,
        "initiatorId" character varying NOT NULL,
        "totalAmount" numeric(12,2) NOT NULL,
        "status" "public"."split_fare_requests_status_enum" NOT NULL DEFAULT 'pending',
        "expiresAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_split_fare_requests_rideId" UNIQUE ("rideId"),
        CONSTRAINT "PK_split_fare_requests_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."split_fare_participants_status_enum" AS ENUM('pending', 'paid')`,
    );
    await queryRunner.query(
      `CREATE TABLE "split_fare_participants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "splitRequestId" uuid NOT NULL,
        "userId" character varying NOT NULL,
        "amountOwed" numeric(12,2) NOT NULL,
        "status" "public"."split_fare_participants_status_enum" NOT NULL DEFAULT 'pending',
        "paidAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_split_fare_participants_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_split_fare_participants_splitRequestId" FOREIGN KEY ("splitRequestId")
          REFERENCES "split_fare_requests"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_split_fare_participants_splitRequestId" ON "split_fare_participants" ("splitRequestId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_split_fare_participants_userId" ON "split_fare_participants" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "split_fare_participants"`);
    await queryRunner.query(`DROP TYPE "public"."split_fare_participants_status_enum"`);
    await queryRunner.query(`DROP TABLE "split_fare_requests"`);
    await queryRunner.query(`DROP TYPE "public"."split_fare_requests_status_enum"`);
  }
}
