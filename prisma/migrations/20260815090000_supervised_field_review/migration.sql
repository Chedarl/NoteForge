-- Supervised review of field updates.
--
-- A recovery coach's account of a doorstep visit now stops with the clinician
-- who gave them the link, and reaches documentation only once she has read it
-- and put her name to it.
--
-- Every column here is nullable and the new enum value is additive, so this
-- migration is safe to apply to a live database with work in flight: existing
-- submissions have no reviewer and stay in whatever state they are in.

-- AlterEnum
ALTER TYPE "SubmissionState" ADD VALUE IF NOT EXISTS 'AWAITING_REVIEW';

-- AlterTable: who must read this before it can be written up, and what they said.
ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "reviewerId" TEXT;
ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;

-- AlterTable: the clinician answerable for what arrives through a link.
ALTER TABLE "FieldLink" ADD COLUMN IF NOT EXISTS "supervisorId" TEXT;

-- Existing links predate supervision. Whoever created one is the person who
-- handed it out, so they are the right supervisor for it; leaving these null
-- would send their workers' updates straight past review.
UPDATE "FieldLink" SET "supervisorId" = "createdById" WHERE "supervisorId" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Submission_reviewerId_reviewedAt_idx" ON "Submission"("reviewerId", "reviewedAt");
CREATE INDEX IF NOT EXISTS "FieldLink_supervisorId_idx" ON "FieldLink"("supervisorId");

-- AddForeignKey: SET NULL on both, because a clinician leaving the practice
-- must never delete a client contact record or a worker's link history.
ALTER TABLE "Submission" DROP CONSTRAINT IF EXISTS "Submission_reviewerId_fkey";
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FieldLink" DROP CONSTRAINT IF EXISTS "FieldLink_supervisorId_fkey";
ALTER TABLE "FieldLink" ADD CONSTRAINT "FieldLink_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
