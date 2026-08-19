# Business associate agreements — register and procurement plan

`SECURITY.md` describes what the code does. This describes what has to be
*signed*, by whom, before a clinician's real caseload goes in.

It exists because "get BAAs" is not one task. It is five vendors with five
different answers, two of which cannot be solved by signing anything, and the
order they are dealt with in changes what the product looks like.

## What this document is not

It is not legal advice, and nothing in it has been signed. A BAA is a contract
between two organisations; no engineering work can produce one, and no reading
of a vendor's marketing page substitutes for a countersigned document with a
date on it. **Every claim in the register below must be confirmed in writing
with the vendor before it is relied on.** Vendor terms change, and this file
will go stale.

What engineering *can* do is make each agreement small: keep the number of
parties down, keep what reaches each one to a minimum, and make sure that
replacing any of them is a contained change. That part is done, and the register
says where.

## The one-sentence position

Two vendors will sign (Vercel, Supabase) and cost money; one probably will and
is trivial to replace if not (Resend); one **will not sign and cannot be made
to** (Meta/WhatsApp), and is a deliberate, documented product decision; one
**will not sign** and is the single easiest thing on this list to swap out
(Moonshot/Kimi).

## The register

Everything a clinician types, dictates, photographs or uploads is PHI once a
real caseload is in the system. This is every third party it can reach, what
reaches them, and what happens if that party is breached.

### 1. Vercel — hosting and compute

| | |
| --- | --- |
| **What reaches it** | Everything. Every request body, every rendered page, every server action. PHI passes through memory on every page load. |
| **Persisted there?** | No application data. Build artefacts, environment variables and request logs. |
| **BAA** | Available on Enterprise. Not on Hobby or Pro. |
| **Blocker?** | **Yes.** Unavoidable while the app is hosted there. |
| **Replaceable?** | Yes but not cheaply — it is a Next.js app, so the realistic alternatives are AWS (Amplify/ECS, BAA available under the standard AWS agreement), Google Cloud Run, or Azure. Each is a deployment rewrite, not a config change. |

Two things reduce the exposure and should be checked before signing:

- **Request logs.** `src/lib/redact.ts` replaces clinical field values with a
  length marker, and no URL in the product carries a name — every path carries a
  client code. Confirm log retention and who at the vendor can read them.
- **`Referrer-Policy: no-referrer`** is set, so a URL containing a client id
  never leaves in a referer header.

### 2. Supabase — database, auth, storage

| | |
| --- | --- |
| **What reaches it** | All of it, at rest. Every submission, note, transcript and audit row. Both private buckets (page images, generated PDFs). |
| **Persisted there?** | Yes — this is the system of record. |
| **BAA** | Available with the HIPAA add-on, on a paid plan. Not on Free. |
| **Blocker?** | **Yes.** |
| **Replaceable?** | The database is plain PostgreSQL behind Prisma, so the data layer moves to any managed Postgres under a BAA (RDS, Cloud SQL) with a connection-string change. Auth and Storage are the sticky parts. |

Note that the HIPAA add-on is not only a signature — it changes what the project
enforces (MFA requirements, network restrictions, log retention). Budget for
configuration work, not just the line item.

**Column-level encryption is what makes a Supabase breach survivable.** Client
first names are AES-256-GCM with the key in the application environment and
never in the database (`src/lib/crypto/field.ts`), so a leaked database password
yields ciphertext for the one directly identifying field. Note *text* is not yet
encrypted — see "The gap that is code, not contract" below.

### 3. Resend — outbound email

| | |
| --- | --- |
| **What reaches it** | Recipient address, a subject line, and a body containing a URL. **No PHI**, by construction. |
| **Persisted there?** | Message metadata and body, per their retention. |
| **BAA** | Confirm directly. Do not assume. |
| **Blocker?** | **No** — but only because of a design decision, see below. |
| **Replaceable?** | Trivially. One module, `src/lib/email/send.ts`. Providers that do sign include AWS SES (under the AWS BAA), Paubox and LuxSci. |

This is the one vendor where the code has already removed the problem rather
than deferring it. `src/lib/email/send.ts` states the rule at the top: **every
message this system sends is a pointer, never content.** The share email
(`src/lib/sharing/email.ts`) carries a link and no client code — not in the body
and not in the subject, because a subject line shows on a lock screen.
`tests/shareEmail.test.ts` asserts both against the real composer.

So even without a BAA, what Resend holds is "somebody was sent a link at
11:04". That is metadata worth protecting but it is not a clinical record. Get
the BAA anyway if it is available at no cost; do not let it block a pilot.

### 4. Meta / WhatsApp — clinician-to-note-writer handoff

