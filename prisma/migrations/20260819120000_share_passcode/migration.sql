-- A six-digit code the recipient types before a shared PDF is released.
--
-- Every column is nullable or defaulted, so this applies to a live database
-- with links already in flight: those keep working exactly as they did, as
-- bearer links, because `passcodeHash` is null for all of them.
ALTER TABLE "ShareLink" ADD COLUMN "passcodeHash" TEXT;
ALTER TABLE "ShareLink" ADD COLUMN "passcodeAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShareLink" ADD COLUMN "passcodeLockedAt" TIMESTAMP(3);
