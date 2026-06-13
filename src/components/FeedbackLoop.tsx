"use client";

import { useEffect, useState } from "react";
import {
  getFeedbackLoop,
  getGlobalFeedbackLoop,
  type FeedbackLoop as LoopData,
} from "@/app/actions";

const SEV_COLOR: Record<string, string> = {
  None: "#10b981",
  Mild: "#eab308",
  Moderate: "#d97706",
  Severe: "#e5484d",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function FeedbackLoop({
  recallNumber,
}: {
  /** Omit for a network-wide view across all recalls (pre-run live monitor). */
  recallNumber?: string;
}) {
  const isGlobal = !recallNumber;
  const [data, setData] = useState<LoopData | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const d = recallNumber
          ? await getFeedbackLoop(recallNumber)
          : await getGlobalFeedbackLoop();
        if (alive) setData(d);
      } catch {
        /* transient — keep last */
      }
    }
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [recallNumber]);

  const surveyUrl = recallNumber
    ? `/feedback/${encodeURIComponent(recallNumber)}`
    : null;
  const agg = data?.aggregate;
  const order = ["Severe", "Moderate", "Mild", "None"] as const;
  const maxSev = agg
    ? Math.max(1, ...order.map((s) => agg.bySeverity[s]))
    : 1;
  // Per-recall mode: surface check-ins for OTHER recalls in a separate strip.
  // Global mode: the recent list already spans all recalls, so no extra strip.
  const otherRecalls = isGlobal
    ? []
    : (data?.network ?? []).filter((f) => f.recall_number !== recallNumber);
  // The "recent check-ins" list: per-recall uses `recent`; global uses `network`
  // (each entry carries its recall_number for labeling).
  const recentList = isGlobal ? (data?.network ?? []) : (data?.recent ?? []);

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          Closing the loop — patient outcomes{" "}
          <span className="font-normal text-slate-400">
            · live, de-identified{isGlobal ? " · network-wide" : ""}
          </span>
        </h2>
        {surveyUrl && (
          <a
            href={surveyUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-700"
          >
            Open patient check-in ↗
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1fr_1.1fr]">
        {/* FDA aggregate */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            FDA real-world signal{isGlobal ? " · all recalls" : ""}
          </h3>
          <div className="mt-3 flex items-baseline gap-4">
            <div>
              <div className="text-2xl font-bold tabular-nums text-slate-900">
                {fmt(agg?.total ?? 0)}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                reports
              </div>
            </div>
            <div>
              <div
                className="text-2xl font-bold tabular-nums"
                style={{ color: "#e5484d" }}
              >
                {Math.round((agg?.adverseRate ?? 0) * 100)}%
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                adverse
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {order.map((s) => {
              const v = agg?.bySeverity[s] ?? 0;
              return (
                <div key={s} className="flex items-center gap-2">
                  <span className="w-16 text-[11px] text-slate-500">{s}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.round((v / maxSev) * 100)}%`,
                        background: SEV_COLOR[s],
                      }}
                    />
                  </div>
                  <span className="w-6 text-right text-[11px] tabular-nums text-slate-400">
                    {v}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pharmacy task queue */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Pharmacy action queue
          </h3>
          <div className="mt-3 space-y-2">
            {!data?.tasks.length && (
              <p className="text-xs text-slate-300">No follow-ups yet…</p>
            )}
            {data?.tasks.map((t) => (
              <div
                key={t.task_id}
                className="rounded-xl border border-slate-100 bg-slate-50 p-2.5"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${
                      t.priority === "urgent" ? "bg-red-600" : "bg-slate-400"
                    }`}
                  >
                    {t.priority}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {isGlobal && t.recall_number ? `${t.recall_number} · ` : ""}
                    {t.patient_ref} · {t.state}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-slate-600">
                  {t.reason}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent reports */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Recent patient check-ins
          </h3>
          <div className="mt-3 space-y-2">
            {!recentList.length && (
              <p className="text-xs text-slate-300">Waiting for reports…</p>
            )}
            {recentList.map((f, i) => (
              <div
                key={i}
                className="flex items-start gap-2 border-b border-slate-50 pb-2 last:border-0"
              >
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: SEV_COLOR[f.symptom_severity] ?? "#94a3b8" }}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    {isGlobal && "recall_number" in f && (
                      <span className="font-mono text-slate-400">
                        {(f as { recall_number: string }).recall_number}
                      </span>
                    )}
                    <span className="font-mono">{f.patient_ref}</span>
                    <span>·</span>
                    <span>{f.state}</span>
                    <span>·</span>
                    <span className="font-medium text-slate-700">
                      {f.symptom_severity}
                    </span>
                    {f.channel === "voice" && (
                      <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-700">
                        voice
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-slate-600">
                    {f.symptoms_text || "No symptoms reported"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Network-wide check-ins (other recalls) — clearly separated from the
          active recall's per-recall outcome cards above. */}
      {otherRecalls.length > 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Network-wide check-ins{" "}
            <span className="font-normal text-slate-400">
              · other active recalls
            </span>
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {otherRecalls.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-2.5 py-1.5 shadow-sm"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: SEV_COLOR[f.symptom_severity] ?? "#94a3b8" }}
                />
                <span className="font-mono text-[10px] text-slate-400">
                  {f.recall_number}
                </span>
                <span className="text-[11px] font-medium text-slate-700">
                  {f.symptom_severity}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-slate-300">
                  {f.channel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