| | |
| --- | --- |
| **What reaches it** | A message containing an expiring URL, and the recipient's phone number. **Not the document.** |
| **Persisted there?** | The message, in the chat history and in whatever backs that phone up — permanently. |
| **BAA** | **No. Meta does not sign one covering WhatsApp on any plan.** |
| **Blocker?** | No, as currently built. It would be if documents were attached. |
| **Replaceable?** | The channel is not replaceable — this is how the practice actually works. What travels over it is. |

This is the vendor that cannot be fixed by procurement, and it was decided
deliberately (`docs/REQUIREMENTS.md` §7a). The reasoning is worth restating
because it will be questioned by anyone reviewing this list:

**Removing WhatsApp would not make anything safer.** It would push the document
into email, onto a memory stick, or back onto paper. The channel stays, and two
things about it changed so that Meta never holds clinical material:

- **A link goes into the chat, never the document.** `sendLink` replaced
  `sendDocument` on every path — a claim that was false until this register was
  written. The caseload roster still pushed the whole client list as an
  attachment; it now goes as a locked link like everything else, and
  `npm run verify:handoff` keeps it that way. Pushing the bytes put a clinical narrative onto
  Meta's infrastructure and into a phone's cloud backup permanently, with no
  expiry, no download ceiling and no way to withdraw it. A link keeps the bytes
  in the practice's own bucket, where all three apply — and what survives in a
  backup is a URL that has since stopped working.
- **Possession of the message is not access to the note.** The link is behind a
  six-digit passcode (`src/lib/sharing/passcode.ts`), HMAC'd and bound to that
  link's own token, meant to travel by a second route. Five wrong attempts and
  the link is finished, permanently.

**What to write down for a risk analysis:** Meta receives a phone number, a
timestamp, and an opaque URL. It does not receive a client code, a name, a date
of birth or any clinical content. Whether that constitutes a disclosure is a
question for counsel; the position is defensible and should be documented rather
than discovered.

### 5. Moonshot / Kimi — OCR, duplicate classification, note drafting

| | |
| --- | --- |
| **What reaches it** | Clinical text and page images. `readHandwriting` sends a photographed note; `classifyPair` sends two submissions' full text; `draftNote` sends a submission. |
| **Persisted there?** | Per their terms. Assume yes. |
| **BAA** | **No.** A non-US provider will not sign a US HIPAA BAA. |
| **Blocker?** | **Yes, while enabled.** |
| **Replaceable?** | **This is the easiest item on the list.** |

Three things make this contained, and they were built this way on purpose:

- **One file knows the provider.** `src/lib/ai/kimi.ts` is the only module that
  makes the call; `reader.ts`, `classify.ts` and `noteDraft.ts` go through it.
  Swapping to a provider under a BAA — AWS Bedrock, Google Vertex, Azure
  OpenAI, Anthropic — is one implementation, not a refactor.
- **Every AI call degrades to null, never to an error page** (rule 7). With
  `KIMI_API_KEY` unset the whole product still works: a page gets typed by hand,
  a duplicate flag still gets raised from token overlap, a note still gets
  written by a person. **Unsetting one environment variable removes this vendor
  entirely**, today, with no code change and no loss of function beyond
  convenience.
- **Duplicate detection does not need it.** Layers 1–3 of
  `src/lib/dedupe/detect.ts` are exact hashing and token overlap, computed
  locally with the note text never leaving the database. Only layer 4 — a single
  call on the best candidate pair, above a threshold — involves a model at all,
  and its only power is to *suppress* a flag.

**Recommendation: turn it off for the pilot.** It is the one vendor that both
receives the most sensitive material and is removable in a single deployment
setting. Turn it back on when a provider under a BAA is wired in.

### Not a subprocessor: dictation

`src/lib/voice/speech.ts` uses the browser's own speech recognition on the
worker's device. Note that on some browsers this is implemented server-side by
the *browser vendor* — Chrome historically sent audio to Google. Check the
target browsers before relying on "it is on-device", and prefer typing where the
answer is unclear or unknown.

## The gap that was code, not contract — now closed

An earlier draft of this file said `SECURITY.md` listed note-text column
encryption as blocked because the duplicate detector searches that text, and
that the reason was wrong. It was, and the work is now done.

Every column carrying clinical narrative is AES-256-GCM with a random IV per
value: `Submission.rawText`, `normalizedText` and `fields`, `Note.body`,
`SubmissionPage.ocrText` and `verifiedText`, `SubmissionFlag.detail`,
`Client.statusReason` and `ClientStatusEvent.reason`. A leaked database
password, a misconfigured backup or a support engineer with production access
now yields ciphertext.

Three of those columns were found by dumping the database and grepping it, after
the obvious ones had been sealed and everything was green. `npm run
verify:at-rest` is that grep, and it runs in CI.

