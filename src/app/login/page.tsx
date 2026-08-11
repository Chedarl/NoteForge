import LoginForm from "@/components/shared/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">NoteForge</h1>
      <p className="mt-1 text-sm text-slate-600">
        Intake, verification and insight for clinical note production.
      </p>
      <LoginForm next={next ?? ""} />
      <p className="mt-8 text-xs text-slate-400">
        Access is logged. This service holds clinical material and is not for general use.
      </p>
    </main>
  );
}
