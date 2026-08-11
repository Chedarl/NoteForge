/**
 * Seed — a working practice, not an empty shell.
 *
 * A blank database is a demo you cannot give and a product you cannot test. So
 * this creates a small practice with the situations NoteForge exists to handle
 * already in it: a client who died, a note somebody tried to file against them
 * afterwards, the same session handed over twice, and two accounts of one
 * session that disagree about risk.
 *
 * Every one of those is reachable in the UI within a minute of `npm run dev`,
 * which is the point — the features that are hardest to describe in a sentence
 * are the ones you want a practice to *see* happen.
 *
 * Idempotent: run it as often as you like. Upserts everywhere, and Supabase
 * accounts are looked up before they are created.
 *
 * The clinical text below is invented. It is deliberately bland and generic —
 * plausible enough to exercise the duplicate detector, empty enough that
 * nothing here resembles a real person's session.
 */

import { PrismaClient, type ClientStatus, type TemplateKind } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const prisma = new PrismaClient();

// ── Local copies of the normalisation helpers ────────────────────────────────
// The seed runs under tsx outside Next's module resolution, so `@/` paths are
// not available. These mirror src/lib/dedupe/normalize.ts; if the thresholds
// there change, the seeded near-duplicate pair still exercises the same path.
const STOPWORDS = new Set(
  ("a about after again all also am an and any are as at be been being but by can could did do " +
    "does during each for from further had has have he her here him his how i if in into is it its " +
    "just me more most my no not of on or other our out over own same she should so some such than " +
    "that the their them then there these they this those through to too under until up very was we " +
    "were what when where which while who will with would you your subjective objective assessment " +
    "plan data behaviour behavior intervention response narrative session client notes note").split(" ")
);

function tokenize(input: string): string[] {
  const words = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  const kept = new Set<string>();
  for (const word of words) {
    if (!word || STOPWORDS.has(word)) continue;
    if (word.length < 3 && !/^\d+$/.test(word)) continue;
    kept.add(word);
  }
  return [...kept].sort();
}

