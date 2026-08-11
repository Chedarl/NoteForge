import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import VerifyWorkspace from "@/components/specialist/VerifyWorkspace";
import { StatusBadge } from "@/components/shared/ui";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["OWNER", "SPECIALIST"]);
  const { id } = await params;

  const submission = await prisma.submission.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      client: true,
      submittedBy: { select: { fullName: true } },
      pages: { orderBy: { pageNumber: "asc" } },
    },
  });
  if (!submission) notFound();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href="/s" className="text-sm text-slate-500 underline">
          ← Queue
        </Link>
        <h1 className="text-lg font-semibold">{submission.client.clientCode}</h1>
        <StatusBadge status={submission.client.status} />
        <span className="text-sm text-slate-500">
          Session {fmtDate(submission.encounterDate)} · from {submission.submittedBy.fullName}
        </span>
      </div>

      {submission.rawText ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm">
          <span className="font-medium text-sky-900">Note from the therapist: </span>
          <span className="text-sky-800">{submission.rawText}</span>
        </div>
      ) : null}

      <VerifyWorkspace
        submissionId={submission.id}
        pages={submission.pages.map((page) => ({
          id: page.id,
          pageNumber: page.pageNumber,
          imageUrl: `/api/media/${page.storagePath}`,
          ocrText: page.ocrText,
          ocrConfidence: page.ocrConfidence,
          ocrProvider: page.ocrProvider,
          blocks: (page.ocrBlocks as { text: string; confidence: number }[] | null) ?? null,
          verifiedText: page.verifiedText,
        }))}
      />
    </div>
  );
}
