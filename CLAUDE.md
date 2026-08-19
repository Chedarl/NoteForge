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
src/lib/db/migrations.generated.ts generated: what /api/health diffs against
src/lib/insights/          metrics as live Prisma aggregates
src/app/t/                 clinician portal (mobile-first)
src/app/s/                 internal workspace: queue, verify, note, download, insights, audit
src/app/confirm/           the one unauthenticated page — signed single-purpose links
src/app/f/[token]/         the field worker's whole product — token is the credential
src/lib/field/links.ts     minting, resolving and revoking a worker's way in
src/lib/voice/speech.ts    dictation on the worker's own phone, no key, no account
```

## Field agents submit without an account, and that is a schema decision

A recovery coach standing outside somebody's house will not type a password. So
a `FIELD_AGENT` is a `User` with a **null `authUserId`** and a null `email`,
reached through a durable `FieldLink` whose token is the credential.

Making them a `User` rather than a parallel entity is the load-bearing choice.
`submitEncounter` takes a `submittedBy: User`, and every guarantee in this
product hangs off that — the status guardrail, refuse-but-record, duplicate
detection, the audit trail, attribution on the PDF. A separate `FieldAgent`
table would have meant reimplementing all of it, and the reimplementation is
where a guardrail quietly stops applying.

The null `authUserId` **is** the access control, and it fails closed by
construction: signing in matches a Supabase id against that column, and no real
id equals null. Nobody has to remember to write a check.

`FieldLink` is not `ShareLink` and the difference is the point. A share link
points *out* at one document and expires in hours. A field link points *in*,
belongs to one named person, and is saved to a home screen and used daily — so
it does not expire, and the control that matters is per-person revocation. Both
store only a SHA-256 of the token.

Verified against a real database: a valid token resolves, a wrong or malformed
one returns null, a revoked link stops working while every other agent's keeps
working, a suspended agent's link stops, a cross-practice revoke is refused, and
two agents with null `authUserId` coexist. And the guardrail refuses a
discharged client through this door exactly as it does through `/t/write` —
`["QUEUED", "BLOCKED"]` with a flag raised.

## Template fields have types now, and one value renderer

`TemplateField` gained `type: "prose" | "choice" | "multi" | "severity"`
(absent means `prose`, so every template written before this is unchanged). A
`multi` stores `string[]`, a `severity` stores `{ level, note }`.

**`renderFieldValue` is the only place a stored answer becomes text**, and that
is not tidiness. Before it existed, five places each did their own `typeof
value === "string"` check, and an array would have vanished from each one
independently and silently:

- `flattenFields` feeds `rawText`, `contentHash` and `normalizedText`, so a
  dropped value meant **every picker-only submission hashed identically and the
  duplicate detector flagged them all against each other**.
- `bundle.ts` would have omitted the field from `sessions.json` and printed
  `_not recorded_` — the exact bug this file already warns about.
- `saveNote` coerced with `String(...)`, destroying the array on the first save.
- `assessCompleteness` gated on string length, so a required picker could never
  be complete and the note could never be signed.
- `formData.get` returns only the first value, so a checkbox group collapsed to
  one tick. `readField` uses `getAll`.

Ids are stored, labels are rendered. `renderFieldValue(value, field)` resolves
option ids through the field's `options`, or through the needs vocabulary for
`optionSource: "needs"` — so a reworded label does not orphan historical data,
and a note writer never reads `local_food_bank` on a PDF.

**Need ids in `src/lib/intake/needs.ts` are permanent.** Rename one and every
historical submission silently stops matching. Retire with `retired: true`;
never delete, never reuse. The standard list is a client-safe constant, not
database rows, precisely so two practices' data stay comparable — only local
additions live in `PracticeNeed`.

Three screens render the same template — intake, the note editor, and the
read-only view on the note page — and they now share
`src/components/shared/TemplateField.tsx`. They used to have three copies of one
loop, which was survivable when every field was a textarea and would not be now.

## Sections, and two rules that came with them

The §3 field sets made the nursing form about twenty fields long, so
`TemplateField` gained `section` and the form renders through
`src/components/shared/TemplateSections.tsx`. **Consecutive** fields sharing a
section value are one group, so the field order *is* the grouping — there is no
second list to fall out of step with it. A field with no section renders bare,
which is why SOAP, DAP, BIRP and NARRATIVE look exactly as they always have.

Native `<details>`, because **a collapsed `<details>` still submits the inputs
inside it**. Conditional rendering would drop a section's answers the moment
somebody collapsed it after typing, and it would look like the form losing work
at random.

**A refused submit must not wipe the form.** React resets an uncontrolled form
once its action completes, which is right for one that succeeded and ruinous for
one the server sent back — twenty fields lost along with the message naming the
one that was empty. `IntakeForm` and `FieldUpdateForm` snapshot their answers on
submit and re-key the field block, so `defaultValue` is read again on the
remount. Any new form over a server action needs the same, and the field
worker's page is the one where it matters most: that person is on a doorstep and
has just spoken a paragraph into their phone.

**Never put the `required` attribute on a control inside a section.** A
`required` control inside a closed `<details>` makes the browser refuse the
submit with "An invalid form control is not focusable" — nothing on screen
changes, nothing is logged, the button simply stops working. `TemplateField`
uses `aria-required`, and `assessCompleteness` is the gate that actually holds:
it runs server-side on every intake path and returns the missing fields by name.

**A field made required does not reach backwards.** `TemplateField.since` (an
ISO day) means `assessCompleteness` only demands it of encounters on or after
that date, and the call sites pass the submission's own `encounterDate`. Without
it, adding one required field drops the mean-completeness figure on
`/s/insights` overnight — which reads as a collapse in data quality and is
nothing of the kind — and `saveNote`'s sign gate refuses to sign an
already-submitted encounter until somebody fills in a field the clinician was
never shown. `npm run verify:templates` fails the build if a new required field
arrives without one.

`npm run verify:templates` also catches what the compiler cannot: a `choice`
with no options, two fields sharing an id, a section name that reappears after
an interruption, and field ids that other modules name as string literals.
`clientFacts.ts` names `riskSuicidal`, `changes.ts` names `sinceLastContact`,
`submissionPdf.ts` names `encounterType` — rename any of them and the dashboard
chip, the PDF's clinician statement and the §5 filename each silently return
nothing, with lint, typecheck and build all green.

## WhatsApp stays, and the assumption under it changed

Meta signs no business associate agreement, and this practice hands work over on
WhatsApp all day. Removing the channel would not make anything safer — it would
push the PDF into email, onto a memory stick, or back onto paper. So the channel
stays and two things about it changed.

**A link goes into the chat, never the document.** `sendLink` replaced
`sendDocument` on every path. Pushing the bytes put clinical material onto
Meta's infrastructure and into a phone's cloud backup permanently — no expiry,
no download ceiling, no way to withdraw it. A link keeps the bytes in the
practice's own bucket, where all three of those apply, and what survives in a
backup is a URL that has since stopped working. `sendDocument` is still there,
documented as not for clinical use.

**Possession of the message is no longer access to the note.**
`src/lib/sharing/passcode.ts` mints a six-digit code, HMAC'd with
`CONFIRM_LINK_SECRET` and bound to that link's own token hash. The link travels
by WhatsApp; the code is meant to travel some other way. Five wrong answers and
the link is finished — permanently, because a lock that lifts after an hour is a
lock an attacker waits out. Six digits is only a million, so the attempt ceiling
is doing the work, not the length.

Three things about it are load-bearing:

- **The download route checks the unlock, not just the landing page.** The page
  is a courtesy; the route is the door. Somebody who kept the `/download` URL
  never sees the page at all.
- **`ShareOnWhatsApp` no longer auto-opens WhatsApp when a code was issued.** It
  used to jump to the messenger the moment the link existed, which would sweep
  the sender past the only screen the digits are ever shown on.
- **A round carrying decrypted names is locked with no opt-out.** A
  de-identified one is locked by default and the sender can decline, because a
  code that must travel by a second route is real friction and pretending
  otherwise would just get it turned off everywhere.

The unlock proof is a derived cookie — an HMAC only this server can produce,
scoped to one link's path — so there is no session table and no second database
round trip on a route that already does an atomic claim.

## The export is Word now, and the seed nearly hid a bug in it

`src/lib/export/docx.ts` writes a real `.docx` on top of the ZIP writer already
in that directory — a `.docx` *is* a ZIP of XML parts — so the note writer opens
a document instead of decoding `## Assessment` and `**bold**`. `sessions.json`
beside it is unchanged and is still the machine-readable copy.

