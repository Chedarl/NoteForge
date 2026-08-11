# NoteForge

A controlled **intake → verification → production → insight** layer that sits between
therapists and finished clinical notes.

It is not an EHR and it is not a replacement for one. It solves the problem that sits
*upstream* of the note: fragmented, delayed, badly-photographed material arriving from
several clinicians, about clients whose status changed weeks ago and nobody said.

## The four problems it attacks

| Problem | What NoteForge does |
| --- | --- |
| Handwritten pages, photographed badly | Structured digital intake as the fast path; photo upload with OCR and a side-by-side human verification step for the paper holdouts |
| The same session handed over twice | Hash, date-proximity and token-overlap detection, escalating to a model only for the pairs a person genuinely needs help with |
| Notes typed against discharged, transferred or deceased clients | A server-side guardrail that refuses the write, keeps the submission, flags it, and tells the practice — plus a daily sweep that asks about clients who have gone quiet |
| "You just type notes" | An insights layer measuring turnaround, completeness, duplicates caught and status accuracy, plus clinical signals a specialist explicitly tagged |

## What is deliberately *not* here

- **No client names, no full dates of birth.** A client is a practice-assigned code,
  initials and at most a birth year. See [SECURITY.md](SECURITY.md) — this is a design
  decision that makes a free-tier deployment defensible, not an oversight.
- **No automatic decisions.** Nothing in this codebase signs a note, resolves a
  duplicate, or changes a client status on its own. The machine reads, suggests and
  classifies; a named human commits, and the name and time are recorded.
- **No vector database.** Duplicate detection is Postgres and token overlap. At this
  volume it works, it is instant, it is free, and the note text never leaves the
  database to be embedded.

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
| `specialist@noteforge.test` | Specialist | The production queue, all clients, insights, audit |
| `therapist1@noteforge.test` | Therapist | Their own clients only |
| `therapist2@noteforge.test` | Therapist | Their own clients only |

Password: whatever you set as `SEED_PASSWORD` (default `ChangeMe!2026`).

### The three things worth trying first

1. **As Dr Marcus Bell** (`therapist2`), write a note for `RVN-0108`. It is refused, with
   the status, the date and the reason — and your text is kept, not thrown away.
2. **As Sam Whitfield** (`specialist`), open the queue's *Flagged* tab. One near-duplicate
   and one contradiction about a risk assessment, each with the earlier submission
   attached so the decision can be made without opening another tab.
3. **Open Insights.** The status-block rate is the guardrail's own scoreboard: every one
   of those is a note that would otherwise have been typed against the wrong record.

## How it is laid out

```
prisma/schema.prisma      the whole product in one file, heavily commented
src/lib/clients/guard.ts  the status rule — one enforcement point, no second way in
src/lib/intake/submit.ts  the door every submission comes through
src/lib/dedupe/           normalise → compare → detect, cheapest layer first
src/lib/ai/               kimi client, OCR reader, pair classifier, note drafter
src/lib/insights/         metrics, as live Prisma aggregates
src/app/t/                therapist portal  (mobile-first)
src/app/s/                specialist workspace (queue, verify, note, insights, audit)
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