const normalized = (text: string) => tokenize(text).join(" ");
const hashOf = (text: string) =>
  createHash("sha256").update(normalized(text)).digest("hex");

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 0, 0, 0);
  return d;
};

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const password = process.env.SEED_PASSWORD || "ChangeMe!2026";

  const practice = await prisma.practice.upsert({
    where: { code: "RVN" },
    update: {},
    create: {
      name: "Riverbend Therapy Associates",
      code: "RVN",
      slaHours: 48,
      staleDays: 60,
    },
  });
  console.log(`✓ practice ${practice.name}`);

  // ── Staff ────────────────────────────────────────────────────────────────
  const people = [
    { email: "owner@noteforge.test", fullName: "Dana Okoro", role: "OWNER" as const },
    { email: "specialist@noteforge.test", fullName: "Sam Whitfield", role: "SPECIALIST" as const },
    { email: "therapist1@noteforge.test", fullName: "Dr Priya Raman", role: "THERAPIST" as const },
    { email: "therapist2@noteforge.test", fullName: "Dr Marcus Bell", role: "THERAPIST" as const },
  ];

  const users: Record<string, { id: string }> = {};
  for (const person of people) {
    const authUserId = await ensureAuthUser(person.email, password);
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { fullName: person.fullName, role: person.role, practiceId: practice.id },
      create: {
        authUserId: authUserId ?? `local-${person.email}`,
        email: person.email,
        fullName: person.fullName,
        role: person.role,
        practiceId: practice.id,
      },
    });
    users[person.role === "THERAPIST" ? person.email : person.role] = user;
    console.log(`✓ user ${person.email} (${person.role})`);
  }

  const priya = users["therapist1@noteforge.test"];
  const marcus = users["therapist2@noteforge.test"];
  const specialist = users.SPECIALIST;

  // ── Clients, across the whole status range ───────────────────────────────
  const clientSpecs: {
    code: string;
    initials: string;
    birthYear: number;
    status: ClientStatus;
    reason?: string;
    therapistId: string;
  }[] = [
    { code: "RVN-0101", initials: "A.M.", birthYear: 1988, status: "ACTIVE", therapistId: priya.id },
    { code: "RVN-0102", initials: "J.T.", birthYear: 1995, status: "ACTIVE", therapistId: priya.id },
    { code: "RVN-0103", initials: "K.S.", birthYear: 1979, status: "ACTIVE", therapistId: marcus.id },
    { code: "RVN-0104", initials: "L.D.", birthYear: 2001, status: "ACTIVE", therapistId: marcus.id },
    {
      code: "RVN-0105", initials: "P.N.", birthYear: 1966, status: "ON_HOLD",
      reason: "Client travelling for three months; sessions paused by agreement.",
      therapistId: priya.id,
    },
    {
      code: "RVN-0106", initials: "R.F.", birthYear: 1992, status: "DISCHARGED",
      reason: "Treatment goals met; discharged at review with client agreement.",
      therapistId: marcus.id,
    },
    {
      code: "RVN-0107", initials: "T.W.", birthYear: 1984, status: "TRANSFERRED",
      reason: "Moved out of area; care transferred to Northgate Psychology.",
      therapistId: priya.id,
    },
    {
      code: "RVN-0108", initials: "H.B.", birthYear: 1957, status: "DECEASED",
      reason: "Notified by family 4 weeks after the event. Recorded on notification.",
      therapistId: marcus.id,
    },
  ];

  const clients: Record<string, { id: string; clientCode: string }> = {};
  for (const spec of clientSpecs) {
    const client = await prisma.client.upsert({
      where: { practiceId_clientCode: { practiceId: practice.id, clientCode: spec.code } },
      update: {},
      create: {
        practiceId: practice.id,
        clientCode: spec.code,
        initials: spec.initials,
        birthYear: spec.birthYear,
        status: spec.status,
        statusReason: spec.reason ?? null,
        statusChangedAt: spec.status === "ACTIVE" ? daysAgo(200) : daysAgo(30),
        primaryTherapistId: spec.therapistId,
        lastEncounterAt: spec.status === "ACTIVE" ? daysAgo(6) : daysAgo(45),
      },
    });
    clients[spec.code] = client;

    const events = await prisma.clientStatusEvent.count({ where: { clientId: client.id } });
    if (events === 0) {
      await prisma.clientStatusEvent.create({
        data: {
          clientId: client.id,
          fromStatus: null,
          toStatus: "ACTIVE",
          source: "SEED",
          createdAt: daysAgo(200),
        },
      });
      if (spec.status !== "ACTIVE") {
        await prisma.clientStatusEvent.create({
          data: {
            clientId: client.id,
            fromStatus: "ACTIVE",
            toStatus: spec.status,
            reason: spec.reason ?? null,
            source: "THERAPIST_UPDATE",
            changedById: spec.therapistId,
            createdAt: daysAgo(30),
          },
        });
      }
    }
  }
  console.log(`✓ ${clientSpecs.length} clients (1 deceased, 1 discharged, 1 transferred, 1 on hold)`);

  // One client deliberately left silent, so the staleness sweep has something
  // real to find on the very first run.
  await prisma.client.update({
    where: { id: clients["RVN-0104"].id },
    data: { lastEncounterAt: daysAgo(95) },
  });

  // ── Submissions ──────────────────────────────────────────────────────────
  if ((await prisma.submission.count({ where: { practiceId: practice.id } })) === 0) {
    await seedSubmissions({
      practiceId: practice.id,
      clients,
      priyaId: priya.id,
      marcusId: marcus.id,
      specialistId: specialist.id,
    });
  } else {
    console.log("· submissions already present, left alone");
  }

  await ensureStorageBuckets();

  console.log("\nSign in with any of:");
  for (const person of people) console.log(`  ${person.email}  /  ${password}`);
  console.log("\nThe three things worth trying first:");
  console.log("  1. As Dr Marcus Bell, file a note for RVN-0108 — it is refused, with the reason.");
  console.log("  2. As Sam Whitfield, open the queue's Flagged tab — a duplicate and a contradiction.");
  console.log("  3. Open Insights — the status-block rate is the guardrail's scoreboard.");
}

// ─────────────────────────────────────────────────────────────────────────────

