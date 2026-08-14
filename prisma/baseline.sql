-- NoteForge: baseline an existing database into Prisma's migration ledger.
--
-- Run once, in the Supabase SQL editor. It is safe to run twice.
--
-- Why this is needed: the schema was created by running the migration SQL
-- directly, which does not write Prisma's `_prisma_migrations` ledger. Prisma
-- then sees tables it has no record of creating and refuses to touch the
-- database at all (P3005) — deliberately, so it cannot damage data it does not
-- understand.
--
-- This records the migrations that are ALREADY present, deciding each one by
-- looking for something it created. It creates no tables and alters no data; a
-- migration whose objects are absent is left unmarked so that the next
-- deployment applies it normally.

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id                      varchar(36) PRIMARY KEY,
    checksum                varchar(64)  NOT NULL,
    finished_at             timestamptz,
    migration_name          varchar(255) NOT NULL,
    logs                    text,
    rolled_back_at          timestamptz,
    started_at              timestamptz  NOT NULL DEFAULT now(),
    applied_steps_count     integer      NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
SELECT gen_random_uuid()::text, 'baselined-by-hand', now(), m.name, 1
FROM (VALUES
    -- migration name, and a thing that migration created
    ('20260811000000_init',                              to_regclass('public."Client"')    IS NOT NULL),
    ('20260811120000_client_names_and_discipline',       EXISTS (SELECT 1 FROM information_schema.columns
                                                                 WHERE table_schema='public' AND table_name='Client'
                                                                   AND column_name='givenNameEnc')),
    ('20260811170000_self_service_portals_and_whatsapp_shares',
                                                         to_regclass('public."ShareLink"') IS NOT NULL),
    ('20260812130000_shareable_documents_beyond_submissions',
                                                         EXISTS (SELECT 1 FROM information_schema.columns
                                                                 WHERE table_schema='public' AND table_name='ShareLink'
                                                                   AND column_name='documentKind'))
) AS m(name, already_present)
WHERE m.already_present
  AND NOT EXISTS (SELECT 1 FROM "_prisma_migrations" e WHERE e.migration_name = m.name);

-- What the ledger now says. Anything absent from this list will be applied by
-- the next deployment.
SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY migration_name;
