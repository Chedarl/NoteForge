# Requirements

The client's specification for the information-collection layer, with implementation
status against each clause. Received 2026-08-11.

Status key: **DONE** — built and verified. **PARTIAL** — some of it exists, the gap is
named. **TO BUILD** — not started.

Two answers the client gave that shape the work:

- Build the whole specification in one pass rather than staging it.
- Note writers produce **SIRP and BIRP both**, with a **psychiatric emphasis** — Psych
  Evaluation, Psych Follow-up and Therapy Session carry the most weight, so the mental
  status, risk assessment and medication sections matter most.

---

## The platform's job

1. Let authorised professionals (social case workers and nurse practitioners) securely
   submit structured, current information about their clients.
2. Compare each new submission against previous submissions for the same client.
3. Produce a clean, machine-readable **PDF** that the team or downstream AI tools consume
   to write notes in the required formats (SIRP, BIRP, Psych Eval, Psych Follow-up, Psych
   Therapy) for any target system (Credible, ICANotes, others).

---

## 1. User roles and login separation

| Clause | Status |
| --- | --- |
| Social Case Worker login | **DONE** — `Discipline.SOCIAL_CASE_WORKER` |
| Nurse Practitioner login | **DONE** — `Discipline.NURSE_PRACTITIONER` |
| Admin / internal data-entry login | **DONE** — `UserRole.OWNER` and `SPECIALIST` |
| Each role sees a different intake form | **DONE** — discipline selects the template set *and* the portal, and §3's role-specific section lists are built: `CASE_MANAGEMENT` and `NURSING` now ask different questions in different sections |
| Role-based access control | **DONE** — `requireRole`, re-read per request so suspension is immediate |
| All activity logged | **DONE** — append-only `AuditLog`, covering reads as well as writes |
| Email + strong password | **PARTIAL** — Supabase Auth handles it; password policy is a Supabase dashboard setting, not enforced in app |
| **MFA mandatory** | **TO BUILD** — Supabase supports TOTP; needs an enrolment flow and enforcement in `requireRole` |
| Session timeout | **TO BUILD** |
| Secure logout | **DONE** — `logout()` clears the Supabase session |

## 2. Client identification

| Clause | Status |
| --- | --- |
| Primary identifier: Client ID / MRN / Case number | **DONE** — `Client.clientCode`, unique per practice, leads every screen, filename and log line |
| Optional: initials only | **DONE** — `Client.initials` |
| Optional: first name + last initial | **DONE** — `givenNameEnc` (encrypted) + `familyInitial` |
| Optional: full name, only on explicit choice with a PHI acknowledgement | **TO BUILD** |
| "Safe mode" toggle defaulting to the non-identifying ID | **PARTIAL** — the code always identifies and exports omit names by default; an explicit per-practice toggle is **TO BUILD** |
| Identifying information encrypted at rest and in transit | **DONE** — AES-256-GCM column encryption, key in the environment. Verified by dumping the table and grepping for seeded names: no plaintext |
| Access role- and need-based | **DONE** |
| Every submission permanently linked to the identifier | **DONE** — FK from `Submission` to `Client` |

## 3. Core information collection template

The form must be structured, versioned, and shaped so the exported PDF is easy for both
humans and AI to parse.

### Common header — **DONE** except where noted

- Date of encounter — **DONE** (`Submission.encounterDate`)
- Professional name + role, auto-filled — **DONE**
- Client identifier — **DONE**
- Client status dropdown (Active / On Hold / Discharged / Deceased / Transferred / Other
  with free-text reason) — **DONE**, reason required for any non-active status
- **Type of encounter** dropdown: Social Case Management Update / Nursing / Clinical
  Follow-up / Psych Evaluation / Psych Follow-up / Therapy Session / Crisis / Other —
  **DONE** — `encounterType`, and it is now the `[EncounterType]` segment of the §5 filename
