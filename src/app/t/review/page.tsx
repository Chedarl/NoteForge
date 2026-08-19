import { requireRole } from "@/lib/auth/session";
import { pendingReviews } from "@/lib/field/reviewQueue";
import { identityOf } from "@/lib/clients/identity";
import { openText } from "@/lib/crypto/text";
import { displayPolicyFor } from "@/lib/clients/displayPolicy";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { fmtDate } from "@/lib/utils";
import { EmptyState } from "@/components/shared/ui";
import ReviewCard from "@/components/therapist/ReviewCard";

export const dynamic = "force-dynamic";

/**
 * What the clinician's field workers have sent, waiting to be read.
 *
 * This queue is the reason the supervised link exists. Everything here has been
 * through the status guardrail and duplicate detection already — what it has
 * not been through is a clinician, and until it has, it is somebody's
 * recollection of a doorstep visit rather than a clinical record. Nothing
 * leaves for documentation without a name and a timestamp against it.
 */
export default async function ReviewPage() {
  const user = await requireRole(["OWNER", "THERAPIST", "SPECIALIST"]);
  const naming = await displayPolicyFor(user.practiceId);
  const waiting = await pendingReviews(user.id, user.practiceId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waiting for you</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
          Updates your field workers have sent. Read each one, add anything the person writing
          the note should know, and approve it — nothing goes to documentation until you do.
        </p>
      </div>

      {waiting.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="When a worker you have given a link to sends an update, it appears here for you to read."
        />
      ) : (
        <div className="space-y-3">
          {waiting.map((submission) => (
            <ReviewCard
              key={submission.id}
              submissionId={submission.id}
              clientCode={submission.client.clientCode}
              clientName={identityOf(naming, submission.client).displayName}
              workerName={submission.submittedBy.fullName}
              workerRole={
                submission.submittedBy.discipline
                  ? DISCIPLINE_LABEL[submission.submittedBy.discipline]
                  : "Field worker"
              }
              when={fmtDate(submission.encounterDate)}
              text={openText(submission.rawTextEnc) ?? ""}
            />
          ))}
        </div>
      )}
    </div>
  );
}
