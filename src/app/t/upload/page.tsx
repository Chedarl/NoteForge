import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import PhotoUpload from "@/components/therapist/PhotoUpload";
import { readerConfigured } from "@/lib/ai/reader";
import { identityOf } from "@/lib/clients/identity";
import { EmptyState } from "@/components/shared/ui";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const user = await requireRole(["THERAPIST", "OWNER"]);

  const clients = await prisma.client.findMany({
    where: {
      practiceId: user.practiceId,
      ...(user.role === "THERAPIST" ? { primaryTherapistId: user.id } : {}),
    },
    orderBy: [{ status: "asc" }, { clientCode: "asc" }],
    select: {
      id: true,
      clientCode: true,
      initials: true,
      status: true,
      givenNameEnc: true,
      familyInitial: true,
      birthYear: true,
    },
  });

  if (!user.discipline) {
    return (
      <EmptyState
        title="Set your discipline first"
        body="It is stamped on every submission and decides what kind of note is written from it. One click on the Your discipline page."
      />
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Photograph paper notes</h1>
      <p className="mt-1 text-sm text-slate-600">
        For handwritten notes you already have on paper. Photograph each page flat, in the
        best light you can find — every unreadable word becomes a query back to you later.
      </p>
      <p className="mt-2 text-sm text-slate-600">
        {readerConfigured()
          ? "Pages are transcribed automatically and then checked by a person before anything is typed up."
          : "Automatic transcription is not configured on this deployment, so pages will be typed by hand. Everything else works exactly the same."}
      </p>
      <PhotoUpload
        clients={clients.map((client) => ({
          id: client.id,
          clientCode: client.clientCode,
          label: identityOf(client).displayName ?? client.initials,
          status: client.status,
        }))}
      />
    </div>
  );
}