Two failure modes, neither of which a build catches:

- **A missing part.** Word wants `[Content_Types].xml`, `_rels/.rels` and
  `word/_rels/document.xml.rels`. Omit one and it reports "corrupt" without
  saying which.
- **A raw `&` or `<`.** Clinical prose has both — "BP 120/80 & stable", "<2
  units daily" — and unescaped they are fatal XML parse errors, so the whole
  document fails to open. Control characters below 0x20 arrive out of OCR and
  are illegal in XML 1.0 with *no* escape that makes them legal; they are
  dropped.

`npm run verify:docx` unzips the output and asserts the structure Word requires.
Its own tag-balance check was wrong on the first run and failed five perfectly
good parts — worth remembering that a failing assertion is as likely to be wrong
as the thing it asserts about.

**The seed was storing fields keyed by label.** `{ Subjective: … }` where every
reader looks up `subjective`, so all four seeded SOAP encounters exported with
"not recorded" under every heading. Nothing failed: the rows were written, the
ZIP was built, the JSON was valid, and the field map was silently empty — the
same shape as the two export bugs already described in this file, found the same
way, by opening the artefact. `make()` in `prisma/seed.ts` now throws on a key
that is not a field id of that template. Note that the seed leaves existing
submissions alone, so re-running it does not fix rows already written: delete
them first.

