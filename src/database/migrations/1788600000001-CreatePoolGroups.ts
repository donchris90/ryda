import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePoolGroups1788600000001 implements MigrationInterface {
    name = 'CreatePoolGroups1788600000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."pool_groups_status_enum" AS ENUM('matched', 'dispatched', 'in_progress', 'completed', 'unwound')`);
        await queryRunner.query(`CREATE TABLE "pool_groups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "status" "public"."pool_groups_status_enum" NOT NULL DEFAULT 'matched', "anchorRideId" character varying NOT NULL, "partnerRideId" character varying NOT NULL, "city" character varying, "routeSequence" jsonb NOT NULL, "estimatedTotalDistanceKm" double precision, "estimatedTotalDurationMin" double precision, "matchedAt" TIMESTAMP, "unwindReason" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_pool_groups_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pool_groups_status" ON "pool_groups" ("status")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_pool_groups_status"`);
        await queryRunner.query(`DROP TABLE "pool_groups"`);
        await queryRunner.query(`DROP TYPE "public"."pool_groups_status_enum"`);
    }

}
