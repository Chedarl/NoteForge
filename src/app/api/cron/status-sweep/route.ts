import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMail, siteUrl } from "@/lib/email/send";
import { signConfirmToken } from "@/lib/auth/signedLink";
import { writeAudit } from "@/lib/audit";
import { logSafe } from "@/lib/redact";

/**
 * The daily sweep: ask about clients who have gone quiet.
 *
 * This is the half of the status problem that a guardrail alone cannot solve.
 * Blocking a note against a discharged client only works once *somebody has
 * told us* they were discharged, and the entire original complaint was that
 * nobody does. So the system asks, on its own schedule, about exactly the
 * clients where the answer is most likely to have changed: still marked active,
 * no session for longer than the practice's own staleness window.
 *
 * ## One cron, once a day
 *
 * Vercel's free tier allows two cron jobs at daily granularity. That is not a
 * constraint worth engineering around — status changes are a human-timescale
 * event, and a question that arrives every morning is one people answer, while
 * one that arrives hourly is one people filter.
 *
 * ## Not asked twice
 *
 * An unanswered confirmation suppresses the next one for the same client. A
 * reminder every morning about the same person trains a clinician to ignore the
 * entire channel, which would cost us the one mechanism we have.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Fail closed: a missing secret is a deployment error, never permission to run.
  // Accept the secret only in the Authorization header so it cannot leak through
  // URL logs, browser history, analytics or referrers.
  if (!secret) {
    logSafe("cron.status-sweep", "CRON_SECRET is not configured");
    return NextResponse.json({ error: "Cron is not configured." }, { status: 503 });
  }

  const authorized = request.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorized) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const practices = await prisma.practice.findMany({
    select: { id: true, name: true, staleDays: true },
  });

  let asked = 0;

  for (const practice of practices) {
    const staleBefore = new Date();
    staleBefore.setDate(staleBefore.getDate() - practice.staleDays);

    const clients = await prisma.client.findMany({
      where: {
        practiceId: practice.id,
        status: "ACTIVE",
        primaryTherapistId: { not: null },
        OR: [{ lastEncounterAt: null }, { lastEncounterAt: { lt: staleBefore } }],
        // Nothing already outstanding for this client.
        statusConfirmations: { none: { respondedAt: null } },
      },
      include: { primaryTherapist: { select: { id: true, email: true, fullName: true, status: true } } },
      take: 100,
    });

    for (const client of clients) {
      const therapist = client.primaryTherapist;
      if (!therapist || therapist.status !== "ACTIVE") continue;

      try {
        const confirmation = await prisma.statusConfirmation.create({
          data: {
            practiceId: practice.id,
            clientId: client.id,
            therapistId: therapist.id,
            askedStatus: client.status,
          },
        });

        const token = await signConfirmToken(confirmation.id);
        const link = `${siteUrl()}/confirm/${token}`;

        await sendMail({
          to: therapist.email,
          subject: `NoteForge — is ${client.clientCode} still in treatment?`,
          text: [
            `${client.clientCode} is still marked Active but has had no session recorded for ${practice.staleDays} days.`,
            "",
            "One tap either way, no login needed:",
            link,
            "",
            "If they have been discharged, transferred, paused or have died, telling us now stops notes being produced against the wrong record.",
          ].join("\n"),
        });

        await writeAudit({
          practiceId: practice.id,
          actor: null,
          action: "confirmation.requested",
          entityType: "confirmation",
          entityId: confirmation.id,
          entityLabel: client.clientCode,
        });

        asked++;
      } catch (error) {
        // One failed client must not abandon the rest of the sweep.
        logSafe("cron.status-sweep", "could not ask", {
          clientId: client.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return NextResponse.json({ ok: true, asked });
}
