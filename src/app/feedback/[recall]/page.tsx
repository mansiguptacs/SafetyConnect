import Link from "next/link";
import FeedbackSurvey from "@/components/FeedbackSurvey";
import { recallByNumber, sampleAffectedContext } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ recall: string }>;
}) {
  const { recall: recallParam } = await params;
  const recallNumber = decodeURIComponent(recallParam);

  const [recall, context] = await Promise.all([
    recallByNumber(recallNumber),
    sampleAffectedContext(recallNumber),
  ]);

  if (!recall) {
    return (
      <main className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">
          We couldn&apos;t find that recall
        </h1>
        <p className="mt-3 text-slate-600">
          The link may be out of date. Please contact your pharmacy.
        </p>
        <Link href="/" className="mt-6 inline-block text-sky-600 underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wider text-sky-600">
          SafetyConnect • Patient Check-in
        </div>
        <h1 className="text-3xl font-bold text-slate-900">
          A medication you received was recalled
        </h1>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-700">
              {recall.severity || recall.classification}
            </span>
            <span className="font-mono text-xs text-slate-400">
              {recall.recall_number}
            </span>
          </div>
          <p className="mt-3 text-slate-800">{recall.reason_for_recall}</p>
          <p className="mt-2 text-sm text-slate-500">
            Manufacturer: {recall.recalling_firm}
          </p>
          {recall.source_url && (
            <a
              href={recall.source_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-sky-600 underline"
            >
              View the official FDA notice
            </a>
          )}
        </div>

        <p className="mt-6 text-slate-600">
          This takes about 30 seconds and helps your pharmacy and the FDA keep
          you safe. Your answers are confidential.
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <FeedbackSurvey
            recallNumber={recall.recall_number}
            recallReason={recall.reason_for_recall}
            recallingFirm={recall.recalling_firm}
            severity={recall.severity}
            sourceUrl={recall.source_url}
            pharmacyId={context?.pharmacy_id ?? "UNKNOWN"}
            state={context?.state ?? "NA"}
          />
        </div>
      </div>
    </main>
  );
}
