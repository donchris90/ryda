import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Security fix: StorageController.serveLocal() previously let any
 * authenticated user read any file under chat-attachments/ or
 * support-evidence/ as long as they guessed (or were handed) the UUID
 * filename — there was no record of who uploaded a file or what ride/
 * ticket it belonged to, so there was nothing to check ownership against.
 * This table gives serveLocal() something to check.
 */
export class AddUploadedFiles1788200000000 implements MigrationInterface {
  name = 'AddUploadedFiles1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "uploaded_files" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "folder" character varying NOT NULL,
                "filename" character varying NOT NULL,
                "uploaderId" character varying NOT NULL,
                "contextType" character varying,
                "contextId" character varying,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_uploaded_files_id" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_uploaded_files_folder_filename" ON "uploaded_files" ("folder", "filename")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_uploaded_files_uploaderId" ON "uploaded_files" ("uploaderId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_uploaded_files_uploaderId"`);
    await queryRunner.query(`DROP INDEX "IDX_uploaded_files_folder_filename"`);
    await queryRunner.query(`DROP TABLE "uploaded_files"`);
  }
}
