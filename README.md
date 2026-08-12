# NoteForge

A controlled **intake → verification → production → insight** layer that sits between
therapists and finished clinical notes.

Practices can create their own owner portal from `/signup`, invite clinicians and note
specialists into role-specific workspaces, and hand a submitted encounter to a note
writer as an expiring PDF link opened directly in WhatsApp.

It is not an EHR and it is not a replacement for one. It solves the problem that sits
*upstream* of the note: fragmented, delayed, badly-photographed material arriving from
several clinicians, about clients whose status changed weeks ago and nobody said.

## The four problems it attacks

| Problem | What NoteForge does |
| --- | --- |
| Handwritten pages, photographed badly | Structured digital intake as the fast path; photo upload with OCR and a side-by-side human verification step for the paper holdouts |
| The same session handed over twice | Hash, date-proximity and token-overlap detection, escalating to a model only for the pairs a person genuinely needs help with |
| Notes typed against discharged, transferred or deceased clients | A server-side guardrail that refuses the write, keeps the submission, flags it, and tells the practice — plus a daily sweep that asks about clients who have gone quiet |
| Getting the material back out to write notes from | A per-client or batch download: one folder per client, one file per session date, in JSON and Markdown, each carrying the session date, the clinician's discipline and the client's status |
| Fast handoff to the note writer | A server-generated PDF in private storage, available through a hashed, expiring, download-limited link prefilled into WhatsApp |
| "You just type notes" | An insights layer measuring turnaround, completeness, duplicates caught and status accuracy, plus clinical signals a specialist explicitly tagged |

## What is deliberately *not* here

- **No full names, no dates of birth.** A client is a practice-assigned code, a first
  name, a surname *initial* and at most a birth year. The first name is encrypted at the
  column level, so it is ciphertext in the database, in a backup and in a stolen dump —
  verified by dumping the table and grepping it. The code is what identifies; the name is
  there so a person can confirm they have the right record. See [SECURITY.md](SECURITY.md).
- **No automatic decisions.** Nothing in this codebase signs a note, resolves a
  duplicate, or changes a client status on its own. The machine reads, suggests and
  classifies; a named human commits, and the name and time are recorded.
- **No vector database.** Duplicate detection is Postgres and token overlap. At this
  volume it works, it is instant, it is free, and the note text never leaves the
  database to be embedded.

## The fast path

Sign up, pick a client, and write what you discussed in one box. It is saved with the date
and time it happened, turned into a PDF straight away, and sent to whoever writes the
notes.

That path is deliberately thin over the same machinery as everything else: the status
guardrail still refuses a note against a discharged or deceased client, duplicates are
still detected, and everything is still audited. Simple to use is not the same as simple
underneath.

WhatsApp is not a protected channel. Documents go out identified by client code only
unless the clinician asks for the name, and an expiring share link is available as the
safer alternative. See [SECURITY.md](SECURITY.md).

## The download

This is what the platform is for. NoteForge collects and cleans the material; the notes
get written from what comes out of here.

Pick a client or a date range on **Download**, and you get a ZIP:

```
README.md                    what is inside, and what to check before writing from it
sessions.json                everything, structured — for anything automated
RVN-0142/_client.md          status, clinician, list of sessions
RVN-0142/2026-08-04.md       one file per session, ready to read or paste
RVN-0142/2026-08-11.md
```

Every session file carries its **date**, the **discipline** of the clinician who recorded
it (Social Case Worker, Nurse Practitioner, …), the template used, and the client's
current status — so a note can be written from a single file without opening another.
Unresolved duplicate and contradiction flags are quoted at the top of the file they
affect.

Client names are **off by default** and are a deliberate, audited opt-in: the codes alone
are enough to match against your own records, and an export is the moment material leaves
a controlled environment.

## Disciplines

Each clinician records once whether they are a Social Case Worker, Nurse Practitioner,
Therapist or Counsellor. That does two things: it selects which intake templates they are
offered, so the right information is collected — a nursing encounter has its own
`Medication` field, case management has `Actions taken` and `Referrals` — and it is
stamped on every submission and carried into every export, so whatever writes the note
knows what kind of note it is writing.

Submissions are refused until it is set, because a submission without it produces an
export that cannot be turned into the right kind of note.

## Stack

- Next.js 15 (App Router, TypeScript) + Tailwind v4
- Prisma + PostgreSQL (Supabase)
- Supabase Auth (staff login, MFA-capable) and Supabase Storage (private buckets)
- Kimi K3 vision for handwriting OCR and draft assistance — **entirely optional**,
  behind a one-file provider interface in `src/lib/ai/reader.ts`
- Resend for status alerts and confirmation requests — also optional

Everything above runs on free tiers with no custom domain. See [DEPLOY.md](DEPLOY.md).

## Running it

```bash
npm install
cp .env.example .env.local     # fill in the Supabase values
npx prisma migrate deploy      # or: npx prisma migrate dev
npx prisma db seed
npm run dev
```

The seed creates a working practice rather than an empty shell — eight clients across
every status, a near-duplicate pair, a contradiction about risk, and a note somebody
tried to file against a client who had died. All four are reachable in the UI within a
minute.

Sign in as any of:

| Email | Role | Sees |
| --- | --- | --- |
| `owner@noteforge.test` | Owner | Everything |
| `specialist@noteforge.test` | Specialist | The queue, all clients, the download, insights, audit |
| `caseworker@noteforge.test` | Social Case Worker | Their own clients only |
| `nurse@noteforge.test` | Nurse Practitioner | Their own clients only |

Password: whatever you set as `SEED_PASSWORD` (default `ChangeMe!2026`).

### The three things worth trying first

1. **As `nurse@noteforge.test`**, write a note for `RVN-0108`. It is refused, with the
   status, the date and the reason — and your text is kept, not thrown away.
2. **As `specialist@noteforge.test`**, open the queue's *Flagged* tab. One near-duplicate
   and one contradiction about a risk assessment, each with the earlier submission
   attached so the decision can be made without opening another tab.
3. **Open Download**, pick the last 90 days, and unzip it. Compare `RVN-0103/`'s nursing
   session against `RVN-0102/`'s case-management one — same platform, different shape,
   each labelled with the discipline that produced it.

## How it is laid out

```
prisma/schema.prisma      the whole product in one file, heavily commented
src/lib/clients/guard.ts  the status rule — one enforcement point, no second way in
src/lib/intake/submit.ts  the door every submission comes through
src/lib/dedupe/           normalise → compare → detect, cheapest layer first
src/lib/ai/               kimi client, OCR reader, pair classifier, note drafter
src/lib/export/           the download — bundle builder and a dependency-free ZIP writer
src/lib/crypto/field.ts   AES-256-GCM column encryption for client names
src/lib/insights/         metrics, as live Prisma aggregates
src/app/t/                therapist portal  (mobile-first)
src/app/s/                specialist workspace (queue, verify, note, insights, audit)
src/app/admin/            platform account and access administration (no clinical text)
src/app/signup/           self-service practice-owner provisioning
src/app/share/            public expiring capability route for private PDFs
src/app/confirm/          the one unauthenticated page — signed single-purpose links
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | `prisma generate` then a production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed the demo practice |

## Status

Phase 1 plus the starter insight dashboard, complete and usable end to end. What is not
here yet: therapist-facing exports, practice-management integrations, and the compliance
work described in [SECURITY.md](SECURITY.md) that must happen before real identified
clinical material is entered.