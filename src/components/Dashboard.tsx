"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtime } from "inngest/react";
import { runChannel, type StageName } from "@/inngest/channels";
import { launchDefense, getRealtimeToken } from "@/app/actions";
import type { GlobalStats, PharmacyLocation } from "@/lib/queries";
import UsMap, { type MapPoint } from "./UsMap";
import FeedbackLoop from "./FeedbackLoop";

type Severity = "Lethal" | "Moderate" | "Minor";

const SEVERITY_ACCENT: Record<Severity, string> = {
  Lethal: "#e5484d",
  Moderate: "#d97706",
  Minor: "#2563eb",
};
const NEUTRAL = "#475569";

// Stable reference so useRealtime doesn't resubscribe on every render.
const TOPICS: ("lifecycle" | "stage")[] = ["lifecycle", "stage"];

const STAGES: { key: StageName; label: string }[] = [
  { key: "fda_alert", label: "FDA recall" },
  { key: "ingested", label: "Ingested" },
  { key: "severity_classified", label: "Severity (xAI)" },
  { key: "cohort_identified", label: "Cohort match" },
  { key: "message_drafted", label: "Message" },
  { key: "dispatched", label: "Dispatch" },
  { key: "card_rendered", label: "Patient card" },
  { key: "cited", label: "Audit" },
];

