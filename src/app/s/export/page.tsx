import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { identityOf } from "@/lib/clients/identity";
import { fieldCryptoConfigured } from "@/lib/crypto/field";
import ExportForm from "@/components/specialist/ExportForm";

export const dynamic = "force-dynamic";

/**
 * Download the material, per client or as a batch.
 *
 * This page is where NoteForge hands over. Everything upstream — the guardrail,
 * the verification, the duplicate flags — exists so that what comes out of here
 * is clean, correctly attributed and tied to a real session date.
 */
export default async function ExportPage() {
  const user = await requireRole(["OWNER", "SPECIALIST"]);

  const clients = await prisma.client.findMany({
    where: { practiceId: user.practiceId },
    orderBy: [{ status: "asc" }, { clientCode: "asc" }],
    include: { _count: { select: { submissions: true } } },
  });

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Download session material</h1>
        <p className="mt-1 text-sm text-slate-600">
          One folder per client, one file per session date, in both JSON and Markdown.
          Every session carries its date, the clinician&apos;s discipline and the
          client&apos;s status, so a note can be written from a single file.
        </p>
      </div>

      <ExportForm
        clients={clients.map((client) => {
          const identity = identityOf(client);
          return {
            id: client.id,
            clientCode: client.clientCode,
            displayName: identity.displayName,
            initials: client.initials,
            status: client.status,
            submissionCount: client._count.submissions,
          };
        })}
        namesAvailable={fieldCryptoConfigured()}
      />
    </div>
  );
}
