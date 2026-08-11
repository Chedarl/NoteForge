import LoginForm from "@/components/shared/LoginForm";
import AuthShell from "@/components/shared/AuthShell";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to your workspace"
      description="Continue with your clients, production queue, or practice administration. Your role opens the right portal automatically."
    >
      {error ? (
        <p role="alert" className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          That email link is invalid or has expired. Sign in below, or ask your practice
          owner for a new invitation.
        </p>
      ) : null}
      <LoginForm next={next ?? ""} />
      <p className="mt-6 text-xs leading-relaxed text-slate-400">
        Access is logged. Only use the account assigned to you and sign out on shared devices.
      </p>
    </AuthShell>
  );
}