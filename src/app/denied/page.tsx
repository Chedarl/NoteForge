import Link from "next/link";

export default function Denied() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-xl font-semibold">Not your area</h1>
      <p className="mt-2 text-sm text-slate-600">
        Your account does not have access to that part of NoteForge. If you think it should,
        ask the practice owner — roles are managed there, not here.
      </p>
      <Link href="/" className="mt-6 text-sm font-medium text-sky-700 underline">
        Back to your own workspace
      </Link>
    </main>
  );
}
