/**
 * Phase 3 check: run xAI Grok severity classification + patient-card generation
 * on a few sample recall reasons. Works without a key (deterministic fallback);
 * with XAI_API_KEY set it shows real Grok rationales + generated copy.
 *
 *   npm run classify
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { classifySeverity } from "../src/lib/severity";
import { generatePatientCard } from "../src/lib/card";
import { isXaiConfigured } from "../src/lib/xai";

const SAMPLES = [
  {
    classification: "Class I",
    recalling_firm: "Acme Pharma",
    product_ndc: "12345-678",
    reason:
      "Product may be contaminated with a life-threatening bacterial pathogen (Burkholderia cepacia); use could result in serious infection or death in vulnerable patients.",
  },
  {
    classification: "Class III",
    recalling_firm: "Beta Labs",
    product_ndc: "55555-001",
    reason:
      "Label mix-up: carton declares the wrong tablet count. No health hazard expected.",
  },
  {
    classification: "Class II",
    recalling_firm: "Gamma Health",
    product_ndc: "99999-432",
    reason:
      "Out-of-specification dissolution results found during routine stability testing; may reduce effectiveness.",
  },
];

async function main() {
  console.log(`xAI configured: ${isXaiConfigured()}\n`);
  for (const s of SAMPLES) {
    const sev = await classifySeverity(s.reason, s.classification);
    console.log(`reason: ${s.reason.slice(0, 70)}...`);
    console.log(
      `  -> ${sev.severity}  conf=${sev.confidence}  proba=${JSON.stringify(sev.proba)}  [${sev.source}]`,
    );
    console.log(`  rationale: ${sev.rationale}`);

    const card = await generatePatientCard({
      recall_number: "DEMO-001",
      severity: sev.severity,
      product_ndc: s.product_ndc,
      recalling_firm: s.recalling_firm,
      reason_for_recall: s.reason,
    });
    console.log(`  card[${card.generatedBy}]: "${card.headline}" — ${card.body}`);
    console.log(`  action: ${card.action}\n`);
  }
}

main().catch((err) => {
  console.error("Classify check failed:", err);
  process.exit(1);
});
