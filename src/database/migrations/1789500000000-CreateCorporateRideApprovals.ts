import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds corporate_accounts.requiresApprovalAboveFare (a soft threshold,
 * distinct from the hard-block maxFarePerRide) and creates
 * corporate_ride_approvals - rides flagged for after-the-fact manager
 * review, not a real-time gate on dispatch.
 */
export class CreateCorporateRideApprovals1789500000000 implements MigrationInterface {
  name = 'CreateCorporateRideApprovals1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "corporate_accounts" ADD "requiresApprovalAboveFare" numeric(10,2)`);

    await queryRunner.query(
      `CREATE TYPE "public"."corporate_ride_approvals_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "corporate_ride_approvals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "corporateAccountId" character varying NOT NULL,
        "rideId" character varying NOT NULL,
        "employeeUserId" character varying NOT NULL,
        "fareAmount" numeric(10,2) NOT NULL,
        "status" "public"."corporate_ride_approvals_status_enum" NOT NULL DEFAULT 'pending',
        "reviewedBy" character varying,
        "reviewNotes" character varying,
        "reviewedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_corporate_ride_approvals_rideId" UNIQUE ("rideId"),
        CONSTRAINT "PK_corporate_ride_approvals_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_corporate_ride_approvals_corporateAccountId" ON "corporate_ride_approvals" ("corporateAccountId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_corporate_ride_approvals_corporateAccountId"`);
    await queryRunner.query(`DROP TABLE "corporate_ride_approvals"`);
    await queryRunner.query(`DROP TYPE "public"."corporate_ride_approvals_status_enum"`);
    await queryRunner.query(`ALTER TABLE "corporate_accounts" DROP COLUMN "requiresApprovalAboveFare"`);
  }
}
