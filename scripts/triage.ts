/**
 * Feedback F2 check: run Grok symptom triage on a few sample reports.
 *   npm run triage
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { triageFeedback } from "../src/lib/triage";

const SAMPLES = [
  {
    stillTaking: false,
    lastConsumed: "this morning",
    doseAmount: "2 tablets",
    symptomsText:
      "I've had really bad chest tightness and I feel short of breath since this afternoon.",
    recallReason: "Wrong-drug labeling: NSAID sold as a muscle relaxant.",
    recallingFirm: "Unichem",
  },
  {
    stillTaking: false,
    lastConsumed: "two days ago",
    doseAmount: "1 tablet",
    symptomsText: "Maybe a little nausea but honestly I feel mostly fine.",
    recallReason: "Wrong-drug labeling.",
    recallingFirm: "Unichem",
  },
  {
    stillTaking: false,
    lastConsumed: "last week",
    doseAmount: "1 tablet daily",
    symptomsText: "",
    recallReason: "Wrong-drug labeling.",
    recallingFirm: "Unichem",
  },
];

async function main() {
  for (const s of SAMPLES) {
    const t = await triageFeedback(s);
    console.log(`report: "${s.symptomsText || "(none)"}"`);
    console.log(
      `  -> ${t.symptomSeverity} | adverse=${t.adverse} | priority=${t.priority} [${t.source}]`,
    );
    console.log(`  action: ${t.action}`);
    console.log(`  rationale: ${t.rationale}\n`);
  }
}

main().catch((e) => {
  console.error("triage check failed:", e);
  process.exit(1);
});
