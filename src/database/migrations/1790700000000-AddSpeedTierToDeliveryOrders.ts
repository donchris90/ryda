import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * See DeliverySpeedTier's own doc comment in delivery-order.entity.ts
 * for what this does and, just as importantly, what it deliberately
 * does not do (no scheduled-dispatch enforcement of the 24h window -
 * purely a pricing tier for now).
 */
export class AddSpeedTierToDeliveryOrders1790700000000 implements MigrationInterface {
  name = 'AddSpeedTierToDeliveryOrders1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."delivery_orders_speedtier_enum" AS ENUM('express', 'standard');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD COLUMN IF NOT EXISTS "speedTier" "public"."delivery_orders_speedtier_enum" NOT NULL DEFAULT 'express'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "speedTier"`);
    await queryRunner.query(`DROP TYPE "public"."delivery_orders_speedtier_enum"`);
  }
}
