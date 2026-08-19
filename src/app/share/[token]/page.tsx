import { createHash } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { unlockCookieName, unlockMatches } from "@/lib/sharing/passcode";
import ShareUnlockForm from "@/components/shared/ShareUnlockForm";

export const dynamic = "force-dynamic";

/**
 * What the recipient sees when they tap the link.
 *
 * This used to be a route handler that returned the PDF bytes directly, and two
 * things were wrong with that.
 *
 * **Messengers prefetch links.** WhatsApp fetches a URL to build its preview
 * card, and the old handler counted every GET as a download. The ten-download
 * allowance could be spent before the recipient ever tapped it, and the link
 * would be dead on arrival with no explanation. Looking at the page is now free;
 * only `/download` claims one.
 *
 * **A binary response is a bad landing.** Opened inside WhatsApp's in-app
 * browser, a direct PDF download is inconsistent — sometimes a blank tab,
 * sometimes a silent save, occasionally nothing at all. A page with a button
 * behaves the same everywhere, and it lets the recipient see what they have
 * been sent, when it expires and how many downloads are left before they
 * commit.
 *
 * Nothing identifying is on this page. It is unauthenticated by design — that
 * is the point of a share link — so it says what *kind* of document it is and
 * never whose.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const tokenHash = valid ? createHash("sha256").update(token).digest("hex") : "";
  const share = valid
    ? await prisma.shareLink.findUnique({
        where: { tokenHash },
        select: {
          documentKind: true,
          expiresAt: true,
          revokedAt: true,
          downloadCount: true,
          maxDownloads: true,
          passcodeHash: true,
          passcodeLockedAt: true,
        },
      })
    : null;

  const now = new Date();
  const unavailable =
    !share ||
    share.revokedAt !== null ||
    share.expiresAt <= now ||
    share.downloadCount >= share.maxDownloads ||
    // A link somebody guessed at five times is finished, and it reads the same
    // as one that expired. Saying "this was locked by wrong codes" would
    // confirm to the guesser that the link was real.
    share.passcodeLockedAt !== null;

  if (unavailable) {
    return (
      <Shell title="This link is no longer available">
        <p className="mt-3 text-[0.95rem] leading-relaxed text-slate-600">
          It may have expired, been withdrawn, or reached its download limit. Ask whoever
          sent it for a new one — creating another takes them a moment.
        </p>
      </Shell>
    );
  }

  const remaining = share.maxDownloads - share.downloadCount;
  const hours = Math.max(1, Math.round((share.expiresAt.getTime() - now.getTime()) / 3_600_000));

  /*
   * The code question, when there is one.
   *
   * Shown instead of the download button rather than beside it, because the
   * document is genuinely not available until it is answered — the download
   * route checks the same cookie, so a recipient who bookmarked the download
   * URL last week does not get to skip this.
   */
  if (share.passcodeHash) {
    const jar = await cookies();
    const unlocked = unlockMatches(tokenHash, jar.get(unlockCookieName(tokenHash))?.value);
    if (!unlocked) {
      return (
        <Shell title={titleFor(share.documentKind)}>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-slate-600">
            {descriptionFor(share.documentKind)} It is locked with a short code.
          </p>
          <ShareUnlockForm token={token} />
        </Shell>
      );
    }
  }

  return (
    <Shell title={titleFor(share.documentKind)}>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-slate-600">
        {descriptionFor(share.documentKind)}
      </p>

      <a
        href={`/share/${token}/download`}
        className="nf-btn nf-btn-primary mt-6 w-full justify-center sm:w-auto"
      >
        Download the PDF
      </a>

      <dl className="mt-6 grid gap-3 border-t border-[color:var(--nf-border)] pt-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Expires</dt>
          <dd className="mt-0.5 text-slate-800">
            in about {hours} hour{hours === 1 ? "" : "s"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Downloads left
          </dt>
          <dd className="mt-0.5 text-slate-800">
            {remaining} of {share.maxDownloads}
          </dd>
        </div>
      </dl>

      <p className="mt-6 text-xs leading-relaxed text-slate-500">
        This document contains clinical information. Anyone with this link can download it
        until it expires, so please do not forward it.
      </p>
    </Shell>
  );
}

function titleFor(kind: string): string {
  if (kind === "roster") return "A client list is ready";
  if (kind === "round") return "Client updates are ready";
  return "A client update is ready";
}

function descriptionFor(kind: string): string {
  if (kind === "roster") {
    return "It lists the clinician's clients and which of them are still accepting notes.";
  }
  if (kind === "round") {
    return "One PDF covering several clients, a page each, for writing notes from.";
  }
  return "Source material for writing the note, as a PDF.";
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <div className="nf-card px-6 py-7">
        <p className="text-xs font-bold tracking-[0.18em] text-[color:var(--nf-accent)] uppercase">
          NoteForge
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {children}
      </div>
    </main>
  );
}