- **Location / modality**: in-person, telehealth, phone, home visit — **DONE** — `modality`
- **Duration in minutes** — **DONE** — `durationMinutes`, a dropdown rather than a number
  box and deliberately optional: a clinician who did not time the contact must not be
  pushed into inventing a figure

The header is on every template that has a form. `NARRATIVE` is deliberately excluded — it
is the template behind the one-box quick update and the field worker's link, neither of
which renders a form at all.

### Social Case Worker sections — **DONE**

`CASE_MANAGEMENT`, in six sections: *This contact* (header, what has changed, how they
presented) · *Situation* (`housing` dropdown, situation, support system, `benefits`
picker) · *Needs* (the needs picker and their own words) · *Safety* · *Progress and
actions* (goals with barriers, actions taken, referrals) · *Next steps*.

Housing and benefits are pickers rather than prose for the same reason the needs list is:
two workers writing "no stable housing" and "homeless" about one person produce two
unrelated strings, and neither can be counted or compared.

### Nurse Practitioner sections — **DONE**

`NURSING`, in six sections: *This contact* (header, what has changed, chief complaint) ·
*Symptoms* (an eight-box picker plus detail) · *Mental status* · *Risk* (suicidal
ideation, thoughts of harming others, self-harm and substance use, each a graded level
with the plan beside it) · *Findings* (vitals, history update) · *Impression and plan*
(clinical impression, medication with adherence and side effects, plan and follow-up).

**Mental status is one field, not the nine listed.** Nine boxes on a phone is the form
nobody finishes, and every note this feeds writes the mental state examination as
continuous prose — the export carries identical text either way. The nine are named in
the field's hint so none is forgotten. Splitting it later is a migration of stored text,
so it is worth being asked for rather than assumed.

### Shared sections — **PARTIAL**, the required one is built

**What has changed since the last update** (required) — **DONE**, `sinceLastContact`, and
it is what the §5 PDF prints at the top of its comparison as the clinician's own statement,
above the derived field-by-field movement · key quotes or client statements ·
safety plan updates · barriers to care · strengths and protective factors · next
appointment · attachments — **DONE**, photo upload with OCR, original image retained ·
professional's free-text narrative — **DONE**.

Because note writers produce SIRP and BIRP, the shared set gains a
Situation/Behaviour → Intervention → Response → Plan block on the psychiatric and therapy
encounter types, so both formats can be written from one submission.

## 4. Historical comparison — "one of the highest-value features"

| Clause | Status |
| --- | --- |
| Surface a summary of the most recent previous submissions when starting a new one — status, key changes, last risk assessment, last goals, last medications | **TO BUILD** |
| Side-by-side "what is new / what has changed" view | **PARTIAL** — the specialist workspace shows previous notes beside the source; the clinician sees nothing at intake time, which is where it matters |
| Soft warning on a likely duplicate | **DONE** — hash, ±3-day window, Jaccard and containment, then one model call. Produces a flag, never a merge |
| Hard block when the client is Deceased or Discharged | **DONE** — server-side, at write time. The submission is kept, flagged and notified |

## 5. PDF export — **critical**, **DONE**

`src/lib/export/pdf.tsx` renders it, `src/lib/export/submissionPdf.ts` assembles it from
the database, and `/api/export/submission/[id]` serves it. The WhatsApp share link
(§7a) renders through the same pair, so a note writer gets the identical document
whichever way it reached them.

