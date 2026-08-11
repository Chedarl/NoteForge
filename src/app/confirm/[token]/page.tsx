import { prisma } from "@/lib/prisma";
import { readConfirmToken } from "@/lib/auth/signedLink";
import { STATUS_LABEL } from "@/lib/clients/guard";
import ConfirmForm from "@/components/shared/ConfirmForm";

export const dynamic = "force-dynamic";

/**
 * The one page in NoteForge that does not require a session.
 *
 * It authenticates with a signed, short-lived, single-purpose token instead,
 * and that is a deliberate trade. A confirmation link that opens a login screen
 * gets ignored on a phone between sessions, the client stays stale, and we are
 * back to learning somebody died from a rejected note weeks later. The whole
 * mechanism only works if answering takes one tap.
 *
 * What the token can do is correspondingly tiny: read one client's code and
 * status, and answer one question about it. It cannot reach a note, a queue, a
 * list of clients, or anything else in the practice.
 */
export default async function ConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const confirmationId = await readConfirmToken(token);

  if (!confirmationId) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">This link has expired</h1>
        <p className="mt-2 text-sm text-slate-600">
          Confirmation links last two weeks. Sign in and update the client&apos;s status
          directly, or wait for the next request.
        </p>
      </Shell>
    );
  }

  const confirmation = await prisma.statusConfirmation.findUnique({
    where: { id: confirmationId },
    include: {
      client: { select: { clientCode: true, status: true, lastEncounterAt: true } },
      therapist: { select: { fullName: true } },
    },
  });

  if (!confirmation) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-slate-600">This request no longer exists.</p>
      </Shell>
    );
  }

  if (confirmation.respondedAt) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Already answered</h1>
        <p className="mt-2 text-sm text-slate-600">
          {confirmation.client.clientCode} is recorded as{" "}
          {STATUS_LABEL[confirmation.client.status]}. Thank you — nothing else is needed.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold">Is {confirmation.client.clientCode} still in treatment?</h1>
      <p className="mt-2 text-sm text-slate-600">
        They are marked {STATUS_LABEL[confirmation.client.status]} and no session has been
        recorded
        {confirmation.client.lastEncounterAt
          ? ` since ${confirmation.client.lastEncounterAt.toLocaleDateString("en-GB")}`
          : " at all"}
        .
      </p>
      <ConfirmForm token={token} />
      <p className="mt-6 text-xs text-slate-400">
        This link answers one question about one client and can do nothing else.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      {children}
    </main>
  );
}
