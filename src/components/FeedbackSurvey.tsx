"use client";

import { useState } from "react";
import FeedbackForm from "./FeedbackForm";
import VoiceSurvey from "./VoiceSurvey";

interface Props {
  recallNumber: string;
  recallReason: string;
  recallingFirm: string;
  severity: string;
  sourceUrl: string;
  pharmacyId: string;
  state: string;
}

export default function FeedbackSurvey(props: Props) {
  const [mode, setMode] = useState<"voice" | "form">("voice");

  return (
    <div>
      <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setMode("voice")}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
            mode === "voice"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          🎙️ Talk to Grok
        </button>
        <button
          type="button"
          onClick={() => setMode("form")}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
            mode === "form"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          ✍️ Tap to answer
        </button>
      </div>

      {mode === "voice" ? (
        <VoiceSurvey {...props} />
      ) : (
        <FeedbackForm {...props} />
      )}
    </div>
  );
}
