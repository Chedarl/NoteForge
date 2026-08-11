-- Self-service practice portals, explicit platform administration, and secure
-- PDF handoff links.

-- AlterTable
ALTER TABLE "Practice"
ADD COLUMN "noteWriterWhatsApp" TEXT;

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Keep extensions out of the Data API's exposed public schema. Supabase adds
-- `extensions` to the database search path, so the existing trigram index and
-- future pg_trgm operations continue to resolve normally.
CREATE SCHEMA IF NOT EXISTS "extensions";
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  END IF;
END
$$;

-- The existing export bucket is private. Keep its previous ZIP support while
-- allowing the generated WhatsApp handoff PDFs and future CSV exports. A plain
-- PostgreSQL database (including CI) has no Supabase Storage schema, so execute
-- the upsert only when that managed table exists.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE $bucket$
      INSERT INTO storage.buckets (
        id,
        name,
        public,
        file_size_limit,
        allowed_mime_types
      )
      VALUES (
        'note-exports',
        'note-exports',
        false,
        52428800,
        ARRAY['application/pdf', 'application/zip', 'text/csv']::text[]
      )
      ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types
    $bucket$;
  END IF;
END
$$;

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "createdById" TEXT,
    "storagePath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "maxDownloads" INTEGER NOT NULL DEFAULT 10,
    "lastDownloadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ShareLink_practiceId_submissionId_createdAt_idx"
ON "ShareLink"("practiceId", "submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "ShareLink_submissionId_idx" ON "ShareLink"("submissionId");

-- CreateIndex
CREATE INDEX "ShareLink_createdById_idx" ON "ShareLink"("createdById");

-- CreateIndex
CREATE INDEX "ShareLink_expiresAt_revokedAt_idx"
ON "ShareLink"("expiresAt", "revokedAt");

-- Cover existing foreign keys used by cascades and account suspension/admin
-- queries. These are deliberately single-column indexes; a composite whose
-- leading column is practiceId does not cover a lookup by the foreign key.
CREATE INDEX "Client_primaryTherapistId_idx" ON "Client"("primaryTherapistId");
CREATE INDEX "Client_statusChangedById_idx" ON "Client"("statusChangedById");
CREATE INDEX "ClientStatusEvent_changedById_idx" ON "ClientStatusEvent"("changedById");
CREATE INDEX "StatusConfirmation_therapistId_idx" ON "StatusConfirmation"("therapistId");
CREATE INDEX "Submission_submittedById_idx" ON "Submission"("submittedById");
CREATE INDEX "Submission_supersedesId_idx" ON "Submission"("supersedesId");
CREATE INDEX "SubmissionPage_verifiedById_idx" ON "SubmissionPage"("verifiedById");
CREATE INDEX "SubmissionFlag_relatedSubmissionId_idx" ON "SubmissionFlag"("relatedSubmissionId");
CREATE INDEX "SubmissionFlag_resolvedById_idx" ON "SubmissionFlag"("resolvedById");
CREATE INDEX "Note_authoredById_idx" ON "Note"("authoredById");
CREATE INDEX "Note_signedById_idx" ON "Note"("signedById");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "ShareLink"
ADD CONSTRAINT "ShareLink_practiceId_fkey"
FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink"
ADD CONSTRAINT "ShareLink_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink"
ADD CONSTRAINT "ShareLink_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Supabase exposes the public schema through the Data API. The application uses
-- a server-side Prisma connection for all domain data, so these tables have no
-- direct browser policies and fail closed at the database boundary as well.
ALTER TABLE "Practice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientStatusEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StatusConfirmation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubmissionPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubmissionFlag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NoteTag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShareLink" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "ShareLink" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "ShareLink" FROM authenticated';
  END IF;
END
$$;

-- A Supabase-managed event trigger keeps RLS enabled on newly created public
-- tables. It does not need to be callable through PostgREST; remove those
-- grants when the helper exists, while keeping fresh non-Supabase databases
-- able to run this migration.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated';
    END IF;
  END IF;
END
$$;
