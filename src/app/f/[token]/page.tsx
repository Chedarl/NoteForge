import type { Metadata } from "next";
import { resolveFieldLink } from "@/lib/field/links";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import FieldUpdateForm from "@/components/field/FieldUpdateForm";

export const dynamic = "force-dynamic";

/**
 * The field worker's whole product.
 *
 * Unauthenticated by design — the token in the URL is the credential, because a
 * recovery coach standing outside somebody's house is not going to type a
 * password. That places the entire access decision in `resolveFieldLink`, which
 * is why that function returns a bare null for a malformed token, an unknown
 * one, a revoked link and a suspended agent alike: four different reasons, one
 * indistinguishable outcome, so a stranger poking at URLs learns nothing about
 * which they hit.
 *
 * Nothing about a client is on this page before an update is filed — no list,
 * no history, no names. A link that leaks would expose the ability to *send*
 * something into a practice, which is bad and recoverable; a link that leaked a
 * caseload would not be.
 */
export const metadata: Metadata = {
  title: "Send an update — NoteForge",
  robots: { index: false, follow: false },
};

export default async function FieldPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await resolveFieldLink(token);

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
        <h1 className="text-xl font-semibold text-slate-900">This link is no longer active</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          It may have been withdrawn, or it may never have been a link at all. Ask whoever sent
          it for a new one — it takes them a moment.
        </p>
      </main>
    );
  }

  const { agent } = session;

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 py-8">
      <header className="mb-6">
        <p className="text-xs font-bold tracking-[0.16em] text-[#087f8c] uppercase">
          Field update
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950">
          {agent.fullName}
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          {agent.discipline ? DISCIPLINE_LABEL[agent.discipline] : "Field worker"}
        </p>
      </header>

      <FieldUpdateForm token={token} agentName={agent.fullName} />

      <section className="mt-8 border-t border-[color:var(--nf-border)] pt-5">
        <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
          Before you speak an update
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Dictation uses your phone&rsquo;s own speech recognition, which sends what you say to
          Google or Apple depending on your browser. Nothing is recorded or stored here — only
          the words you can see, after you have checked them. If you would rather not, type it.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Keep to a first name and last initial. Everything else about the person stays with the
          office.
        </p>
      </section>
    </main>
  );
}