async function seedSubmissions(ctx: {
  practiceId: string;
  clients: Record<string, { id: string }>;
  priyaId: string;
  marcusId: string;
  specialistId: string;
}) {
  const { practiceId, clients, priyaId, marcusId, specialistId } = ctx;

  const make = async (spec: {
    clientCode: string;
    submittedById: string;
    templateKind: TemplateKind;
    encounterDaysAgo: number;
    createdDaysAgo: number;
    fields: Record<string, string>;
    state?: "QUEUED" | "DONE" | "BLOCKED" | "NEEDS_VERIFY";
    kind?: "STRUCTURED" | "PHOTO";
  }) => {
    const text = Object.entries(spec.fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n\n");
    return prisma.submission.create({
      data: {
        practiceId,
        clientId: clients[spec.clientCode].id,
        submittedById: spec.submittedById,
        kind: spec.kind ?? "STRUCTURED",
        templateKind: spec.templateKind,
        state: spec.state ?? "QUEUED",
        encounterDate: daysAgo(spec.encounterDaysAgo),
        fields: spec.fields,
        rawText: text,
        contentHash: hashOf(text),
        normalizedText: normalized(text),
        createdAt: daysAgo(spec.createdDaysAgo),
      },
    });
  };

  // Four ordinary delivered notes, so the turnaround and completeness figures
  // on the insights page are real rather than zeroes.
  for (let i = 0; i < 4; i++) {
    const submission = await make({
      clientCode: i % 2 === 0 ? "RVN-0101" : "RVN-0103",
      submittedById: i % 2 === 0 ? priyaId : marcusId,
      templateKind: "SOAP",
      encounterDaysAgo: 30 - i * 6,
      createdDaysAgo: 29 - i * 6,
      fields: {
        Subjective: `Client reported a steadier week. Sleep improved to around six hours. Described one difficult conversation at work on ${["Monday", "Tuesday", "Thursday", "Friday"][i]} that they managed without avoiding it.`,
        Objective: "Attended on time, engaged throughout, affect brighter than last session. No indicators of risk raised or observed.",
        Assessment: "Continued gradual improvement in mood and daytime functioning. Behavioural activation is holding.",
        Plan: "Continue weekly. Keep the sleep log. Review the work situation next session.",
      },
      state: "DONE",
    });

    const note = await prisma.note.create({
      data: {
        practiceId,
        clientId: submission.clientId,
        submissionId: submission.id,
        templateKind: "SOAP",
        body: submission.fields as object,
        state: "DELIVERED",
        authoredById: specialistId,
        signedById: specialistId,
        signedAt: daysAgo(28 - i * 6),
        deliveredAt: daysAgo(28 - i * 6),
        createdAt: daysAgo(29 - i * 6),
      },
    });
    await prisma.noteTag.create({
      data: {
        noteId: note.id,
        kind: i === 3 ? "GOAL_STALLED" : "GOAL_PROGRESS",
        label: i === 3 ? "workplace boundary goal" : "sleep and activation goal",
        createdAt: daysAgo(28 - i * 6),
      },
    });
  }

  // The duplicate: the same session handed over twice, three days apart,
  // because the therapist was not sure the first one arrived.
  const original = await make({
    clientCode: "RVN-0102",
    submittedById: priyaId,
    templateKind: "DAP",
    encounterDaysAgo: 9,
    createdDaysAgo: 8,
    fields: {
      Data: "Client described ongoing difficulty with early waking, typically around 4am, and low motivation in the mornings. Reported that the breathing exercise helps at night but not on waking. Denied any thoughts of self-harm when asked directly.",
      Assessment: "Sleep disruption persists and is the main maintaining factor for daytime low mood. No current risk indicators.",
      Plan: "Introduce a wind-down routine. Review sleep diary next week. Continue weekly sessions.",
    },
  });

  const duplicate = await make({
    clientCode: "RVN-0102",
    submittedById: priyaId,
    templateKind: "DAP",
    encounterDaysAgo: 9,
    createdDaysAgo: 5,
    fields: {
      Data: "Client described continuing early waking around 4am with low motivation in the mornings. Said the breathing exercise helps at night but not on waking. Denied thoughts of self-harm on direct questioning.",
      Assessment: "Ongoing sleep disruption remains the main maintaining factor for low mood during the day. No current risk indicators.",
      Plan: "Introduce a wind-down routine, review the sleep diary next week, continue weekly.",
    },
  });

  await prisma.submissionFlag.create({
    data: {
      submissionId: duplicate.id,
      relatedSubmissionId: original.id,
      kind: "NEAR_DUPLICATE",
      score: 0.86,
      detail:
        "86% of the meaningful terms also appear in a submission for this client from three days earlier, for the same encounter date.",
      createdAt: daysAgo(5),
    },
  });

  // The contradiction: two accounts of overlapping sessions that cannot both be
  // true about risk. This is the case token overlap alone would never catch —
  // the two documents share nearly every word.
  const riskA = await make({
    clientCode: "RVN-0103",
    submittedById: marcusId,
    templateKind: "BIRP",
    encounterDaysAgo: 4,
    createdDaysAgo: 4,
    fields: {
      Behaviour: "Presented flat and tired. Described a difficult fortnight following the bereavement. Denied any suicidal ideation when asked directly, and said they would contact the service if that changed.",
      Intervention: "Grief-focused session. Reviewed the safety plan and confirmed it was still current.",
      Response: "Engaged well, tearful at points, able to name two supports outside the household.",
      Plan: "Weekly sessions continue. Safety plan reviewed and unchanged.",
    },
  });

  const riskB = await make({
    clientCode: "RVN-0103",
    submittedById: marcusId,
    templateKind: "BIRP",
    encounterDaysAgo: 3,
    createdDaysAgo: 2,
    fields: {
      Behaviour: "Presented flat and tired. Described a difficult fortnight since the bereavement. Reported passive suicidal ideation, present most days this week, with no plan and no intent.",
      Intervention: "Grief-focused session. Safety plan revisited and updated with an additional contact.",
      Response: "Engaged, tearful, able to name supports. Agreed to the updated plan.",
      Plan: "Increase to twice weekly for a fortnight. Safety plan updated.",
    },
  });

  await prisma.submissionFlag.create({
    data: {
      submissionId: riskB.id,
      relatedSubmissionId: riskA.id,
      kind: "CONFLICT",
      score: 0.79,
      detail:
        "Possible contradiction (risk): the earlier submission records suicidal ideation denied on direct questioning, this one records passive ideation present most days over the same period.",
      createdAt: daysAgo(2),
    },
  });

  // The one this product was built for: a note filed against a client who died.
  // Kept, refused, flagged — never silently dropped.
  const blocked = await make({
    clientCode: "RVN-0108",
    submittedById: marcusId,
    templateKind: "SOAP",
    encounterDaysAgo: 40,
    createdDaysAgo: 12,
    state: "BLOCKED",
    fields: {
      Subjective: "Client reported a settled week with fewer episodes of breathlessness at night.",
      Objective: "Attended, engaged, no concerns raised.",
      Assessment: "Stable.",
      Plan: "Review in two weeks.",
    },
  });

  await prisma.submissionFlag.create({
    data: {
      submissionId: blocked.id,
      kind: "STATUS_BLOCK",
      detail: "Submitted against a client marked Deceased since 30 days ago.",
      createdAt: daysAgo(12),
    },
  });

  // A photo submission waiting on a human to confirm its transcript. No image
  // is seeded — there is nothing appropriate to ship — so the page carries the
  // empty-transcript path, which is exactly what happens with no OCR key.
  await make({
    clientCode: "RVN-0101",
    submittedById: priyaId,
    templateKind: "NARRATIVE",
    kind: "PHOTO",
    encounterDaysAgo: 2,
    createdDaysAgo: 1,
    state: "NEEDS_VERIFY",
    fields: {},
  });

  console.log("✓ 11 submissions (1 near-duplicate pair, 1 contradiction, 1 status block, 1 awaiting verification)");
}

// ─────────────────────────────────────────────────────────────────────────────

/** Creates the Supabase Auth account, or finds it if the seed has run before. */
async function ensureAuthUser(email: string, password: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.warn(`! Supabase env missing — ${email} created without an auth account`);
    return null;
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!error && data.user) return data.user.id;

  // Already there from a previous run — find it rather than failing the seed.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email === email);
  if (existing) return existing.id;

  console.warn(`! could not create or find auth user ${email}: ${error?.message}`);
  return null;
}

/**
 * Both buckets are private and both stay private.
 *
 * `createBucket` applies its options only when it actually creates the bucket,
 * so a bucket made before these limits existed would keep the old ones forever
 * and silently accept a 40 MB upload. Re-applying with `updateBucket` on the
 * already-exists path is what makes this file the enforcement point rather than
 * a suggestion.
 */
async function ensureStorageBuckets() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.warn("! Supabase env missing — skipping storage buckets");
    return;
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const buckets = [
    {
      name: "note-pages",
      options: {
        public: false,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
        fileSizeLimit: "15MB",
      },
    },
    {
      name: "note-exports",
      options: { public: false, allowedMimeTypes: ["text/csv", "application/pdf"], fileSizeLimit: "10MB" },
    },
  ];

  for (const { name, options } of buckets) {
    const { error } = await admin.storage.createBucket(name, options);
    if (error && /exist/i.test(error.message)) {
      const { error: updateError } = await admin.storage.updateBucket(name, options);
      console.log(`✓ storage bucket ${name}${updateError ? " (limits NOT reapplied)" : " (limits reapplied)"}`);
    } else if (error) {
      console.warn(`! storage bucket ${name}: ${error.message}`);
    } else {
      console.log(`✓ storage bucket ${name}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
