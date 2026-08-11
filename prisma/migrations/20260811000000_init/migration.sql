-- NoteForge initial schema.
--
-- pg_trgm comes first because near-duplicate detection depends on it and a
-- migration that creates the index before the extension simply fails. It ships
-- with Supabase's Postgres, so this is an enable, not an install.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'SPECIALIST', 'THERAPIST');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'DISCHARGED', 'TRANSFERRED', 'DECEASED');

-- CreateEnum
CREATE TYPE "SubmissionKind" AS ENUM ('STRUCTURED', 'PHOTO');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('SOAP', 'DAP', 'BIRP', 'NARRATIVE');

-- CreateEnum
CREATE TYPE "SubmissionState" AS ENUM ('RECEIVED', 'NEEDS_VERIFY', 'QUEUED', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FlagKind" AS ENUM ('DUPLICATE', 'NEAR_DUPLICATE', 'CONFLICT', 'STATUS_BLOCK', 'LOW_CONFIDENCE');

-- CreateEnum
CREATE TYPE "FlagResolution" AS ENUM ('OPEN', 'DISMISSED_DUPLICATE', 'KEPT_BOTH', 'MARKED_UPDATE', 'NEEDS_CLARIFICATION', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NoteState" AS ENUM ('DRAFT', 'IN_REVIEW', 'SIGNED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "TagKind" AS ENUM ('GOAL_PROGRESS', 'GOAL_STALLED', 'RISK', 'ENGAGEMENT_DROP');

-- CreateTable
CREATE TABLE "Practice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "slaHours" INTEGER NOT NULL DEFAULT 48,
    "staleDays" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Practice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "practiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientCode" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "birthYear" INTEGER,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedById" TEXT,
    "primaryTherapistId" TEXT,
    "lastEncounterAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientStatusEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fromStatus" "ClientStatus",
    "toStatus" "ClientStatus" NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusConfirmation" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "askedStatus" "ClientStatus" NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "kind" "SubmissionKind" NOT NULL,
    "templateKind" "TemplateKind" NOT NULL DEFAULT 'SOAP',
    "state" "SubmissionState" NOT NULL DEFAULT 'RECEIVED',
    "encounterDate" TIMESTAMP(3) NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "rawText" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL DEFAULT '',
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionPage" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "ocrText" TEXT,
    "ocrBlocks" JSONB,
    "ocrConfidence" DOUBLE PRECISION,
    "ocrProvider" TEXT,
    "verifiedText" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionFlag" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "relatedSubmissionId" TEXT,
    "kind" "FlagKind" NOT NULL,
    "score" DOUBLE PRECISION,
    "detail" TEXT,
    "resolution" "FlagResolution" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "templateKind" "TemplateKind" NOT NULL,
    "body" JSONB NOT NULL DEFAULT '{}',
    "state" "NoteState" NOT NULL DEFAULT 'DRAFT',
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "authoredById" TEXT,
    "signedById" TEXT,
    "signedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteTag" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "kind" "TagKind" NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Practice_code_key" ON "Practice"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_practiceId_role_idx" ON "User"("practiceId", "role");

-- CreateIndex
CREATE INDEX "Client_practiceId_status_idx" ON "Client"("practiceId", "status");

-- CreateIndex
CREATE INDEX "Client_practiceId_primaryTherapistId_idx" ON "Client"("practiceId", "primaryTherapistId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_practiceId_clientCode_key" ON "Client"("practiceId", "clientCode");

-- CreateIndex
CREATE INDEX "ClientStatusEvent_clientId_createdAt_idx" ON "ClientStatusEvent"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "StatusConfirmation_practiceId_respondedAt_idx" ON "StatusConfirmation"("practiceId", "respondedAt");

-- CreateIndex
CREATE INDEX "StatusConfirmation_clientId_idx" ON "StatusConfirmation"("clientId");

-- CreateIndex
CREATE INDEX "Submission_practiceId_state_createdAt_idx" ON "Submission"("practiceId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_clientId_encounterDate_idx" ON "Submission"("clientId", "encounterDate");

-- CreateIndex
CREATE INDEX "Submission_practiceId_contentHash_idx" ON "Submission"("practiceId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionPage_submissionId_pageNumber_key" ON "SubmissionPage"("submissionId", "pageNumber");

-- CreateIndex
CREATE INDEX "SubmissionFlag_submissionId_resolution_idx" ON "SubmissionFlag"("submissionId", "resolution");

-- CreateIndex
CREATE INDEX "SubmissionFlag_kind_resolution_idx" ON "SubmissionFlag"("kind", "resolution");

-- CreateIndex
CREATE UNIQUE INDEX "Note_submissionId_key" ON "Note"("submissionId");

-- CreateIndex
CREATE INDEX "Note_practiceId_state_idx" ON "Note"("practiceId", "state");

-- CreateIndex
CREATE INDEX "Note_clientId_createdAt_idx" ON "Note"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteTag_noteId_idx" ON "NoteTag"("noteId");

-- CreateIndex
CREATE INDEX "NoteTag_kind_createdAt_idx" ON "NoteTag"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_practiceId_createdAt_idx" ON "AuditLog"("practiceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_primaryTherapistId_fkey" FOREIGN KEY ("primaryTherapistId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientStatusEvent" ADD CONSTRAINT "ClientStatusEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientStatusEvent" ADD CONSTRAINT "ClientStatusEvent_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusConfirmation" ADD CONSTRAINT "StatusConfirmation_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusConfirmation" ADD CONSTRAINT "StatusConfirmation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusConfirmation" ADD CONSTRAINT "StatusConfirmation_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPage" ADD CONSTRAINT "SubmissionPage_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPage" ADD CONSTRAINT "SubmissionPage_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFlag" ADD CONSTRAINT "SubmissionFlag_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFlag" ADD CONSTRAINT "SubmissionFlag_relatedSubmissionId_fkey" FOREIGN KEY ("relatedSubmissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFlag" ADD CONSTRAINT "SubmissionFlag_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authoredById_fkey" FOREIGN KEY ("authoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Trigram index over the normalised submission text.
--
-- This is what makes "has anyone already given us this?" a sub-second question
-- instead of a table scan that gets slower every week. GIN rather than GiST:
-- the table is written once per encounter and read on every single intake, so
-- the slower build and larger index buy the lookup speed we actually want.
CREATE INDEX "Submission_normalizedText_trgm_idx"
  ON "Submission" USING GIN ("normalizedText" gin_trgm_ops);
