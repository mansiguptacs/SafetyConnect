export default function Home() {
  const stack = [
    { label: "Vercel", role: "Next.js hosting + API" },
    { label: "Inngest", role: "Durable ingestion, orchestration & Realtime" },
    { label: "xAI Grok", role: "Severity triage + patient alerts" },
    { label: "ClickHouse", role: "Recall + patient cohort store" },
  ];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Phase 0 — scaffold online
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
          SafetyConnect
        </h1>
        <p className="max-w-xl text-lg text-slate-600">
          An autonomous consumer-defense shield that ingests live FDA drug
          recalls, triages their severity with AI, matches them against a
          national patient cohort, and dispatches instant alerts.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {stack.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900">
              {s.label}
            </div>
            <div className="text-sm text-slate-500">{s.role}</div>
          </div>
        ))}
      </section>

      <footer className="text-sm text-slate-400">
        Inngest endpoint mounted at{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
          /api/inngest
        </code>
      </footer>
    </main>
  );
}
