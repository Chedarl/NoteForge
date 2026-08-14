-- AlterEnum
ALTER TYPE "Discipline" ADD VALUE 'RECOVERY_COACH';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'FIELD_AGENT';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "authUserId" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "FieldLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FieldLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FieldLink_tokenHash_key" ON "FieldLink"("tokenHash");

-- CreateIndex
CREATE INDEX "FieldLink_practiceId_revokedAt_idx" ON "FieldLink"("practiceId", "revokedAt");

-- CreateIndex
CREATE INDEX "FieldLink_agentId_idx" ON "FieldLink"("agentId");

-- CreateIndex
CREATE INDEX "FieldLink_createdById_idx" ON "FieldLink"("createdById");

-- AddForeignKey
ALTER TABLE "FieldLink" ADD CONSTRAINT "FieldLink_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldLink" ADD CONSTRAINT "FieldLink_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldLink" ADD CONSTRAINT "FieldLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

