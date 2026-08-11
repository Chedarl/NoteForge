import SignupForm from "@/components/shared/SignupForm";
import AuthShell from "@/components/shared/AuthShell";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <AuthShell
      eyebrow="Start your workspace"
      title="Create your NoteForge portal"
      description="Register your practice in a few minutes. You become the workspace owner and can invite clinicians and note specialists after signing in."
    >
      <SignupForm />
      <p className="mt-6 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
        Free-tier hosting is for synthetic or heavily redacted pilot data only. It is not a
        HIPAA-compliant environment for identifiable clinical information.
      </p>
    </AuthShell>
  );
}
