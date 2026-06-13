/**
 * Feedback F3 end-to-end check: pick a real recall that reached patients, submit
 * two reports (a severe one + an "I'm fine" one), then read back the aggregate,
 * the pharmacy task queue, and recent feedback.
 *   npm run feedback-check
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { getClickHouse } from "../src/lib/clickhouse";
import {
  sampleAffectedContext,
  feedbackAggregate,
  pharmacyTasks,
  recentFeedback,
} from "../src/lib/queries";
import { processFeedback } from "../src/lib/feedback";

const DB = process.env.CLICKHOUSE_DATABASE ?? "safetyconnect";

async function pickRecall(): Promise<string | null> {
  const rs = await getClickHouse().query({
    query: `
      SELECT recall_number, count() AS n
      FROM ${DB}.patient_alerts
      GROUP BY recall_number
      ORDER BY n DESC
      LIMIT 1
    `,
    format: "JSONEachRow",
  });
  const [r] = (await rs.json()) as { recall_number: string }[];
  return r?.recall_number ?? null;
}

async function main() {
  const recallNumber = await pickRecall();
  if (!recallNumber) {
    console.error("No recall with patient_alerts found. Run the defense first.");
    process.exit(1);
  }
  const ctx = await sampleAffectedContext(recallNumber);
  console.log(`recall ${recallNumber} @ pharmacy ${ctx?.pharmacy_id} (${ctx?.state})\n`);

  const severe = await processFeedback({
    recallNumber,
    pharmacyId: ctx?.pharmacy_id ?? "UNKNOWN",
    state: ctx?.state ?? "NA",
    stillTaking: false,
    lastConsumed: "This morning",
    doseAmount: "As prescribed",
    symptomsText: "Chest pain or tightness, Trouble breathing",
  });
  console.log(
    `severe report -> ${severe.triage.symptomSeverity} | task=${severe.taskId ? severe.triage.priority : "none"}`,
  );

  const fine = await processFeedback({
    recallNumber,
    pharmacyId: ctx?.pharmacy_id ?? "UNKNOWN",
    state: ctx?.state ?? "NA",
    stillTaking: false,
    lastConsumed: "Last week",
    doseAmount: "As prescribed",
    symptomsText: "",
  });
  console.log(
    `fine report   -> ${fine.triage.symptomSeverity} | task=${fine.taskId ? fine.triage.priority : "none"}\n`,
  );

  const agg = await feedbackAggregate(recallNumber);
  console.log("aggregate:", JSON.stringify(agg));

  const tasks = await pharmacyTasks(recallNumber, 5);
  console.log(`\npharmacy tasks (${tasks.length}):`);
  for (const t of tasks) {
    console.log(`  [${t.priority}] ${t.patient_ref} @ ${t.pharmacy_id} — ${t.reason}`);
  }

  const recent = await recentFeedback(recallNumber, 5);
  console.log(`\nrecent feedback (${recent.length}):`);
  for (const f of recent) {
    console.log(`  ${f.patient_ref} (${f.state}) ${f.symptom_severity}: "${f.symptoms_text}"`);
  }
}

main().catch((e) => {
  console.error("feedback check failed:", e);
  process.exit(1);
});