## Safe mode is a parameter, not a lookup

`Practice.safeMode` means this practice never displays, prints or exports a
client's name. `identityOf(policy, client)` takes the policy as its **first and
required** argument, and that shape is the whole design: an optional trailing
flag would have left all twenty existing call sites compiling and still printing
names. A privacy control whose absence is indistinguishable from "off" is not a
control. Required, the compiler names every place that has to answer the
question — and `Client` has no `safeMode` field, so a client passed in the
policy's position does not type-check either.

Three things about it are load-bearing:

- **Every failure resolves to safe mode ON.** `displayPolicyFor` returns
  `{ safeMode: true }` for a practice it cannot find and for a database missing
  the column. "I could not find out what this practice permits" must never print
  a name.
- **The export enforces it, not the screen that offers the tick box.** The ZIP
  is reachable as `/api/export?names=1`, so a disabled checkbox stops nobody who
  has seen an address bar. `buildExport` and `buildSubmissionPdf` AND the
  caller's request with the policy — safe mode can refuse names and can never
  add them to an export that did not ask.
- **`MATCH_ONLY` is the one deliberate bypass**, in `resolve.ts`, and `grep
  MATCH_ONLY` is the complete list of them. Matching a typed name against stored
  ones is not displaying: without it, a practice in safe mode would silently
  create a second client every time somebody typed a name it already held,
  splitting one person's history across two records.

Turning it on changes no layout anywhere, because `displayName` becomes null and
every screen has handled a nameless client since the first day.

## Drafts live on the device

`src/lib/forms/draft.ts` keeps an unsent form in `localStorage`, because a
clinician filling twenty fields on a phone loses the lot to an incoming call,
and the person that happens to does not file a shorter note — they stop using
the tool.

Not the server, deliberately: a server-side draft is clinical text about a named
client, stored before anybody decided it was a record, with its own retention
question and its own row in an export. That is a bigger decision than "do not
lose the form".

Four things bound the shared-phone risk: it ages out after 24 hours, it is
cleared on a successful file, the key includes the client and the template so a
draft can never be reattached to the wrong person, and it is **offered rather
than restored** — overwriting a form somebody has already started would be its
own kind of data loss.

Two bugs found here in a browser, both invisible to every other check:

- **The offer must suspend saving.** Opening the form fires a change event
  before anybody types, and that empty form was written straight over the draft
  the page had just offered — so "Put it back" put back nothing. The storage
  write and the read were each correct in isolation.
- **`FormData` cannot tell one ticked box from one text field.** Collapsing a
  single value to a scalar stored a lone tick as a string, and the renderer
  expects an array, so it silently restored nothing. The hook takes the set of
  list-valued field names from the caller, which is the only place that knows.

## `DONE` is not the last step

`Submission.state = DONE` means *a note was produced here*. It never meant
anybody entered that note into Credible or ICANotes, and that last step happens
somewhere this product cannot see — so from inside the system, a note that was
filed and one that was forgotten looked identical. That is where work actually
goes missing, and it is what a practice gets asked about when a claim comes
back.

