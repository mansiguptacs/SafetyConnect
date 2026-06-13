"use client";

import { useState } from "react";
import { submitFeedback } from "@/app/actions";
import type { ProcessFeedbackResult } from "@/lib/feedback";
import FeedbackResult from "./FeedbackResult";

interface Props {
  recallNumber: string;
  recallReason: string;
  recallingFirm: string;
  severity: string;
  sourceUrl: string;
  pharmacyId: string;
  state: string;
}

const LAST_CONSUMED = [
  "This morning",
  "Yesterday",
  "2–3 days ago",
  "Last week",
  "Can't remember",
];

const DOSE = ["Less than prescribed", "As prescribed", "More than prescribed"];

const SYMPTOMS = [
  "Trouble breathing",
  "Chest pain or tightness",
  "Severe dizziness / fainting",
  "Rash or swelling",
  "Nausea or vomiting",
  "Headache",
  "Stomach pain",
  "No symptoms — I feel fine",
];

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
        active
          ? "border-sky-500 bg-sky-500 text-white shadow-sm"
          : "border-slate-300 bg-white text-slate-700 hover:border-sky-400 hover:bg-sky-50"
      }`}
    >
      {label}
    </button>
  );
}

export default function FeedbackForm(props: Props) {
  const [stillTaking, setStillTaking] = useState<boolean | null>(null);
  const [lastConsumed, setLastConsumed] = useState("");
  const [dose, setDose] = useState("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ProcessFeedbackResult | null>(null);

  const noSymptoms = "No symptoms — I feel fine";

  function toggleSymptom(s: string) {
    setSymptoms((prev) => {
      if (s === noSymptoms) return prev.includes(s) ? [] : [s];
      const cleaned = prev.filter((x) => x !== noSymptoms);
      return cleaned.includes(s)
        ? cleaned.filter((x) => x !== s)
        : [...cleaned, s];
    });
  }

  async function onSubmit() {
    setSubmitting(true);
    try {
      const picked = symptoms.filter((s) => s !== noSymptoms);
      const symptomsText = [picked.join(", "), notes.trim()]
        .filter(Boolean)
        .join(". ");
      const res = await submitFeedback({
        recallNumber: props.recallNumber,
        pharmacyId: props.pharmacyId,
        state: props.state,
        stillTaking: stillTaking ?? false,
        lastConsumed,
        doseAmount: dose,
        symptomsText,
        recallReason: props.recallReason,
        recallingFirm: props.recallingFirm,
      });
      setResult(res);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return <FeedbackResult result={result} />;
  }

  const canSubmit =
    stillTaking !== null && lastConsumed && dose && symptoms.length > 0 && !submitting;

  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Are you still taking this medication?
        </h3>
        <div className="flex gap-3">
          <Chip
            label="Yes, still taking it"
            active={stillTaking === true}
            onClick={() => setStillTaking(true)}
          />
          <Chip
            label="No, I stopped"
            active={stillTaking === false}
            onClick={() => setStillTaking(false)}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          When did you last take it?
        </h3>
        <div className="flex flex-wrap gap-3">
          {LAST_CONSUMED.map((o) => (
            <Chip
              key={o}
              label={o}
              active={lastConsumed === o}
              onClick={() => setLastConsumed(o)}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          How much have you been taking?
        </h3>
        <div className="flex flex-wrap gap-3">
          {DOSE.map((o) => (
            <Chip key={o} label={o} active={dose === o} onClick={() => setDose(o)} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          How are you feeling? (select all that apply)
        </h3>
        <div className="flex flex-wrap gap-3">
          {SYMPTOMS.map((o) => (
            <Chip
              key={o}
              label={o}
              active={symptoms.includes(o)}
              onClick={() => toggleSymptom(o)}
            />
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything else you'd like to add (optional)…"
          rows={3}
          className="mt-4 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-800 outline-none focus:border-sky-400"
        />
      </section>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={onSubmit}
        className="w-full rounded-xl bg-sky-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {submitting ? "Sending to your care team…" : "Submit my report"}
      </button>
    </div>
  );
}
