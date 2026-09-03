import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeliveryVehicleTypeConfigs1788700000000
  implements MigrationInterface
{
  name = 'CreateDeliveryVehicleTypeConfigs1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type safely.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'delivery_vehicle_type_configs_vehicletype_enum'
        ) THEN
          CREATE TYPE "public"."delivery_vehicle_type_configs_vehicletype_enum"
          AS ENUM (
            'bike',
            'keke',
            'car',
            'van',
            'pickup',
            'truck'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery_vehicle_type_configs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),

        "vehicleType"
          "public"."delivery_vehicle_type_configs_vehicletype_enum"
          NOT NULL,

        "baseFare" numeric(12,2) NOT NULL,

        "perKm" numeric(12,2) NOT NULL,

        "perKg" numeric(12,2) NOT NULL,

        "minimumFare" numeric(12,2) NOT NULL,

        "maxWeightKg" numeric(10,2) NOT NULL,

        "capacityDescription" character varying,

        "isActive" boolean NOT NULL DEFAULT true,

        "createdAt"
          TIMESTAMP NOT NULL DEFAULT now(),

        "updatedAt"
          TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_delivery_vehicle_type_configs_id"
          PRIMARY KEY ("id"),

        CONSTRAINT "UQ_delivery_vehicle_type_configs_vehicleType"
          UNIQUE ("vehicleType")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "delivery_vehicle_type_configs"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS
      "public"."delivery_vehicle_type_configs_vehicletype_enum"
    `);
  }
}
