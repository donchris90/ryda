import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * wallet_transactions_category_enum was created in InitialSchema with only
 * the 12 categories that existed at the time. The TransactionCategory TS
 * enum (common/enums/transaction.enum.ts) has since grown to 19 values,
 * but nothing ever ran ALTER TYPE ... ADD VALUE to catch the Postgres enum
 * up - so every write using one of the newer categories fails with
 * Postgres 22P02 (invalid input value for enum) the moment WalletsService
 * tries to insert the ledger row, rolling back the whole transaction:
 *
 *   - admin_adjustment   -> AdminWalletsController.credit() (every admin
 *                            wallet credit)
 *   - transfer_sent / transfer_received -> WalletsService.transfer()
 *                            (every wallet-to-wallet transfer)
 *   - tip_payment / tip_received        -> tipping a driver
 *   - split_fare_payment / split_fare_received -> split-fare rides
 *
 * ALTER TYPE ... ADD VALUE is safe to run inside TypeORM's migration
 * transaction as long as the new value isn't also used in the same
 * transaction (Postgres 12+) - this migration only adds values, so that's
 * fine.
 */
export class AddMissingWalletTransactionCategoryEnumValues1790400000000
  implements MigrationInterface
{
  name = 'AddMissingWalletTransactionCategoryEnumValues1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const missingValues = [
      'split_fare_payment',
      'split_fare_received',
      'tip_payment',
      'tip_received',
      'transfer_sent',
      'transfer_received',
      'admin_adjustment',
    ];
    for (const value of missingValues) {
      await queryRunner.query(
        `ALTER TYPE "public"."wallet_transactions_category_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums - removing a value safely would
    // require rebuilding the type and rewriting every row, which is out of
    // scope for a down migration and not something we want to do silently
    // on a financial ledger table. Left as a no-op, matching the project's
    // convention on other enum-add migrations (see AddFraudFlagEscalatedStatus).
  }
}
