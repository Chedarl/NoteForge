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

**There is no full name and no date of birth.** A client is a practice-assigned code
(`RVN-0142`), a first name, a surname *initial*, and optionally a birth *year*. There is
no address, no phone number, no email, no identifying number of any kind. The mapping
from a code to a full identity lives in the practice's own EHR, where it already is and
where it is already covered.

**The first name is encrypted at the column level**, AES-256-GCM with a random IV per
value, key in the application environment and never in the database
(`src/lib/crypto/field.ts`). A leaked database password, a misconfigured backup, a
support engineer with production access or a SQL injection that reaches
`SELECT * FROM "Client"` all yield ciphertext. This was verified by dumping the table and
grepping it for seeded names — nothing.

Consequences worth knowing:

- Names cannot be searched or sorted by the database. Accepted: finding a client is by
  code, which is indexed and not sensitive; the name is for *confirming* the right one.
- Without `FIELD_ENCRYPTION_KEY` set, names are refused rather than stored in plaintext.
  Everything else works.
- Lose the key and the names are gone — and nothing else is. No code, note, submission,
  flag or audit row depends on them.

**Clinical text is encrypted at the column level too.** Not only the client's
name: `Submission.rawText`, `normalizedText` and `fields`, `Note.body`,
`SubmissionPage.ocrText` and `verifiedText`, `SubmissionFlag.detail`,
`Client.statusReason` and `ClientStatusEvent.reason` are all AES-256-GCM with a
random IV per value (`src/lib/crypto/text.ts`). A leaked database password, a
misconfigured backup or a support engineer with production access now yields
ciphertext for the narrative as well as the name.

This was previously listed here as blocked, on the grounds that the duplicate
detector searches the note text. **It does not.** `detectDuplicates` selects
candidates by `clientId` and an encounter-date window — indexed columns, no text
— takes at most eight rows and tokenises in memory. No query has ever read
`normalizedText`, and the pg_trgm index over it has been dropped.

Three things worth knowing:

- **Rows written before this change stay readable until backfilled.**
  `openText` passes non-envelope values through unchanged, so nothing breaks
  mid-rollout. `npm run encrypt:existing -- --commit` seals them; it is
  idempotent and safe to re-run.
- **`contentHash` is deliberately still a digest of the plaintext.** It is the
  exact-match layer of the detector and has to stay comparable with older rows.
  A digest of a whole document's sorted token bag is not invertible.
- **`npm run verify:at-rest` dumps the database and greps it.** That check is
  what found three of these columns — `SubmissionFlag.detail`,
  `Client.statusReason` and `ClientStatusEvent.reason` were all still plaintext
  after the obvious columns had been sealed, with lint, typecheck, build and the
  unit tests all green. It runs in CI.

**Exports do not include names by default.** The download is the moment material leaves
the controlled environment. Names are an explicit checkbox, the UI states what it makes
the bundle, and the audit trail records `export.downloaded_with_names` distinctly from
`export.downloaded`, so "did an identifiable bundle leave the system, and when" has an
answer.

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
- **WhatsApp PDF handoff** — the PDF remains in the private `note-exports` bucket. The
  WhatsApp message contains a random capability URL whose token is hashed in the
  database, expires after 24 hours by default, and stops after 10 downloads. Client
  names are excluded. WhatsApp receives the link, not direct storage credentials.
- **Row-level security** — RLS is enabled on every application table in the exposed
  `public` schema. There are no browser Data API policies for domain data; all access
  goes through server-side, role- and practice-scoped application code.
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
- **Exports** — two, both staff-only, both audited, both rate limited.
  - The metrics CSV is counts and durations: no client, no submission, no note text.
  - The session bundle (`/api/export`) is the source material. Practice-scoped, so a
    guessed client id from another tenant yields nothing. Names off by default, and the
    audit row records the date range, the counts, and whether names were included.

## WhatsApp document delivery

**Meta does not sign a BAA covering WhatsApp on any plan**, and the practice hands work
over on WhatsApp all day. Removing the channel would not make anything safer — it would
push the document into email, onto a memory stick, or back onto paper. So the channel
stays, and what travels over it changed.

**A link goes into the chat, never the document.** `sendLink` replaced `sendDocument` on
every path. Pushing the bytes put a clinical narrative onto Meta's infrastructure and
into a phone's cloud backup permanently — no expiry, no download ceiling, no way to
withdraw it. A link keeps the bytes in the practice's own bucket, where all three apply,
and what survives in a backup is a URL that has since stopped working. `sendDocument` is
still in the codebase, documented as not for clinical use.

**Possession of the message is not access to the note.** The link sits behind a six-digit
passcode (`src/lib/sharing/passcode.ts`), HMAC'd and bound to that link's own token, meant
to travel by a second route. Five wrong attempts and the link is finished, permanently.

So what Meta receives is a phone number, a timestamp and an opaque URL — no client code,
no name, no clinical content. The original decision to send the document itself is
recorded in `docs/REQUIREMENTS.md` §7a; this is the hardened form of it. What the code
does besides:

- Documents carry the **client code only** unless the clinician explicitly ticks the name
  box on that submission. Off by default, every time.
- The message caption is a client code and a date. Never note text — a WhatsApp preview
  appears on a lock screen.
- Every send is audited, and `submission.whatsapp_sent_with_names` is a distinct action
  from `submission.whatsapp_sent`. Failures are audited too.
- With no credentials configured the send returns `not_configured`, the submission and
  PDF still exist, and the clinician downloads it instead.

**The safer path is already built.** The tokenised, expiring `/share/[token]` link keeps
the document inside the system and only puts a URL in the chat. Making it the only route
is a change to one call site in `src/lib/intake/quickActions.ts`.

## What is not implemented

- Business Associate Agreements. Nothing in code can substitute. `docs/BAA.md` is the
  register: every third party, what reaches it, whether it will sign, and the order to
  deal with them in.
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

   Until then, **set `AI_DISABLED=1`** — it removes the vendor outright and costs
   nothing, because every AI call already degrades to null. Do not do this by deleting
   the key: two variable names are read (`KIMI_API_KEY`, `MOONSHOT_API_KEY`), so removing
   one leaves the vendor live while every screen looks as though it is gone. `/api/health`
   reports `modelVendor` so the state can be confirmed from outside.
3. Decide about drafting (`src/lib/ai/noteDraft.ts`) and pair classification
   (`src/lib/ai/classify.ts`). Both send note text to the model provider. Both degrade
   cleanly to nothing when `KIMI_API_KEY` is unset — the product still works, a person
   just does more of the reading.
4. Add retention rules and a deletion path, including cleanup of expired handoff PDFs.
5. Enforce MFA for every role, not just the staff ones.
6. Move `FIELD_ENCRYPTION_KEY` into a managed secret store with rotation, rather than a
   Vercel environment variable. Rotation needs a re-encryption pass; the version prefix
   (`v1:`) on every stored value exists so that pass can tell old from new.
7. Get a lawyer to read this list and the code that implements it.

## Reporting a problem

Open a private security advisory on the repository rather than a public issue.