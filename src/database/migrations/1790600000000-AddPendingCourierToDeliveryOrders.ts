import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Companion to the selectCourier() fix in logistics.service.ts: manual
 * courier selection now sends the chosen courier a real, targeted offer
 * (delivery.requested) instead of auto-accepting on their behalf, so the
 * order correctly stays SEARCHING until they actually confirm - matching
 * how ride manual-selection already worked. But delivery/[id].tsx has a
 * pre-existing redirect that sends a passenger straight back to
 * choose-courier the instant a MANUAL order is SEARCHING with no
 * driverId yet, on the assumption that state only ever meant "nobody
 * picked yet." After the selectCourier() fix, a MANUAL order can now
 * legitimately be SEARCHING for a second reason - someone WAS picked and
 * an offer is pending - and nothing on the order distinguished the two.
 * This column is that distinction: set when a courier is invited, cleared
 * once they accept (driverId takes over from there).
 */
export class AddPendingCourierToDeliveryOrders1790600000000 implements MigrationInterface {
  name = 'AddPendingCourierToDeliveryOrders1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD COLUMN IF NOT EXISTS "pendingCourierUserId" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "pendingCourierUserId"`);
  }
}