| Clause | Status |
| --- | --- |
| Hierarchical structure, bold section headings | **DONE** |
| Identical field labels every time | **DONE** — headings come from `TEMPLATES`, the structure the intake form renders from, so there is one label to change rather than three |
| One logical block per section | **DONE** — an unfilled section prints "Not recorded" rather than being dropped, so an absence stays distinguishable from an oversight |
| Client identifier and status prominent at the top | **DONE** — running header on every page; a non-active status also gets a called-out banner |
| Called-out "changes since last submission" | **DONE** — the clinician's own sentence first, then `src/lib/export/changes.ts` comparing against the previous encounter and reporting which sections moved. It does not say whether a change matters (§6) |
| Timestamp, professional name and role, submission ID on every page | **DONE** — running footer, plus a page counter |
| No decorative clutter | **DONE** |
| Real selectable text, never image-only | **DONE** — standard PDF fonts, verified by extracting the text back out of a generated file |
| Single column | **DONE** |
| Embedded machine-readable JSON | **DONE** — attached as `submission.json`, keyed by template field id rather than by label |
| Filename `[ClientID]_[YYYY-MM-DD]_[EncounterType]_[SubmissionID].pdf` | **DONE** — `[EncounterType]` is what the clinician chose, so two nursing encounters can be `…_Crisis_…` and `…_Psych-follow-up_…`. Falls back to the template name for the one-box narrative and for anything filed before the dropdown existed |
| Downloadable by the professional | **DONE** — on the confirmation screen after submitting |
| Automatically available in the internal queue | **DONE** — on every queue row and on the client record |

Names are **off by default**, are an explicit `?names=1` opt-in, and are audited under a
distinct action. A photographed submission whose transcript no person has verified prints
an explanation rather than the machine's reading of it — an unverified transcript is not a
record.

`npm run verify:pdf` renders the layout from synthetic data with no database, which is how
the page-break and running-footer behaviour is checked. Use it: two failure modes in
`@react-pdf/renderer` are completely silent, and both remove the footer while leaving lint,
typecheck and build green. See the comments in `pdf.tsx`.

## 6. What the platform explicitly does NOT do

- It does **not** generate SIRP, BIRP, Psych Eval or any clinical note.
- It does **not** replace clinical judgement or the final note.
- It does **not** push data into Credible, ICANotes or any EHR.

Its sole job is high-quality, structured, comparable information collection plus a clean
PDF export optimised for human and AI consumption.

> A note-production workspace exists at `/s/note/[id]` from the earlier build. It is an
> internal drafting aid, it never auto-generates, and everything it produces is signed by
> a named person. It sits outside this specification — do not extend it, and do not let it
> drift towards generating notes.

## 7. Technical requirements

| Clause | Status |
| --- | --- |
| Multi-tenant with strict data isolation | **DONE** — every query filters on `practiceId` |
| All PHI encrypted at rest and in transit | **PARTIAL** — TLS throughout; client names encrypted at the column level; **note text is not** — it relies on Supabase volume encryption, which a leaked database credential defeats. See `SECURITY.md` |
| Full audit trail: who viewed, edited, exported what and when | **DONE** |
| Mobile-responsive forms | **DONE** |
| **Autosave of drafts** | **TO BUILD** |
| **Mark a submission "Processed" and link it to the final note version** | **TO BUILD** |

---

## 7a. The write-and-send path

Added 2026-08-11, after the client reviewed the build and described a materially simpler
product than the specification above: a clinician signs themselves up, types what they
discussed in plain language, and the PDF reaches the note writer over WhatsApp
immediately.

