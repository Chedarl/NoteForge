-- "Filed into the practice's own system" — the last step, which happens outside
-- this product and was therefore invisible to it.
--
-- DONE meant a note was produced. It never meant anybody entered it into
-- Credible or ICANotes, and from inside this system a note that was filed and
-- one that was forgotten looked identical.
--
-- Every column is nullable. Nothing existing is touched, and no submission
-- becomes processed by this migration.
ALTER TABLE "Submission" ADD COLUMN "processedAt" TIMESTAMP(3);
ALTER TABLE "Submission" ADD COLUMN "processedById" TEXT;
ALTER TABLE "Submission" ADD COLUMN "processedNoteVersion" INTEGER;
ALTER TABLE "Submission" ADD COLUMN "processedRef" TEXT;

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_processedById_fkey"
  FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Submission_practiceId_processedAt_idx" ON "Submission"("practiceId", "processedAt");
