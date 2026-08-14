-- CreateTable
CREATE TABLE "PracticeNeed" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hint" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeNeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeNeed_practiceId_retiredAt_idx" ON "PracticeNeed"("practiceId", "retiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeNeed_practiceId_needId_key" ON "PracticeNeed"("practiceId", "needId");

-- AddForeignKey
ALTER TABLE "PracticeNeed" ADD CONSTRAINT "PracticeNeed_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