`processedAt` / `processedById` / `processedNoteVersion` / `processedRef` record
it, marked by a named person on the note page. Rule 3 applies with particular
force here: nothing sets this automatically, because "was this actually filed"
is the one question nobody should be able to answer on somebody else's behalf.

Three details:

- **Only a signed note can be filed.** Allowing it earlier would let somebody
  mark work complete that no specialist has put their name to.
- **It is reversible, and both directions are audited.** A one-way flag makes
  people hesitate before using it at all, which produces a field nobody fills in
  and therefore nobody trusts.
- **The version is recorded** because a note corrected after signature bumps it,
  and "which one did they get" has to have an answer.

The `?tab=unfiled` queue is the operational question this exists for: finished
work nobody has confirmed reached its destination.

## The idle timeout is signed, and shared by both doors

A clinical workstation is shared, wheeled between rooms and left unlocked. The
session cookie is long-lived deliberately — somebody mid-round must not be
thrown out because a token aged — so "how long since this person did anything"
is a different question, and nothing was asking it.

`src/lib/auth/idle.ts` stamps a cookie in middleware and `SESSION_IDLE_MINUTES`
(default 30) decides the window. Three things about it are load-bearing:

- **The timestamp is HMAC-signed.** A cookie is client-controlled; an unsigned
  one could be pinned to the current minute to hold a session open forever,
  which would make the whole control decorative. With no `CONFIRM_LINK_SECRET`
  to sign with there is *no* timeout rather than a fake one.
- **"Cannot tell" means not yet idle.** A first request after signing in has no
  stamp, and a future-dated one is a clock change or a forgery — both resolve to
  unknown, and the caller writes a fresh stamp instead of extending anything.
- **It applies under `DEV_AUTH` too.** Not for the development door's sake: a
  security control that cannot be exercised on a development machine is one
  nobody ever watches work, and two of this codebase's worst bugs were exactly
  that.

The stamp is cleared on the way out. Left behind, the next sign-in arrives
carrying a stale one and is bounced straight back — a loop that looks like the
password being wrong.

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

### Running it signed in, without Supabase

Supabase Auth is unreachable from a container behind an egress policy, which
left the entire signed-in half of the product unopenable locally. You could
type-check a form, render it to a string and file a submission from a script —
and still not press the button.

`DEV_AUTH=1` in `.env.local` turns on `/dev-signin`: a list of the seeded users,
one click each. It sets a cookie holding an `authUserId` that already exists in
the database, and `getSessionUser` looks it up exactly as it looks up the id
Supabase would have returned. **Nothing downstream changes** — role checks,
practice scoping, the status guardrail and the audit trail are all the real
ones, which is the only reason a local run is worth anything.

It cannot be switched on where it would matter. `NODE_ENV === "production"` and
`VERCEL` are both checked before the opt-in, so a production build or any
deployment answers 404 on that route and redirects to `/login` as before.
`/api/health` reports `devAuth` so a deployment could say otherwise if it ever
did. Verified both ways at runtime, not just asserted.

A red banner sits on every page while it is on. That is deliberate: a screen
reached through this door must never be mistakable for the real thing.

**Use it.** Two of this codebase's worst bugs — an export that read "not
recorded" everywhere, and a portal action pointing at a page with no microphone
— survived a green lint, typecheck and build. A third, the form wiping twenty
answers when the server refused one, survived all of that *plus* a suite of
checks that drove the server action directly. It was found in a browser, in one
click.

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
reports `schemaUpToDate` and names what is missing, and the write, signup and
settings screens each say so rather than crashing.

### `db.<ref>.supabase.co` is unreachable from Vercel, and nothing says so

This one cost days and produced what looked like half a dozen unrelated bugs.
Supabase's **direct** host is IPv6-only unless the IPv4 add-on is bought, and
Vercel's build machines are IPv4. So the string the Supabase Connect panel
presents as "the direct connection" — and that the Supabase-to-Vercel integration
writes into `DIRECT_URL` for you — can *never* connect from a build. It fails
P1001 on every deployment, the build continues by design, and the schema quietly
stays behind the code.

Correcting it in the dashboard did not stick, repeatedly: the value is copied out
of a panel that does not include the right host, and the integration can rewrite
it. So the script no longer depends on it being right. It tries the configured
`DIRECT_URL` first — someone who bought the add-on, or is on plain Postgres, is
correct and must not be overridden — and then falls back to a **session pooler**
URL derived from `DATABASE_URL`, since the session pooler is the same host as the
transaction pooler on port 5432 with the pgbouncer flags removed. It never prints
a connection string; the host and port are enough to tell attempts apart.

