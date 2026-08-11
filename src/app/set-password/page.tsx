import SetPasswordForm from "@/components/shared/SetPasswordForm";
import AuthShell from "@/components/shared/AuthShell";

export const dynamic = "force-dynamic";

export default function SetPasswordPage() {
  return (
    <AuthShell
      eyebrow="Invitation accepted"
      title="Finish your account"
      description="Choose a strong password. Once saved, NoteForge opens the portal assigned to your team role."
    >
      <SetPasswordForm />
    </AuthShell>
  );
}
