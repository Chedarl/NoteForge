# Deploying NoteForge — free, no domain

Two free accounts, about fifteen minutes, and you end up with a working URL like
`noteforge-yourname.vercel.app`. No card, no DNS, no custom domain.

Read [SECURITY.md](SECURITY.md) first if you intend to put anything real into it.

---

## 1. Supabase (database, auth, storage)

1. Create a free project at [supabase.com](https://supabase.com). Any region near you;
   keep the database password you set.
2. **Project Settings → API** gives you:
   - `NEXT_PUBLIC_SUPABASE_URL` — the Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the publishable/anon key
   - `SUPABASE_SECRET_KEY` — the service-role/secret key. Server-side only, never
     exposed to a browser.
3. **Connect** (top of the dashboard) gives you two connection strings:
   - `DATABASE_URL` — the **transaction pooler**, port 6543. Append `?pgbouncer=true`.
   - `DIRECT_URL` — the **session pooler**, port 5432. Migrations use this.
4. **Authentication → Providers → Email**: turn off "Confirm email" for the pilot, or
   confirm the seeded accounts by hand.
5. **Authentication → Multi-Factor**: enable TOTP. Turn it on for your owner and
   specialist accounts.

The free tier gives 500 MB of database and 1 GB of storage. A photographed page after
client-side downscaling is roughly 300–600 KB, so that is on the order of two thousand
pages.

> Free Supabase projects **pause after a week of inactivity**. They resume from the
> dashboard with nothing lost, but a paused project means a broken demo — so wake it
> before you show anyone.

## 2. Local setup

```bash
git clone <this repo> && cd noteforge
npm install
cp .env.example .env.local
```

Fill in the six Supabase values, then generate the three secrets:

```bash
openssl rand -base64 48   # CONFIRM_LINK_SECRET
openssl rand -base64 48   # FIELD_ENCRYPTION_KEY   <- back this one up separately
openssl rand -base64 32   # CRON_SECRET
openssl rand -base64 32   # RATE_LIMIT_SALT
```

`FIELD_ENCRYPTION_KEY` encrypts client first names. Keep a copy somewhere that is not the
database — if the database and the key are backed up together, the encryption has bought
you nothing. Lose it and the names are unrecoverable; nothing else is affected, because
every screen and every filename identifies clients by their practice code.

Then:

```bash
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

The seed creates the practice, four Supabase Auth accounts, eight clients and eleven
submissions, and both private storage buckets. It is idempotent — run it again whenever.

## 3. Vercel

1. Push to GitHub, then **Add New → Project** at [vercel.com](https://vercel.com) and
   import the repository. Framework detection handles the rest.
2. Paste every variable from `.env.local` into **Settings → Environment Variables**.
   Set `NEXT_PUBLIC_SITE_URL` to the `*.vercel.app` URL Vercel gives you — it is needed
   for the links in confirmation emails, and there is no reason to buy a domain for a
   pilot.
3. Deploy.

`vercel.json` registers one daily cron for the staleness sweep. The Hobby plan allows two
crons at daily granularity, which is exactly right here: status changes are a
human-timescale event and a question asked every morning gets answered, while one asked
hourly gets filtered.

## 4. Optional extras

Both of these are genuinely optional. The product is complete without them; it is just
slower and quieter.

**Handwriting OCR and draft assistance** — set `KIMI_API_KEY` from
[platform.moonshot.ai](https://platform.moonshot.ai). Without it, photographed pages
arrive with an empty transcript box and get typed by hand, which is exactly the process
NoteForge replaces. Nothing errors.

**Email** — set `RESEND_API_KEY` and `EMAIL_FROM` from [resend.com](https://resend.com).
Their free tier sends 3 000/month from `onboarding@resend.dev` with no domain needed.
Without it, status alerts and confirmation requests are recorded in-app and logged but
not sent — the records stay correct either way.

## 5. Check it works

```bash
# The cron route must refuse an unauthenticated call
curl -i https://your-app.vercel.app/api/cron/status-sweep          # 401
curl -i -H "Authorization: Bearer $CRON_SECRET" \
     https://your-app.vercel.app/api/cron/status-sweep             # {"ok":true,...}

# A private page image must not be readable without a session
curl -i https://your-app.vercel.app/api/media/note-pages/whatever  # 401
```

Then in the browser, as the seeded therapist `therapist2@noteforge.test`: try to write a
note for `RVN-0108`. If it is refused with the status, the date and the reason — and your
text is preserved rather than thrown away — the guardrail is live and the deployment is
working.

## Costs

Zero, at pilot volume. Vercel Hobby, Supabase free, Resend free. Kimi is pay-as-you-go
and the only line that can cost anything: roughly one vision call per photographed page,
and one small text call per flagged duplicate pair. Structured intake — the path the
product pushes people towards — makes no model calls at all.