The runtime half of the same problem is in `src/lib/prisma.ts`: port 6543 is
PgBouncer in transaction mode, and without `pgbouncer=true` Prisma's prepared
statements produce 42P05 and 26000 errors at random on whichever page loaded.
That flag is now derived from the port rather than relied upon in the URL, for
the same reason — every copy-paste step between Supabase and Vercel drops it.

Without either `DIRECT_URL` or `DATABASE_URL` the script skips entirely. Note it
does *not* skip merely because `DIRECT_URL` is unset: a local `DATABASE_URL` is
used, so `npm run build` against a development database migrates it.

It also skips on **Vercel preview builds** (`VERCEL_ENV` set to anything but
`production`). One Supabase project sits behind every environment, so a preview
shares the production database — and a preview is built from a branch nobody has
merged. Ungated, opening a pull request would apply that branch's migrations to
the live database, and a migration that drops a column would break production
while the change was still being discussed. `VERCEL_ENV` is unset off Vercel, so
CI and self-hosted builds still migrate the database they were handed.

**The shadow database must never be the one the build migrates.** `migrate diff`
replays every migration into its shadow from nothing, and it *resets that
database first* — so pointing it at `DATABASE_URL` both fails with P3006 and
wipes the schema the build just applied. CI creates a separate `shadow` database
for this; locally it is the second database in the setup above. This bit CI the
moment the build started migrating, and the failure reads as schema drift when
it is nothing of the kind.

### `.env` and CI both hide the one environment that matters

The fallback chain above shipped broken and passed everything: a green local
build, a green CI run, and a green production build that quietly applied
nothing. Prisma validates the *whole* datasource block before it uses any of it,
and `url` is `env("DATABASE_URL")` — so on a deployment carrying only the
integration's `POSTGRES_*` variables, every candidate died with P1012
"Environment variable not found: DATABASE_URL" before a single connection was
attempted. `spawnSync` now sets `DATABASE_URL` and `DIRECT_URL` both, to the
same candidate; `migrate deploy` connects through `directUrl` and `url` only has
to be present and well-formed.

Nothing caught it because nothing *could*. A developer has `DATABASE_URL` in
`.env`, which Prisma loads by itself — the log line "Environment variables
loaded from .env" is the tell — and CI has it in the workflow's `env:` block.
Production is the only place without one, so production was the only place the
code path ran at all.

Two habits come out of this, and both are cheap:

- **Test with `env -u DATABASE_URL` and `.env` moved aside** when touching
  anything that resolves a connection string. `env -u` alone is not enough.
- **Do not filter stderr out of a verification run.** The first check of this
  path piped through `grep '^\[migrate\]'`, which showed the script's own
  narration and dropped Prisma's P1012 underneath it. It read as a network
  failure against a fake host. A filter that hides the failure you are looking
  for is worse than no filter.

CI now runs `migrate-on-deploy.mjs` against a scratch database with only
`POSTGRES_PRISMA_URL` set and asserts every migration applied, so the shape that
only production has is exercised on every push.

### `/api/health` compares the migration ledger, not a hand-picked column

It used to probe two specific things a past migration had added. That reported
`schemaUpToDate: true` against a database missing `ShareLink.documentKind`, which
is worse than reporting nothing — the build log tells you to check this endpoint,
so a false green sends you looking somewhere else. A canary chosen by hand only
detects the lag it was written for.

It now reads `_prisma_migrations` and diffs it against `EXPECTED_MIGRATIONS` in
`src/lib/db/migrations.generated.ts`, which `scripts/write-migration-manifest.mjs`
regenerates from the migrations directory on every build (the directory is not in
a Next.js server bundle, so the list has to be baked in). The generated file is
committed because `typecheck` and `dev` do not run the build chain, and CI runs
the script with `--check` so a stale copy is a red build. The response names the
missing migrations rather than only counting them — a migration name is a folder
name in the repository, not a secret.

### A schema lag takes down every page, not the ones you would guess

`getSessionUser` selects the whole `User` row, and `requireRole` — which every
page and every server action goes through — calls it. So a database missing any
recent `User` column throws P2022 *there*, and the entire signed-in product dies
with a blank "server-side exception", the root redirect included.

