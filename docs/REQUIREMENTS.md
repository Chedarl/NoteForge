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
| Each role sees a different intake form | **PARTIAL** — discipline selects the template set; the richer role-specific field lists in §3 are **TO BUILD** |
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

### Common header — **TO BUILD** except where noted

- Date of encounter — **DONE** (`Submission.encounterDate`)
- Professional name + role, auto-filled — **DONE**
- Client identifier — **DONE**
- Client status dropdown (Active / On Hold / Discharged / Deceased / Transferred / Other
  with free-text reason) — **DONE**, reason required for any non-active status
- **Type of encounter** dropdown: Social Case Management Update / Nursing / Clinical
  Follow-up / Psych Evaluation / Psych Follow-up / Therapy Session / Crisis / Other —
  **TO BUILD**
- **Location / modality**: in-person, telehealth, phone, home visit — **TO BUILD**
- **Duration in minutes** — **TO BUILD**

### Social Case Worker sections — **TO BUILD**

Current living situation / housing · support system and family involvement · benefits and
resources status (Medicaid, SNAP, SSI, …) · safety concerns and risk factors · goals
progress with barriers and next steps · referrals made or needed · client presentation and
engagement level · anything new or changed since last contact.

### Nurse Practitioner sections — **TO BUILD**

Chief complaint · current symptoms (structured checkboxes plus free text: mood, anxiety,
sleep, appetite, energy, concentration) · mental status observations (appearance,
behaviour, speech, mood, affect, thought process, cognition, insight, judgement) · risk
assessment (suicidal ideation, homicidal ideation, self-harm, substance use — each with
severity and plan) · medication changes, adherence and side effects · medical and
psychiatric history updates · vitals and physical findings · clinical impression and
working diagnosis · plan, interventions and follow-up.

### Shared sections — **TO BUILD** except where noted

**What has changed since the last update** (required) · key quotes or client statements ·
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

## 5. PDF export — **critical**, **TO BUILD**

A ZIP of JSON and Markdown already exists (`src/lib/export/`) and covers most of the
content requirements. The PDF itself is not built.

Requirements: hierarchical structure with bold section headings · identical field labels
every time · one logical block per section · client identifier and status prominent at the
top · a called-out "changes since last submission" section · timestamp, professional name
and role, and a unique submission ID **on every page** · no decorative clutter · real
selectable text, never image-only · single column, or simple two-column · optionally an
embedded or attached machine-readable JSON block.

Filename: `[ClientID]_[YYYY-MM-DD]_[EncounterType]_[SubmissionID].pdf`

Downloadable by the professional **and** automatically available in the internal queue.

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

## Outstanding, as one list

1. Sectioned, role-driven intake forms with the §3 field lists, new field types
   (checkbox groups for symptoms, short structured fields for mental status, severity
   selects for risk), and the SIRP/BIRP block on psychiatric encounter types.
2. Common header: encounter type, modality, duration.
3. Required "what has changed since last contact" field.
4. Historical comparison surfaced to the clinician **before** they start typing.
5. The PDF export, to the §5 specification.
6. MFA enrolment and enforcement; session timeout.
7. Optional full name behind an explicit PHI acknowledgement; an explicit safe-mode
   toggle.
8. Draft autosave.
9. "Processed" marking and an optional link to the final note version.

## Deployment status

Not yet deployed. Both migrations and the seed are verified against a real PostgreSQL 16,
so they will apply. The blocker is environmental, not technical — see the environment
notes in `CLAUDE.md`.
