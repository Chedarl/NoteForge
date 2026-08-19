"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { openText } from "@/lib/crypto/text";
import { requireRole } from "@/lib/auth/session";
import { identityOf } from "@/lib/clients/identity";
import { displayPolicyFor } from "@/lib/clients/displayPolicy";
import { STATUS_LABEL } from "@/lib/clients/labels";
import { renderRosterPdf, type RosterRow } from "@/lib/export/rosterPdf";
import { normalizeWhatsAppNumber } from "@/lib/sharing/phone";
import { safeSegment } from "@/lib/export/zip";
import { writeAudit } from "@/lib/audit";
import { logSafe } from "@/lib/redact";
import { storeSharedPdf, whatsappHandoff } from "@/lib/sharing/store";
import { siteUrl } from "@/lib/email/send";

/**
 * "Here is who I am carrying, and who is still open."
 *
 * The practice keeps having to ask a case worker which of their clients are
 * still active, and the answer arrives — when it arrives — as a message or a
 * verbal update that nobody can reconcile against anything later. That is the
 * same collation problem the session updates had, so it gets the same shape: a
 * document, generated from the record rather than retyped, sent the way the
 * clinician already communicates.
 *
 * It reports the status **as recorded**. It does not ask the clinician to
 * re-assert it in a free-text box, because a list that disagrees with the
 * database is worse than no list: the guardrail refuses submissions on the
 * stored status, so a roster claiming somebody is active when the record says
 * discharged would be actively misleading. Correcting a status is a separate,
 * audited action, and this document is downstream of it.
 */

