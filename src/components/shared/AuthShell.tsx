import BrandLogo from "@/components/shared/BrandLogo";

export default function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f4f8fb] px-4 py-8 sm:px-6 lg:flex lg:items-center">
      <div className="pointer-events-none absolute -top-40 -right-32 h-96 w-96 rounded-full bg-cyan-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-blue-200/45 blur-3xl" />

      <div className="relative mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_28px_90px_-34px_rgba(5,30,65,0.38)] lg:grid-cols-[0.95fr_1.05fr]">
        <aside className="relative overflow-hidden bg-[#020713] px-7 py-9 text-white sm:px-10 lg:flex lg:min-h-[650px] lg:flex-col lg:justify-between lg:p-12">
          <div className="absolute -top-28 -left-24 h-72 w-72 rounded-full bg-[#008da3]/25 blur-3xl" />
          <div className="absolute -right-32 bottom-0 h-80 w-80 rounded-full bg-[#063776]/45 blur-3xl" />
          <div className="relative">
            <BrandLogo className="w-full max-w-sm" />
            <p className="mt-7 max-w-md text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              Clinical material in. Clear, controlled handoff out.
            </p>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-300">
              One calm workspace for clinicians, note specialists, and practice owners—from
              structured intake to an auditable final handoff.
            </p>
          </div>

          <div className="relative mt-8 grid gap-3 text-sm text-slate-200 sm:grid-cols-3 lg:grid-cols-1">
            {[
              ["Private by design", "Practice-scoped access and minimized identity."],
              ["Simple for teams", "Each role lands in the portal built for its work."],
              ["Ready to hand off", "Create an expiring PDF link and open WhatsApp."],
            ].map(([heading, body]) => (
              <div key={heading} className="rounded-xl border border-white/10 bg-white/[0.045] p-3.5 backdrop-blur">
                <p className="font-semibold text-white">{heading}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex flex-col justify-center px-6 py-9 sm:px-10 lg:px-14 lg:py-12">
          <p className="text-xs font-bold tracking-[0.18em] text-[#087f8c] uppercase">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-600">{description}</p>
          {children}
        </section>
      </div>
    </main>
  );
}
