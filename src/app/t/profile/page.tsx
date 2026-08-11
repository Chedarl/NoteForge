import { requireRole } from "@/lib/auth/session";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import DisciplineForm from "@/components/therapist/DisciplineForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireRole(["THERAPIST", "OWNER", "SPECIALIST"]);

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Your discipline</h1>
        <p className="mt-1 text-sm text-slate-600">
          {user.discipline
            ? `Currently recorded as ${DISCIPLINE_LABEL[user.discipline]}.`
            : "This has not been set yet, and notes cannot be submitted until it is."}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          It selects which templates you are offered, so the right information is collected,
          and it is stamped on every note you submit so whoever writes it up downstream knows
          what kind of note it should be.
        </p>
      </div>

      <DisciplineForm current={user.discipline} />
    </div>
  );
}