| Clause | Status |
| --- | --- |
| Clinicians create their own accounts and log in | **DONE** — `/signup` |
| One simple box: write what was discussed | **DONE** — `/t/write`, over the `NARRATIVE` template |
| Enter a client by **name**, not by picking a record | **DONE** — `src/lib/clients/resolve.ts`. A typed "Smith J" finds that client or creates one with the next practice code. There is no "add the client first" step, because the paper process being replaced does not have one |
| Send to a chosen WhatsApp number | **DONE** — defaults to `Practice.noteWriterWhatsApp`; a number typed on the form overrides it **for that send only** and is not saved over the practice's |
| **Several clients in one round** | **DONE** — `/t/write` takes as many clients as were seen and sends them as **one PDF, a page per client**, which is the shape the paper process produces. Each entry is still its own submission, so the guardrail refuses per client and one refusal does not discard the round |
| **Send the active client list** | **DONE** — `/t` carries a "Send your client list" action producing a roster PDF (code, name if opted in, status, when the status changed, last session, update count) and sending it on WhatsApp. Active-only by default. It reports status **as recorded**, and never asks the clinician to re-assert it: a list disagreeing with the database would be worse than none, because the guardrail refuses on the stored status |
| Sign up, sign in, sign out | **DONE** — `/signup` creates the account **already confirmed** and signs the person straight in, so registration does not depend on Supabase's rate-limited built-in SMTP. See the note below |
| Carries the date **and time** of the encounter | **DONE** — `datetime-local`, defaulting to now |
| Becomes a PDF immediately | **DONE** — built in the same request, not queued |
| Sent over WhatsApp immediately | **DONE** — `src/lib/whatsapp/send.ts` sends the document to `Practice.noteWriterWhatsApp` via the Meta Cloud API. **Not exercised against the live API** — `graph.facebook.com` is refused by the build environment's egress policy |
| The structured workspace stays | **DONE** — the queue, verification, duplicate detection and insights are untouched; this is an additional way in, not a replacement |

The quick path is a thin surface over `submitEncounter`, deliberately. The status
guardrail, duplicate detection, completeness gate and audit trail all still run — a
"quick" path that skipped them would be a hole straight through the rule this product
exists to enforce. Verified: a quick update against the seeded deceased client is refused,
and the clinician's text is kept and flagged.

### Registration without email confirmation

Signup uses the admin API with `email_confirm: true` rather than `auth.signUp`.
Supabase's built-in SMTP is rate-limited to a handful of messages an hour and is
explicitly not for production, so on a fresh project a real fraction of people
who sign up never receive the mail and can never sign in.

The trade is that **an address is not proven to belong to the person who typed
it**. What that does and does not buy an attacker here: a signup creates a new,
empty practice and never joins an existing one, so registering someone else's
address yields an empty workspace and no access to anybody's data. The cost is
that password reset, which does need a working mailbox, may go to someone who
cannot read it.

To reverse it: configure real SMTP in Supabase and switch back to `auth.signUp`.
The confirmation routes at `/auth/callback` and `/auth/confirm` are already built
and keep working either way.

### The delivery decision, recorded

The client was told, and reaffirmed, that **Meta does not sign a business associate
agreement covering WhatsApp**, and chose to send the document itself rather than only a
link to it. That is their call and it is implemented as asked. What the code does to bound
it:

- Documents are identified by **client code only** unless the clinician ticks the name box
  on that submission. Off by default, every time.
- Nothing clinical goes in the message text — the caption is a client code and a date,
  because a WhatsApp preview shows on a lock screen.
- Every send is audited, and an identifiable send is a **distinct action** from a
  de-identified one.
- The tokenised, expiring `/share/[token]` link built alongside this remains available and
  is the safer option; it is one setting away from being the only one.

## Outstanding, as one list

1. Sectioned, role-driven intake forms with the §3 field lists, new field types
   (checkbox groups for symptoms, short structured fields for mental status, severity
   selects for risk), and the SIRP/BIRP block on psychiatric encounter types.
2. Common header: encounter type, modality, duration.
3. Required "what has changed since last contact" field.
4. Historical comparison surfaced to the clinician **before** they start typing.
   `src/lib/export/changes.ts` already computes the comparison for the PDF; what is
   missing is showing it at intake, which is where §4 says the value is.
5. MFA enrolment and enforcement; session timeout.
6. Optional full name behind an explicit PHI acknowledgement; an explicit safe-mode
   toggle.
7. Draft autosave.
8. "Processed" marking and an optional link to the final note version.
9. Inviting a colleague into an existing practice. A signup always creates a new one.

Done since this list was written: the §5 PDF export and the §7a write-and-send path.

## Deployment status

Not yet deployed. Both migrations and the seed are verified against a real PostgreSQL 16,
so they will apply. The blocker is environmental, not technical — see the environment
notes in `CLAUDE.md`.