**What this changes in a vendor conversation.** The Supabase entry above says
column encryption is what makes a breach of that vendor survivable. That
sentence now covers the notes, not only the name — which is the difference
between "an attacker gets a client code and some ciphertext" and "an attacker
gets a clinical record". Say it plainly, and pair it with the honest caveat: the
key lives in the application environment, so an attacker who takes the
application as well as the database has both halves.

## Sequence

The order matters: doing 1 and 2 first buys nothing while 5 is still enabled.

1. **Turn off Moonshot/Kimi — set `AI_DISABLED=1`.** Zero cost, zero code, and
   it removes the vendor that receives the most sensitive material.

   **Do not do this by unsetting `KIMI_API_KEY`.** An earlier draft of this file
   said to, and that advice was wrong: **two** variable names are read,
   `KIMI_API_KEY` and `MOONSHOT_API_KEY`, so a deployment carrying the second
   stays fully live while every screen and every log looks exactly as it would
   if the vendor were gone. Reproduced at runtime before this was written — with
   only `MOONSHOT_API_KEY` set, `/api/health` still reported
   `modelVendor: "configured"`.

   Turning something off by *removing* things means finding every variable that
   might carry a key, including one somebody adds next month. `AI_DISABLED=1` is
   one variable to add and it beats all of them, present and future.

   Verify from outside, without signing in: `/api/health` reports
   `modelVendor: "disabled"` rather than `"configured"` or `"none"`, and
   `/api/health/ocr` reports `DISABLED` rather than `NO_KEY` — deliberately
   different answers, because "we removed this vendor" and "nobody configured
   it" are opposite facts that a single value would flatten into one.
2. **Confirm the WhatsApp position in writing** — that only a link travels, and
   that the practice accepts it. It is already true in code; it needs to be
   recorded as a decision rather than a discovery.
3. **Supabase: paid plan + HIPAA add-on, BAA signed.** Then work through the
   configuration the add-on enforces, which is separate from signing it.
4. **Vercel: Enterprise, BAA signed.** The largest line item; get the Supabase
   answer first so the two are negotiated with a known total.
5. **Resend: confirm, or replace.** Cheap either way. Do not let it gate 1–4.
6. **Encrypt the clinical text columns.** See above — this is now ordinary work.
7. **Retention and deletion.** The schema keeps everything forever, which is
   right for audit and wrong past a retention period. Includes cleanup of
   expired handoff PDFs in the bucket.
8. **Enforce MFA for every role**, not only staff.
9. **Move `FIELD_ENCRYPTION_KEY` into a managed secret store** with rotation.
   The `v1:` prefix on every stored value exists so a re-encryption pass can
   tell old from new.
10. **Have a lawyer read this file, `SECURITY.md`, and the code that implements
    them.** Steps 1–9 are necessary and not sufficient.

## What each vendor needs from you

Keep a folder. For each of Vercel, Supabase and Resend, you will be asked for
substantially the same things, and having them written once saves the round
trips:

- The legal entity signing, and who is authorised to sign for it.
- What the service is used for, in one paragraph.
- What categories of PHI are involved — see the block below.
- Expected volume.
- Your security contact.

### The PHI statement — lead with this

Every vendor intake form asks what protected health information is involved.
NoteForge's answer is unusually short, it is a property of the data model rather
than a promise, and it is the strongest thing you have in these conversations.
Paste it verbatim:

> NoteForge holds, for each individual: a practice-assigned client code
> (e.g. `RVN-0142`), a first name, a surname initial, an optional birth **year**,
> and clinical narrative about encounters.
>
> It does **not** hold: full name, date of birth, address, telephone number,
> email address, Social Security number, medical record number, health plan or
> member number, account number, certificate or licence number, vehicle or device
> identifier, URL, IP address, biometric identifier, or full-face photograph.
>
> The mapping from a client code to a full identity is not in NoteForge. It
> remains in the practice's own electronic health record, where it is already
> held and already covered.
>
> The first name is encrypted at the column level (AES-256-GCM, random IV per
> value) with the key held in the application environment and never in the
> database, so a compromised database credential yields ciphertext for the only
> directly identifying field. Exports omit names by default and record
> separately in the audit trail when an identifiable export was taken.

Two things to be straight about when you send it, because a vendor's security
reviewer will raise them and it is better to have said them first:

- **Clinical narrative can identify somebody through its content alone.** A
  short list of identifiers is a real reduction in exposure, not an elimination
  of it. Do not present this as de-identified data — it is not, and claiming so
  is the kind of overstatement that loses a reviewer's trust on everything else.
- **Note text is not yet column-encrypted.** The first name is; the narrative is
  not. Say so, and say it is scheduled — see the section above.

## Status

Nothing in this document has been signed. It is a plan, and every vendor claim
in it needs confirming in writing before a real caseload goes in.
