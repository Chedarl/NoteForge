-- Shareable documents that are not a single submission.
--
-- A client list is a document about a caseload rather than an encounter, so it
-- has no submission to point at. Forcing one would have meant borrowing an
-- unrelated submission's id to satisfy the foreign key, which puts a false
-- statement into the audit trail. Both changes are additive: existing rows keep
-- their submission and take the default kind.

ALTER TABLE "ShareLink"
  ADD COLUMN "documentKind" TEXT NOT NULL DEFAULT 'submission',
  ALTER COLUMN "submissionId" DROP NOT NULL;