interface RecallView {
  recallNumber: string;
  index: number;
  total: number;
  stages: Partial<Record<StageName, Record<string, unknown>>>;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function Dashboard({
  stats,
  locations,
}: {
  stats: GlobalStats;
  locations: PharmacyLocation[];
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);

  const basepoints = useMemo<MapPoint[]>(() => {
    // Sample the base network so the map stays light.
    const step = Math.max(1, Math.floor(locations.length / 2500));
    return locations
      .filter((_, i) => i % step === 0)
      .map((l) => ({ lat: l.lat, lon: l.lon }));
  }, [locations]);

  // Memoize the subscription inputs so a re-render (e.g. each incoming stage
  // message) doesn't tear down and re-open the WebSocket mid-run — which would
  // drop the stages published during the reconnect gap.
  const channel = useMemo(() => runChannel(runId ?? "idle"), [runId]);
  const token = useCallback(
    () => getRealtimeToken(runId as string),
    [runId],
  );

  const { messages, connectionStatus } = useRealtime({
    channel,
    topics: TOPICS,
    token,
    enabled: Boolean(runId),
  });

  const { recalls, activeIndex, started, complete } = useMemo(() => {
    const map = new Map<number, RecallView>();
    let activeIndex = 0;
    let started = false;
    let complete = false;
    for (const m of messages.all) {
      if (m.topic === "lifecycle") {
        const d = m.data as { type: string };
        if (d.type === "run_started") started = true;
        if (d.type === "run_complete") complete = true;
      } else if (m.topic === "stage") {
        const d = m.data as {
          stage: StageName;
          recallNumber: string;
          recallIndex: number;
          recallTotal: number;
          data: Record<string, unknown>;
        };
        const rv = map.get(d.recallIndex) ?? {
          recallNumber: d.recallNumber,
          index: d.recallIndex,
          total: d.recallTotal,
          stages: {},
        };
        rv.stages[d.stage] = d.data;
        map.set(d.recallIndex, rv);
        activeIndex = d.recallIndex;
      }
    }
    return {
      recalls: [...map.values()].sort((a, b) => a.index - b.index),
      activeIndex,
      started,
      complete,
    };
  }, [messages.all]);

  useEffect(() => {
    setViewIndex(activeIndex);
  }, [activeIndex]);

  const recall = recalls.find((r) => r.index === viewIndex) ?? recalls[0];

  const severity = (recall?.stages.severity_classified?.severity ??
    recall?.stages.cohort_identified?.severity) as Severity | undefined;
  const accent = severity ? SEVERITY_ACCENT[severity] : NEUTRAL;

  const cohort = recall?.stages.cohort_identified as
    | {
        customers: number;
        pharmacies: number;
        states: number;
        byState: { state: string; customers: number }[];
        points: { lat: number; lon: number; customers: number }[];
      }
    | undefined;

  async function onLaunch() {
    setLaunching(true);
    try {
      const { runId: id } = await launchDefense({ limit: 1, holdMs: 1600 });
      setRunId(id);
    } finally {
      setLaunching(false);
    }
  }

  const lastStage = STAGES.filter((s) => recall?.stages[s.key]).at(-1)?.key;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <Header
        stats={stats}
        onLaunch={onLaunch}
        launching={launching}
        running={Boolean(runId) && !complete}
        connection={connectionStatus}
      />

      {!runId ? (
        <>
          <Intro />
          <FeedbackLoop />
        </>
      ) : (
        <>
          {recalls.length > 1 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {recalls.map((r) => {
                const sev = (r.stages.severity_classified?.severity ??
                  r.stages.cohort_identified?.severity) as Severity | undefined;
                const isActive = r.index === viewIndex;
                return (
                  <button
                    key={r.index}
                    onClick={() => setViewIndex(r.index)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      isActive
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                    }`}
                  >
                    {sev && (
                      <span
                        className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: SEVERITY_ACCENT[sev] }}
                      />
                    )}
                    Recall {r.index + 1}
                  </button>
                );
              })}
            </div>
          )}

          <Stepper stages={recall?.stages ?? {}} last={lastStage} accent={accent} />

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.45fr_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-slate-700">
                  National fan-out
                </h2>
                {cohort && (
                  <span className="text-xs text-slate-500">
                    {fmt(cohort.pharmacies)} pharmacies · {cohort.states} states
                  </span>
                )}
              </div>
              <UsMap
                base={basepoints}
                points={(cohort?.points ?? []) as MapPoint[]}
                byState={cohort?.byState ?? []}
                accent={accent}
              />
              {!cohort && (
                <p className="mt-2 text-center text-xs text-slate-400">
                  Waiting for cohort match…
                </p>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <FdaCard data={recall?.stages.fda_alert} />
              <SeverityCard data={recall?.stages.severity_classified} accent={accent} />
              <CohortCard data={cohort} accent={accent} />
              <DispatchCard data={recall?.stages.dispatched} />
            </div>
          </div>

          <PatientCard data={recall?.stages.card_rendered} />

          {recall?.recallNumber && recall.stages.cohort_identified && (
            <FeedbackLoop recallNumber={recall.recallNumber} />
          )}
        </>
      )}
    </div>
  );
}

function Header({
  stats,
  onLaunch,
  launching,
  running,
  connection,
}: {
  stats: GlobalStats;
  onLaunch: () => void;
  launching: boolean;
  running: boolean;
  connection: string;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight text-slate-900">
            SafetyConnect
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            autonomous drug-recall defense
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
          <Stat label="patients" value={fmt(stats.patients)} />
          <Stat label="pharmacies" value={fmt(stats.pharmacies)} />
          <Stat label="recalls indexed" value={fmt(stats.recalls)} />
          <Stat label="states" value={fmt(stats.states)} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-slate-400">
          {connection === "open"
            ? "● live"
            : running
              ? "○ connecting"
              : ""}
        </span>
        <button
          onClick={onLaunch}
          disabled={launching || running}
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Defense running…" : launching ? "Launching…" : "Launch live defense"}
        </button>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="font-semibold text-slate-900">{value}</span> {label}
    </span>
  );
}

function Intro() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <h1 className="text-xl font-semibold text-slate-800">
        Click “Launch live defense”
      </h1>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
        SafetyConnect pulls the latest FDA drug recalls, asks xAI Grok how
        dangerous each one is, matches it against a nationwide patient cohort in
        ClickHouse, and dispatches alerts — every step streamed live via Inngest.
      </p>
      <div className="mt-4 flex justify-center gap-2 text-xs text-slate-400">
        <Badge>Vercel</Badge>
        <Badge>Inngest</Badge>
        <Badge>xAI Grok</Badge>
        <Badge>ClickHouse</Badge>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-slate-200 px-2.5 py-1 font-medium">
      {children}
    </span>
  );
}

function Stepper({
  stages,
  last,
  accent,
}: {
  stages: Partial<Record<StageName, Record<string, unknown>>>;
  last?: StageName;
  accent: string;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-1.5">
      {STAGES.map((s, i) => {
        const done = Boolean(stages[s.key]);
        const isLast = s.key === last;
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <div
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                isLast
                  ? "border-transparent text-white"
                  : done
                    ? "border-slate-200 bg-white text-slate-700"
                    : "border-slate-100 bg-slate-50 text-slate-300"
              }`}
              style={isLast ? { background: accent } : undefined}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
                  done && !isLast ? "bg-slate-900 text-white" : ""
                } ${!done ? "bg-slate-200 text-slate-400" : ""}`}
                style={isLast ? { background: "rgba(255,255,255,.3)" } : undefined}
              >
                {done ? "✓" : i + 1}
              </span>
              {s.label}
            </div>
            {i < STAGES.length - 1 && (
              <span className="text-slate-200">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Card({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {accent && (
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: accent }}
          />
        )}
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function Waiting() {
  return <p className="text-xs text-slate-300">Waiting…</p>;
}

function FdaCard({ data }: { data?: Record<string, unknown> }) {
  if (!data) return <Card title="FDA recall"><Waiting /></Card>;
  const d = data as {
    recallingFirm: string;
    productNdc: string;
    reason: string;
    classification: string;
    sourceUrl: string;
  };
  return (
    <Card title="FDA recall">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">
          {d.recallingFirm}
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          {d.classification || "—"}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">NDC {d.productNdc}</div>
      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-600">
        {d.reason}
      </p>
      {d.sourceUrl && (
        <a
          href={d.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[11px] font-medium text-blue-600 hover:underline"
        >
          View on openFDA →
        </a>
      )}
    </Card>
  );
}

function SeverityCard({
  data,
  accent,
}: {
  data?: Record<string, unknown>;
  accent: string;
}) {
  if (!data)
    return (
      <Card title="How dangerous it is — xAI Grok">
        <Waiting />
      </Card>
    );
  const d = data as {
    severity: Severity;
    confidence: number;
    proba: Record<string, number>;
    rationale: string;
    model: string;
  };
  const order: Severity[] = ["Lethal", "Moderate", "Minor"];
  return (
    <Card title="How dangerous it is — xAI Grok" accent={accent}>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-lg font-bold" style={{ color: accent }}>
          {d.severity}
        </span>
        <span className="text-[11px] text-slate-400">
          {Math.round((d.confidence ?? 0) * 100)}% confidence
        </span>
      </div>
      <div className="space-y-1.5">
        {order.map((s) => {
          const v = d.proba?.[s] ?? 0;
          return (
            <div key={s} className="flex items-center gap-2">
              <span className="w-16 text-[11px] text-slate-500">{s}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.round(v * 100)}%`,
                    background: SEVERITY_ACCENT[s],
                  }}
                />
              </div>
              <span className="w-8 text-right text-[11px] tabular-nums text-slate-400">
                {Math.round(v * 100)}%
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs italic leading-relaxed text-slate-600">
        “{d.rationale}”
      </p>
      <div className="mt-1 text-[10px] text-slate-400">{d.model}</div>
    </Card>
  );
}

function CohortCard({
  data,
  accent,
}: {
  data?: { customers: number; pharmacies: number; states: number };
  accent: string;
}) {
  if (!data)
    return (
      <Card title="Who is affected">
        <Waiting />
      </Card>
    );
  return (
    <Card title="Who is affected" accent={accent}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric value={fmt(data.customers)} label="patients" accent={accent} />
        <Metric value={fmt(data.pharmacies)} label="pharmacies" />
        <Metric value={String(data.states)} label="states" />
      </div>
    </Card>
  );
}

function Metric({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent?: string;
}) {
  return (
    <div>
      <div
        className="text-xl font-bold tabular-nums"
        style={{ color: accent ?? "#0f172a" }}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
    </div>
  );
}

function DispatchCard({ data }: { data?: Record<string, unknown> }) {
  if (!data)
    return (
      <Card title="Coordinated dispatch">
        <Waiting />
      </Card>
    );
  const d = data as {
    dispatched: number;
    channel: string;
    pharmacies: number;
    providers: number;
    payers: number;
    payerNames: string[];
    demoAlert: { sent: boolean; channel: string; reason?: string };
  };
  return (
    <Card title="Coordinated dispatch">
      <p className="mb-2 text-[11px] leading-snug text-slate-500">
        Every affected patient&apos;s whole care network is notified — not just the
        patient.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <NetMetric value={fmt(d.dispatched)} label="patients alerted" />
        <NetMetric value={fmt(d.pharmacies)} label="pharmacies" />
        <NetMetric value={fmt(d.providers ?? 0)} label="care providers" />
        <NetMetric value={fmt(d.payers ?? 0)} label="insurers" />
      </div>
      {d.payerNames?.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {d.payerNames.map((p) => (
            <span
              key={p}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
            >
              {p}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-2 text-[11px] text-slate-500">
        Live demo alert:{" "}
        {d.demoAlert?.sent ? (
          <span className="font-medium text-emerald-600">
            sent via {d.demoAlert.channel} ✓
          </span>
        ) : (
          <span className="text-slate-400">
            {d.demoAlert?.reason ?? "simulated"}
          </span>
        )}
      </div>
    </Card>
  );
}

function NetMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
      <div className="text-base font-bold tabular-nums text-slate-900">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
    </div>
  );
}

function PatientCard({ data }: { data?: Record<string, unknown> }) {
  if (!data) return null;
  const card = (data as { card: PatientCardData }).card;
  if (!card) return null;
  return (
    <div className="mt-5">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">
        The alert a patient receives{" "}
        <span className="font-normal text-slate-400">
          — generated live by {card.generatedBy}
        </span>
      </h2>
      <div className="mx-auto max-w-xl">
        <div
          className="rounded-2xl border p-5 shadow-sm"
          style={{ background: card.theme.bg, borderColor: card.theme.accent }}
        >
          <span
            className="inline-block rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white"
            style={{ background: card.theme.accent }}
          >
            {card.theme.label}
          </span>
          <h3 className="mt-3 text-lg font-semibold text-slate-900">
            {card.headline}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {card.body}
          </p>
          <div className="mt-3 rounded-lg border border-black/5 bg-white/60 p-3">
            <div className="text-[11px] text-slate-400">Reason for recall</div>
            <div className="mt-0.5 text-xs leading-relaxed text-slate-600">
              {card.reason}
            </div>
          </div>
          <div
            className="mt-3 rounded-lg p-3 text-white"
            style={{ background: card.theme.accent }}
          >
            <div className="text-[10px] uppercase tracking-wide opacity-80">
              {card.actionTitle}
            </div>
            <div className="mt-0.5 text-sm font-semibold leading-snug">
              {card.action}
            </div>
          </div>
          <div className="mt-3 text-[10px] text-slate-400">{card.footer}</div>
        </div>
      </div>
    </div>
  );
}

interface PatientCardData {
  theme: { bg: string; accent: string; label: string };
  headline: string;
  body: string;
  reason: string;
  actionTitle: string;
  action: string;
  footer: string;
  generatedBy: string;
}
