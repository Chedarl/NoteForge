# Security and compliance posture

Read this before entering anything real.

## The short version

NoteForge is built to a HIPAA-*shaped* design: encryption in transit and at rest,
role-based access checked server-side on every request, MFA-capable authentication, an
append-only audit trail that covers reads as well as writes, data minimisation, and no
clinical text in logs.

**That is not the same as being HIPAA-compliant**, and on the free-tier deployment this
repository is set up for, it cannot be. Compliance is not a property of code. It is a
property of code *plus* signed agreements, and the three services this runs on will not
sign them for a free account:

| Service | Role | BAA on free tier |
| --- | --- | --- |
| Vercel | Hosting | No — requires Enterprise |
| Supabase | Database, auth, storage | No — requires a paid plan with the HIPAA add-on |
| Moonshot / Kimi | OCR and drafting | No |
| Resend | Email | No |

So: **do not put identified protected health information into a free-tier deployment.**

## What the design does about that

Rather than treat this as a blocker, the data model is built so that the free deployment
is genuinely defensible for a pilot.

**There is no name field.** A client is a practice-assigned code (`RVN-0142`), initials,
and optionally a birth *year*. There is no `fullName` column, no date of birth, no
address, no phone number, no email, no identifying number of any kind. The mapping from
a code to a person lives in the practice's own EHR, where it already is and where it is
already covered.

That is enough for a transcriber to be certain which record a note belongs to, and not
enough to identify anyone from a database dump.

**Note text is still sensitive.** De-identification reduces exposure; it does not
eliminate it. A session narrative can identify someone through its content alone. Treat
the free deployment as suitable for a pilot with synthetic or heavily redacted material,
not for production caseloads.

## What is implemented

- **Authentication** — Supabase Auth. Enable MFA for `OWNER` and `SPECIALIST` accounts in
  the Supabase dashboard; it is available on the free tier.
- **Authorization** — every page and route calls `requireRole`, which re-reads the `User`
  row on each request. Suspending an account takes effect on the next request rather than
  the next login. Middleware only checks "is somebody signed in"; it is a convenience, not
  the boundary.
- **Tenant isolation** — every query filters on `practiceId`. An id from another practice
  is a not-found, not a leak. Verify with the checks in the Verification section below.
- **Storage** — both buckets are private. There are no public URLs anywhere in the
  codebase. Reads go through `/api/media/[...path]`, which checks the object against the
  caller's practice, writes an audit row, and issues a 60-second signed URL.
- **Audit trail** — append-only, and covers reads (`client.viewed`, `page.viewed`,
  `insights.exported`) as well as writes. No code path updates or deletes an `AuditLog`
  row. There is no export button on the audit page, deliberately.
- **Logging** — `src/lib/redact.ts` masks secrets and replaces clinical field values with
  a length marker. Error paths carry ids and states, never note text.
- **Headers** — HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`
  (so a URL containing a client id never reaches a third party), and a `Permissions-Policy`
  granting only the camera and microphone the product actually uses.
- **Rate limiting** — on login and on signed-URL minting. In-memory and therefore
  per-instance; see the note in `src/lib/security/rateLimit.ts` about what that does and
  does not buy you.
- **Exports** — the only export is a CSV of operational counts and durations. No client,
  no submission, no note text. Audited.

## What is not implemented

- Business Associate Agreements. Nothing in code can substitute.
- Row-level security in Postgres. Isolation is enforced in the application layer. RLS
  would be defence in depth and is worth adding before production.
- Encryption of note text at the column level. Supabase encrypts at rest at the volume
  level; a compromised database credential still reads plaintext notes.
- Retention and deletion schedules. The schema keeps everything forever, which is right
  for audit and wrong for data minimisation past the practice's retention period.
- Separation of psychotherapy notes from progress notes as distinct record types. The
  insights layer respects the spirit of it — therapists see summaries only, never note
  text — but the schema does not yet model the distinction.
- Formal risk analysis, workforce training records, incident response plan.

## Before real PHI goes in

1. Move Vercel to Enterprise and Supabase to a paid plan with the HIPAA add-on. Sign both
   BAAs.
2. Replace the OCR provider with one under a BAA, or bring it in-house. This costs one
   file: implement `readHandwriting` in `src/lib/ai/reader.ts`. Nothing else in the
   codebase knows which engine is being used.
3. Decide about drafting (`src/lib/ai/noteDraft.ts`) and pair classification
   (`src/lib/ai/classify.ts`). Both send note text to the model provider. Both degrade
   cleanly to nothing when `KIMI_API_KEY` is unset — the product still works, a person
   just does more of the reading.
4. Add Postgres RLS policies mirroring the application's practice scoping.
5. Add retention rules and a deletion path.
6. Enforce MFA for every role, not just the staff ones.
7. Get a lawyer to read this list and the code that implements it.

## Reporting a problem

Open a private security advisory on the repository rather than a public issue.
