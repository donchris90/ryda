import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillVehicleDocumentExpiry1791000000000 implements MigrationInterface {
  name = 'BackfillVehicleDocumentExpiry1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // driverProfileId/activeVehicleId are both plain varchar columns
    // (TypeORM's default for a bare `string` property) while the id
    // columns they actually reference are uuid - Postgres won't
    // implicitly compare the two, so every join here needs an explicit
    // ::uuid cast on the varchar side. Guarded with a regex check
    // first (rather than letting a malformed value 500 the whole
    // migration) since these FK columns aren't real foreign-key
    // constraints in this schema - nothing has ever enforced that
    // every stored value is actually a valid UUID string.
    const uuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

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
        JOIN driver_profiles dp ON dp.id::varchar = dd."driverProfileId"
        WHERE dd.type = 'insurance'
          AND dd.status = 'approved'
          AND dp."activeVehicleId" IS NOT NULL
          AND dp."activeVehicleId" ~ '${uuidPattern}'
        ORDER BY dp.id, dd."updatedAt" DESC
      ) latest
      WHERE v.id = latest.vehicle_id::uuid AND v."insuranceExpiry" IS NULL
    `);

    await queryRunner.query(`
      UPDATE vehicles v
      SET "roadWorthinessExpiry" = latest.expiry_date
      FROM (
        SELECT DISTINCT ON (dp.id) dp."activeVehicleId" AS vehicle_id, dd."expiryDate" AS expiry_date
        FROM driver_documents dd
        JOIN driver_profiles dp ON dp.id::varchar = dd."driverProfileId"
        WHERE dd.type = 'road_worthiness'
          AND dd.status = 'approved'
          AND dp."activeVehicleId" IS NOT NULL
          AND dp."activeVehicleId" ~ '${uuidPattern}'
        ORDER BY dp.id, dd."updatedAt" DESC
      ) latest
      WHERE v.id = latest.vehicle_id::uuid AND v."roadWorthinessExpiry" IS NULL
    `);
  }

  public async down(): Promise<void> {
    // Deliberately a no-op - this backfills genuinely-missing data from
    // already-approved documents; reversing it would mean re-blanking
    // out real expiry dates that are correct, not undoing a mistake.
  }
}
