-- Safe mode: this practice never displays, prints or exports a client's name.
--
-- Additive and defaulted, so it applies to a live database with no downtime and
-- no backfill. The default is false because turning the control on is a
-- deliberate act by a practice that wants it — but note that the *resolver*
-- fails the other way: a practice row it cannot read at all resolves to safe
-- mode on, because "I could not find out what this practice permits" must never
-- print a name.
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "safeMode" BOOLEAN NOT NULL DEFAULT false;