This cost a lot of time because the symptoms name the wrong thing. Per-screen
"migrations pending" banners were added to `/t/write` and `/s/settings` and
appeared to do nothing at all: both screens crash inside `requireRole`, several
frames before their own first line runs. Anything that has to stay reachable
while the schema is behind belongs *above* the session layer, not inside a page.

The session layer now raises `SchemaBehindError` (`src/lib/db/schemaLag.ts`) and
redirects to `/setup-required`, which is unauthenticated for the same reason
`/api/health` is: the condition being reported is the one that breaks signing in.
It fails closed — nobody is admitted on a lagging schema — because carrying on
with defaults for the missing columns keeps the app looking usable while writes
fail deeper in, which relocates the confusion rather than ending it.

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

### One base URL, and it broke everything that leaves the building

`siteUrl()` fell back to `http://localhost:3000` when `NEXT_PUBLIC_SITE_URL` was
unset, which it was in production. A clinician sent a note writer
`http://localhost:3000/share/<token>`. The PDF was stored, the token was valid,
the row was in the database — and the link opened nothing on anybody's phone.

The same function builds invitations, the password-set redirect, status
confirmation links and the roster PDF, so one unset variable broke every one of
them simultaneously. And it is invisible from inside: every page works, the send
reports success, and only the recipient ever sees the problem.

It is derived now rather than depended upon.
`VERCEL_PROJECT_PRODUCTION_URL` is preferred **even on previews**, because a
share link must outlive the deployment that made it — it sits in somebody's
WhatsApp for days — and every deployment shares one database and one bucket, so
production can serve a link a preview created. `VERCEL_URL` is per-deployment
and changes on every push; a link built from it works when you test it and dies
at the next merge, which is the worse failure. Last resort only.

`/api/health` reports `outboundLinks`, and it is **not** optional. A deployment
that cannot produce a reachable link is not ready, however well it renders.

### Is the handwriting reader actually working?

`readHandwriting` cannot tell you, on purpose: absent key, rejected key,
withdrawn model, empty completion and timeout all return `null` so the workspace
degrades to typing rather than to an error page. That is right for a clinician
mid-session and useless for deciding whether to promise the feature to a
customer.

`/api/health/ocr` makes a real call with a generated image reading "NOTE OK" and
reports which of those it is — `NO_KEY`, `UNAUTHORIZED`, `MODEL_UNAVAILABLE`,
`RATE_LIMITED`, `EMPTY_CONTENT`, `BAD_SHAPE`, `UNREADABLE`, `TIMEOUT`,
`NETWORK`. It is authenticated, unlike `/api/health`, because it spends money on
a metered API and a public URL would let anyone run up the bill.

`EMPTY_CONTENT` is the one worth knowing about. K3 reasons before it writes, so
a tight token budget is spent thinking and returns a 200 with nothing in it,
still billed. It reads exactly like a dead key. Raise `max_tokens` or lower
`KIMI_REASONING_EFFORT`.

The test image is generated rather than committed — a 5x7 bitmap scaled up and
encoded as greyscale PNG in `src/lib/ai/probe.ts`. A checked-in binary would
work and would also be unreviewable.

## There are tests now, and they use a real database

`npm test` — Node's built-in runner over `tests/*.test.ts`, no framework added.
It needs `DATABASE_URL` and runs in CI after the build, because the build is
what applies migrations to the CI database.

**They talk to PostgreSQL on purpose.** Every bug this codebase has actually
shipped passed a type check and a build: an export where every section read
"not recorded", a picker whose answers all hashed identically, a form that wiped
itself when the server refused it. Mocking Prisma would reproduce that exact
blind spot — it would assert that the code calls the functions it calls.

Four areas, chosen because they are the ones that must never break: the status
guardrail, `submitEncounter`, duplicate detection, and the export plus the
completeness gate. Each file builds its own practice with its own code and
deletes it afterwards, so files run in any order and nothing depends on the seed.

The suite earned itself on the first run: it asked for a client with status
`OTHER`, which the specification lists and the requirements marked **DONE**, and
the insert failed because the enum had five values. That clause had been wrong
for months behind a green build.

Assert on **content**, not on calls. The ZIP test walks the archive's own local
file headers and inflates them rather than trusting the builder's report,
because the two export bugs were both "the function ran and produced the wrong
bytes".

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
