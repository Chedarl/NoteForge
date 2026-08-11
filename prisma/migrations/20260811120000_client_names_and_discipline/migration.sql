-- Client names (encrypted) and clinician discipline.
--
-- Two things this migration is careful about:
--
--   1. `givenNameEnc` holds ciphertext, never a name. Nothing in the database
--      can read it; the key lives in the application environment. See
--      src/lib/crypto/field.ts.
--   2. `discipline` is nullable on both User and Submission on purpose. Existing
--      rows predate the field and there is no honest value to backfill them
--      with — guessing a clinician's discipline and stamping it on historical
--      encounters would put a fact into the record that nobody asserted. The
--      portal asks each clinician once, and fills it forward from there.

-- CreateEnum
CREATE TYPE "Discipline" AS ENUM ('SOCIAL_CASE_WORKER', 'NURSE_PRACTITIONER', 'THERAPIST', 'COUNSELLOR', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TemplateKind" ADD VALUE 'CASE_MANAGEMENT';
ALTER TYPE "TemplateKind" ADD VALUE 'NURSING';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "familyInitial" TEXT,
ADD COLUMN     "givenNameEnc" TEXT;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "discipline" "Discipline";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "discipline" "Discipline";

-- CreateIndex
CREATE INDEX "Submission_practiceId_encounterDate_idx" ON "Submission"("practiceId", "encounterDate");

-- RenameIndex
ALTER INDEX "Submission_normalizedText_trgm_idx" RENAME TO "Submission_normalizedText_idx";

