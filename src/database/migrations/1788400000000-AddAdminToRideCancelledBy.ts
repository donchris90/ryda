import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds 'admin' to rides.cancelledBy's Postgres enum - needed for the
 * new admin-initiated cancel endpoint (RidesService.cancelRideForAdmin),
 * which previously had nowhere accurate to record itself: the existing
 * passenger/driver/system cancel path would have had to misattribute
 * an admin's cancellation as one of those three.
 *
 * Postgres requires ALTER TYPE ... ADD VALUE to run outside a
 * surrounding transaction on older versions; TypeORM runs each
 * migration in its own transaction by default, but ADD VALUE alone
 * (not used later in the same transaction) is safe on Postgres 12+,
 * which this project already requires elsewhere.
 */
export class AddAdminToRideCancelledBy1788400000000 implements MigrationInterface {
  name = 'AddAdminToRideCancelledBy1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."rides_cancelledby_enum" ADD VALUE 'admin'`);
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums - removing 'admin' would mean
    // recreating the type and every column/index that depends on it.
    // Left as a no-op, consistent with how a genuinely irreversible
    // schema change should be handled: down() would otherwise lie about
    // being able to undo this.
  }
}
