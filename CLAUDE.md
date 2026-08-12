# NoteForge — orientation

Read this first. It exists so a session starting cold does not re-derive decisions that
have already been made, or re-litigate ones that were made deliberately.

## What this product is, in one paragraph

An information-collection layer sitting between clinicians (social case workers and nurse
practitioners) and the people who write their clinical notes. Clinicians submit
structured, session-dated information about a client; the platform compares it against
what was submitted before, refuses submissions against clients who are discharged or
deceased, and exports clean, consistently-labelled material for note writers and
downstream AI tools to work from.

**It does not write notes.** It does not produce SIRP, BIRP, Psych Eval or anything else,
it does not replace clinical judgement, and it does not push to Credible or ICANotes.
See `docs/REQUIREMENTS.md` §6 — that boundary is the client's, stated explicitly, and
nothing should quietly cross it.

## Rules that are not up for renegotiation

These are load-bearing. Changing one is a product decision, not a refactor.

0. **Every new way in goes through `submitEncounter`.** There are now two intake
   surfaces — the structured form at `/t/new` and the one-box quick update at
   `/t/write` — and there will be more. They are all thin surfaces over the same
   door. A path that writes a `Submission` directly would bypass the guardrail,
   the duplicate detector and the audit trail in one step, and it would look
   entirely reasonable in review. Do not add one.
1. **The status guardrail runs server-side at write time.** `src/lib/clients/guard.ts` is
   the single enforcement point and every intake path goes through it. Not form
   validation — a form is stale the moment it loads, and "the client was active this
   morning and was marked deceased at lunchtime" is the exact failure this product was
   built to stop.
2. **A refused submission is kept, never discarded.** State `BLOCKED` plus a
   `STATUS_BLOCK` flag. The clinician's work survives, someone can reconcile it, and the
   count is the status-accuracy figure on the dashboard.
3. **A machine may propose; only a named human commits.** No code path signs a note,
   resolves a flag, marks a page verified, or changes a client status on its own. OCR
   suggests, the drafter suggests, the duplicate classifier suggests. Adding an automatic
   commit anywhere removes the reason a practice can defend using this.
4. **Nothing is merged or deleted automatically.** Duplicate detection produces flags.
   Resolving one sets `SUPERSEDED`, never a delete.
5. **The client code identifies; the name confirms.** Every heading, URL, filename and
   log line leads with `RVN-0142`. Names are encrypted at rest and are opt-in on export.
6. **Note text never reaches a log.** `src/lib/redact.ts` replaces clinical fields with a
   length marker. Error paths carry ids and states.
7. **Every AI call degrades to null, never to an error page.** See the three rules at the
   top of `src/lib/ai/kimi.ts`. With no `KIMI_API_KEY` the whole product still works — a
   page just gets typed by hand, which is the process this replaces.

## Where things are

```
prisma/schema.prisma       the whole data model, heavily commented — read this first
src/lib/clients/guard.ts   the status rule
src/lib/clients/labels.ts  client-safe status labels (guard.ts is server-only)
src/lib/clients/identity.ts decrypt + display helpers ("Maria D.")
src/lib/crypto/field.ts    AES-256-GCM column encryption
src/lib/intake/submit.ts   the door every submission comes through
src/lib/intake/templates.ts current note templates + completeness
src/lib/intake/disciplines.ts SCW / NP and which templates each sees
src/lib/dedupe/            normalise → compare → detect, cheapest layer first
src/lib/ai/                kimi client, OCR reader, pair classifier, drafter
src/lib/export/            the ZIP bundle + a dependency-free ZIP writer
src/lib/export/pdf.tsx     the §5 submission PDF — read the style comments before editing
src/lib/export/submissionPdf.ts assembles the PDF from the database; pdf.tsx stays pure
src/lib/export/changes.ts  "what changed since last submission", derived and not judged
src/lib/whatsapp/send.ts   sends the PDF to the note writer — read the header first
src/lib/intake/quickActions.ts the write-and-send path, thin over submitEncounter
src/lib/clients/resolve.ts a typed name finds or creates the client — read the header
src/lib/export/rosterPdf.tsx the caseload as a document — who is still open
src/lib/clients/roster.ts  builds and sends the client list
src/app/api/health/route.ts is this deployment wired up? booleans, never values
src/lib/insights/          metrics as live Prisma aggregates
src/app/t/                 clinician portal (mobile-first)
src/app/s/                 internal workspace: queue, verify, note, download, insights, audit
src/app/confirm/           the one unauthenticated page — signed single-purpose links
```

## Conventions

- **Server-only vs client-safe.** Anything touching the database, a key or a secret gets
  `import "server-only"`. Constants a client component needs (status labels, the OCR
  confidence gate, discipline labels) live in their own module — `labels.ts`,
  `confidence.ts`, `disciplines.ts` — and are re-exported from the server module. Import
  a `server-only` module from a `"use client"` component and the build fails with a
  confusing error; that is what those splits are for.
- **Practice scoping.** Every query filters on `practiceId`. A foreign id must be a
  not-found, never an error that confirms the row exists.
