import LoginForm from "@/components/shared/LoginForm";
import AuthShell from "@/components/shared/AuthShell";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; timedOut?: string }>;
}) {
  const { next, error, timedOut } = await searchParams;

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to your workspace"
      description="Continue with your clients, production queue, or practice administration. Your role opens the right portal automatically."
    >
      {/*
        Said plainly, because the alternative is somebody deciding the app
        logged them out at random and losing confidence in it. It is also the
        only place the timeout is ever visible — everything else about it
        happens silently in the middleware.
      */}
      {timedOut ? (
        <p role="status" className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          You were signed out after a period of inactivity. That is deliberate — this
          workspace holds clinical information and should not sit open on an unattended
          screen. Sign in to carry on.
        </p>
      ) : null}

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