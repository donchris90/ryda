import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRideMessagesTable1790900000000 implements MigrationInterface {
  name = 'CreateRideMessagesTable1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ride_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "rideId" character varying NOT NULL,
        "senderId" character varying NOT NULL,
        "senderRole" character varying NOT NULL,
        "message" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ride_messages_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ride_messages_rideId" ON "ride_messages" ("rideId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ride_messages"`);
  }
}