- **Comments explain why, not what.** The codebase is commented for a reader deciding
  whether a decision was deliberate. Match that; do not strip it back to `// set status`.
- **Audit reads, not just writes.** `client.viewed`, `page.viewed`, `export.downloaded`.

## Running it

```bash
npm install
npx prisma generate
npm run dev
```

### Testing without Supabase

There is no need for a Supabase project to work on this. Postgres 16 is available in the
container and both migrations plus the seed are verified against it:

```bash
export PATH=/usr/lib/postgresql/16/bin:$PATH
useradd -m pg 2>/dev/null; mkdir -p /home/pg/pgdata; chown -R pg /home/pg
su pg -c "PATH=/usr/lib/postgresql/16/bin:\$PATH initdb -D /home/pg/pgdata -U postgres --auth=trust"
su pg -c "PATH=/usr/lib/postgresql/16/bin:\$PATH pg_ctl -D /home/pg/pgdata -l /home/pg/pgdata/server.log -o '-p 5433 -k /tmp' -w start"
psql -h /tmp -p 5433 -U postgres -c "CREATE DATABASE noteforge;" -c "CREATE DATABASE shadow;"
```

Then in `.env`:

```
DATABASE_URL="postgresql://postgres@localhost:5433/noteforge?schema=public&host=/tmp"
DIRECT_URL="postgresql://postgres@localhost:5433/noteforge?schema=public&host=/tmp"
FIELD_ENCRYPTION_KEY="local-dev-only-key-not-for-production-use-0123456789"
```

`npx prisma migrate deploy && npx prisma db seed` and you have a working practice.

**Do not skip this.** Two real bugs in the export were found only by running it against a
real database and unzipping the result — a type-check and a build both passed while every
exported section read `_not recorded_`.

To run server-only code in a script: `npx tsx --conditions=react-server <file>`, and put
the file inside the project so `@/` and `@prisma/client` resolve.

### Migrations run themselves on deploy

`npm run build` runs `scripts/migrate-on-deploy.mjs` between `prisma generate`
and `next build`, so the database serving a deployment is migrated by that same
deployment. This exists because the two went out of step in production and
stayed there: code shipped on every push, migrations only when somebody
remembered. Three separate screens died with blank server errors before the
cause was found, and each looked like a different bug.

A failed migration **warns loudly and lets the build continue**. Blocking every
deployment on a database hiccup would also block the deployment that fixes it,
and the app already detects an out-of-date schema and explains it — `/api/health`
reports `schemaUpToDate`, and the write, signup and settings screens each say so
rather than crashing. Without `DIRECT_URL` it skips entirely, so building
locally does not migrate anything as a side effect.

### Migrations

`pg_trgm` and the GIN trigram index are declared in `schema.prisma` (via the
`postgresqlExtensions` preview feature), not hand-written into SQL. That is deliberate:
when the index lived only in a migration, every subsequent `migrate diff` proposed
dropping it. Generate new migrations with a shadow database:

```bash
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres@localhost:5433/shadow?schema=public&host=/tmp" --script
```

## Verify before claiming done

`npm run lint`, `npm run typecheck`, `npm run build` — all three, all clean. Then actually
exercise the change against the local database. A green build says nothing about whether
the export contains the right fields.

## Environment constraints seen so far

- **Supabase is blocked by the session's egress policy** in the environment used up to
  2026-08-11: `api.supabase.com`, `supabase.com` and raw TCP to the pooler all refused.
  If it is still blocked, do not route around it — say so. If HTTPS to `api.supabase.com`
  and `*.supabase.co` is allowed, the whole deployment can be done over HTTPS without a
  raw Postgres connection: create the project, run both migrations and the seed through
  `POST /v1/projects/{ref}/database/query`, create the four auth accounts via the auth
  admin API, and create the two private buckets via the storage API.
- **The GitHub app cannot create repositories or change repo settings** (403). Repository
  visibility is the user's to change.

## State of play

Built, and verified against a real database: the data model, status guardrail, duplicate
and contradiction detection, OCR and the verification workspace, the note production
workspace, insights, audit, encrypted client names, disciplines, and the ZIP export.

`docs/REQUIREMENTS.md` holds the client's own specification with a status against each
clause. Everything marked **TO BUILD** there is the current work.

## The §5 PDF, and a trap that costs an afternoon

`npm run verify:pdf` renders the real layout from synthetic data with no database and no
Next.js. Use it after any change to `pdf.tsx`, because two failures in
`@react-pdf/renderer` are completely silent:

1. `lineHeight` on a `Page` style makes every `fixed` element carrying a `render`
   callback disappear.
2. A `<Text render={…}>` nested inside an absolutely-positioned `fixed` View drops that
   whole View.

No error, no warning, no gap in the layout — so lint, typecheck and build all stay green
while the running footer is simply absent from the file. Set line height on text styles,
and keep `render` on a top-level element. Both are commented at the point of use.

`pdf.tsx` is deliberately **not** `server-only`: it is pure, and the mark would pull in
the `react-server` condition, which breaks react-pdf's reconciler and would make the
verification script impossible. `submissionPdf.ts` is the half that touches Prisma, and
that one is marked.

The general lesson is the one already in this file: open the artefact.
