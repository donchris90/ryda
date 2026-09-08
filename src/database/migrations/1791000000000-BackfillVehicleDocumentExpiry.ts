import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillVehicleDocumentExpiry1791000000000 implements MigrationInterface {
  name = 'BackfillVehicleDocumentExpiry1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // DISTINCT ON (dp.id) with ORDER BY ... dd."updatedAt" DESC picks each
    // driver's single most-recently-approved document per type - a
    // driver who re-uploaded and got re-approved after an earlier
    // rejection should backfill from that latest approval, not an
    // older one.
    await queryRunner.query(`
      UPDATE vehicles v
      SET "insuranceExpiry" = latest.expiry_date
      FROM (
        SELECT DISTINCT ON (dp.id) dp."activeVehicleId" AS vehicle_id, dd."expiryDate" AS expiry_date
        FROM driver_documents dd
        JOIN driver_profiles dp ON dp.id = dd."driverProfileId"
        WHERE dd.type = 'insurance' AND dd.status = 'approved' AND dp."activeVehicleId" IS NOT NULL
        ORDER BY dp.id, dd."updatedAt" DESC
      ) latest
      WHERE v.id = latest.vehicle_id AND v."insuranceExpiry" IS NULL
    `);

    await queryRunner.query(`
      UPDATE vehicles v
      SET "roadWorthinessExpiry" = latest.expiry_date
      FROM (
        SELECT DISTINCT ON (dp.id) dp."activeVehicleId" AS vehicle_id, dd."expiryDate" AS expiry_date
        FROM driver_documents dd
        JOIN driver_profiles dp ON dp.id = dd."driverProfileId"
        WHERE dd.type = 'road_worthiness' AND dd.status = 'approved' AND dp."activeVehicleId" IS NOT NULL
        ORDER BY dp.id, dd."updatedAt" DESC
      ) latest
      WHERE v.id = latest.vehicle_id AND v."roadWorthinessExpiry" IS NULL
    `);
  }

  public async down(): Promise<void> {
    // Deliberately a no-op - this backfills genuinely-missing data from
    // already-approved documents; reversing it would mean re-blanking
    // out real expiry dates that are correct, not undoing a mistake.
  }
}
