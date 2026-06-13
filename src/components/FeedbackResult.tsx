import type { ProcessFeedbackResult } from "@/lib/feedback";

const RESULT_THEME: Record<
  string,
  { ring: string; badge: string; title: string }
> = {
  Severe: {
    ring: "border-red-300 bg-red-50",
    badge: "bg-red-600",
    title: "Please seek care now",
  },
  Moderate: {
    ring: "border-amber-300 bg-amber-50",
    badge: "bg-amber-500",
    title: "Contact a clinician soon",
  },
  Mild: {
    ring: "border-yellow-200 bg-yellow-50",
    badge: "bg-yellow-500",
    title: "Keep an eye on it",
  },
  None: {
    ring: "border-emerald-200 bg-emerald-50",
    badge: "bg-emerald-500",
    title: "Thanks — you're all set",
  },
};

export default function FeedbackResult({
  result,
}: {
  result: ProcessFeedbackResult;
}) {
  const t = result.triage;
  const theme = RESULT_THEME[t.symptomSeverity] ?? RESULT_THEME.None;
  return (
    <div className={`rounded-2xl border p-6 ${theme.ring}`}>
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-white ${theme.badge}`}
        >
          {t.symptomSeverity}
        </span>
        <h2 className="text-xl font-semibold text-slate-900">{theme.title}</h2>
      </div>

      <p className="mt-4 text-slate-800">{t.action}</p>
      <p className="mt-2 text-sm text-slate-600">{t.rationale}</p>

      {t.priority === "urgent" && (
        <div className="mt-4 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white">
          If this is an emergency, call 911 now. Your pharmacy has been notified
          to prioritize a primary-care visit for you.
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-700">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Your care team has been looped in
        </div>
        <ul className="space-y-1">
          <li>🏥 Pharmacy — flagged to follow up with you</li>
          <li>
            🩺 In-network provider —{" "}
            <span className="font-medium">{result.notified.provider}</span>
          </li>
          <li>
            🛡️ Insurer —{" "}
            <span className="font-medium">{result.notified.insurer}</span>
            {t.priority === "urgent" ? " (fast-tracking an urgent visit)" : ""}
          </li>
        </ul>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-4 text-xs text-slate-600">
        <div>
          Report ID{" "}
          <span className="font-mono">{result.feedbackId.slice(0, 8)}</span>{" "}
          recorded as <span className="font-mono">{result.patientRef}</span>.
        </div>
        {result.taskId ? (
          <div className="mt-1">
            Routed to your pharmacy as a{" "}
            <span className="font-semibold">{t.priority}</span> follow-up.
          </div>
        ) : (
          <div className="mt-1">No follow-up needed — stay safe.</div>
        )}
      </div>
    </div>
  );
}
