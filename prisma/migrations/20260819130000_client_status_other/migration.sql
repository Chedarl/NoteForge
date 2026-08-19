-- The specification's sixth client status: "Other", with a free-text reason.
--
-- Additive, so every existing row is untouched and every existing query keeps
-- working. Nothing needs a default: no client becomes OTHER by this migration,
-- and the guard already refuses anything that is not ACTIVE.
ALTER TYPE "ClientStatus" ADD VALUE IF NOT EXISTS 'OTHER';