export interface RosterState {
  error?: string;
  success?: {
    filename: string;
    total: number;
    active: number;
    /** Present when a share link was made — the path that needs no Cloud API. */
    whatsappUrl?: string;
    /**
     * The six digits, shown once. Null when the sender chose to send unlocked.
     *
     * Must reach the screen. Issuing a passcode and not displaying it would lock
     * the recipient out of a document the sender believes they have just handed
     * over — a failure that looks exactly like the link being broken.
     */
    passcode?: string | null;
  };
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function sendClientRoster(
  _prev: RosterState,
  formData: FormData
): Promise<RosterState> {
  const user = await requireRole(["THERAPIST", "OWNER"]);

  // The caseload PDF goes to a note writer too, so the same override applies.
  const naming = await displayPolicyFor(user.practiceId);
  const includeNames = formData.get("includeNames") === "on" && !naming.safeMode;
  const activeOnly = formData.get("activeOnly") === "on";

  const clients = await prisma.client.findMany({
    where: {
      practiceId: user.practiceId,
      // A therapist sends their own caseload. An owner sending the practice's
      // whole list is a different, larger disclosure and is not this button.
      ...(user.role === "THERAPIST" ? { primaryTherapistId: user.id } : {}),
      ...(activeOnly ? { status: "ACTIVE" } : {}),
    },
    include: { _count: { select: { submissions: true } } },
    // Active first, then most recently seen: the question this answers is "who
    // is still open", so the answer should not need scrolling to.
    orderBy: [{ status: "asc" }, { lastEncounterAt: "desc" }],
  });

  if (clients.length === 0) {
    return { error: "There are no clients to list yet." };
  }

  const rows: RosterRow[] = clients.map((client) => {
    const identity = identityOf(naming, client);
    return {
      clientCode: client.clientCode,
      name: includeNames ? identity.displayName : null,
      initials: client.initials,
      status: STATUS_LABEL[client.status],
      statusSince: iso(client.statusChangedAt) ?? "unknown",
      statusReason: openText(client.statusReasonEnc),
      lastSession: iso(client.lastEncounterAt),
      submissions: client._count.submissions,
    };
  });

  const activeCount = clients.filter((c) => c.status === "ACTIVE").length;
  const practice = await prisma.practice.findUnique({
    where: { id: user.practiceId },
    select: { name: true, code: true, noteWriterWhatsApp: true },
  });

  let pdf: Buffer;
  try {
    pdf = await renderRosterPdf({
      practiceName: practice?.name ?? "Practice",
      clinician: user.fullName,
      clinicianRole: user.discipline
        ? user.discipline.replace(/_/g, " ").toLowerCase()
        : user.role.toLowerCase(),
      generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + "Z",
      rows,
      activeCount,
      identifiable: includeNames,
    });
  } catch (error) {
    logSafe("roster", "pdf build failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "The client list could not be built. Please try again." };
  }

  const segment = (value: string) => safeSegment(value).replace(/[\s_]+/g, "-");
  const filename = `${segment(practice?.code ?? "practice")}_${new Date()
    .toISOString()
    .slice(0, 10)}_client-list.pdf`;

  const typed = String(formData.get("sendTo") ?? "").trim();
  if (typed && !normalizeWhatsAppNumber(typed)) {
    return {
      error: "That WhatsApp number does not look right. Use the international form, like +1 415 555 0123.",
    };
  }
  const destination = typed || practice?.noteWriterWhatsApp || null;

  /*
   * A link, never the document — and this path was the one that still pushed it.
   *
   * `sendLink` replaced `sendDocument` everywhere else when the WhatsApp handoff
   * was hardened, and this call site was missed. So on any deployment with the
   * Cloud API configured, a clinician's **entire caseload** — every client code,
   * every status including "Deceased" and "Transferred", every last-session
   * date, and their first names whenever the box was ticked — was pushed to
   * Meta as an attachment and left permanently in a chat history and whatever
   * backs that phone up. That is a larger disclosure than any single session
   * PDF, which is exactly what the checkbox on this form says.
   *
   * The link was already being made below as a fallback for deployments without
   * the Cloud API. It is now the only route, so the bytes stay in the practice's
   * own bucket where the expiry, the download ceiling and revocation all apply.
   *
   * `sendDocument` remains in `whatsapp/send.ts`, documented as not for clinical
   * use, and now has no callers.
   */
  const stored = await storeSharedPdf({
    user,
    bytes: new Uint8Array(pdf),
    documentKind: "roster",
    submissionId: null,
    auditLabel: `${rows.length} clients, ${activeCount} active`,
    /*
     * Locked, and the same rule the round share uses: a list carrying names is
     * locked with no opt-out, a de-identified one is locked by default and the
     * sender may decline. A caseload is the largest single disclosure this
     * product can produce, so "bearer-only" — which is what this was — is the
     * wrong default for it whichever way the name box was set.
     */
    requirePasscode: includeNames || formData.get("unlocked") !== "yes",
  });

  /*
   * Audited here as well as in `storeSharedPdf`, and not redundantly.
   *
   * That helper writes `share.created`, which records that a link was minted.
   * It does not record the two things a practice is actually asked about a
   * caseload disclosure: whether it carried names, and whether it was the whole
   * list or only the active clients. `roster.shared_with_names` stays a distinct
   * action from `roster.shared` for the same reason the export does.
   */
  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: stored.ok
      ? includeNames
        ? "roster.shared_with_names"
        : "roster.shared"
      : "roster.share_failed",
    entityType: "client",
    entityId: user.id,
    entityLabel: `${rows.length} clients, ${activeCount} active`,
    changes: {
      identifiable: { from: null, to: includeNames },
      scope: { from: null, to: activeOnly ? "active only" : "all clients" },
      delivery: { from: null, to: "expiring link" },
    },
  });

  let whatsappUrl: string | undefined;
  if (stored.ok) {
    whatsappUrl = whatsappHandoff({
      phone: destination,
      siteUrl: siteUrl(),
      token: stored.share.token,
      ttlHours: stored.share.ttlHours,
      // A count and a date. Never a name — this message sits in a chat preview.
      lead: `A NoteForge client list is ready: ${activeCount} active of ${rows.length}.`,
    }).whatsappUrl;
  } else {
    // No link and nothing else to fall back on now that the document is never
    // pushed. Say why rather than claiming success.
    return { error: stored.error };
  }

  revalidatePath("/t");

  return {
    success: {
      filename,
      total: rows.length,
      active: activeCount,
      whatsappUrl,
      passcode: stored.ok ? stored.share.passcode : null,
    },
  };
}
