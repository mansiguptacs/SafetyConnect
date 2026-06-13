import { randomUUID } from "node:crypto";
import { getClickHouse } from "./clickhouse";
import { triageFeedback, type FeedbackInput, type TriageResult } from "./triage";
import { insurerFor, providerFor } from "./care";

const DB = process.env.CLICKHOUSE_DATABASE ?? "safetyconnect";

export interface ProcessFeedbackInput extends FeedbackInput {
  recallNumber: string;
  pharmacyId: string;
  state: string;
  channel?: "form" | "voice";
  patientRef?: string;
}

export interface ProcessFeedbackResult {
  feedbackId: string;
  patientRef: string;
  triage: TriageResult;
  taskId: string | null;
  notified: { provider: string; insurer: string };
}

/** Short pseudonymous patient token — never a real identity. */
function makePatientRef(): string {
  return "PT-" + randomUUID().slice(0, 4).toUpperCase();
}

function taskReason(triage: TriageResult): string {
  if (triage.symptomSeverity === "Severe") {
    return `URGENT: patient reports severe symptoms after a recalled drug. ${triage.action}`;
  }
  if (triage.symptomSeverity === "Moderate") {
    return `Patient reports moderate symptoms. ${triage.action}`;
  }
  return `Patient reports mild symptoms. ${triage.action}`;
}

/**
 * The closing feedback loop: Grok triages the patient's report, the report is
 * persisted (de-identified), and adverse cases are routed to the pharmacy as a
 * prioritized task. Returns the triage outcome so the patient sees guidance.
 */
export async function processFeedback(
  input: ProcessFeedbackInput,
): Promise<ProcessFeedbackResult> {
  const triage = await triageFeedback(input);
  const patientRef = input.patientRef || makePatientRef();
  const feedbackId = randomUUID();
  const ch = getClickHouse();

  // The patient's in-network care provider + insurer we loop in alongside the
  // pharmacy (deterministic per-person assignment, display only).
  const provider = providerFor(input.state, patientRef);
  const insurer = insurerFor(patientRef);

  await ch.insert({
    table: `${DB}.patient_feedback`,
    values: [
      {
        feedback_id: feedbackId,
        recall_number: input.recallNumber,
        patient_ref: patientRef,
        pharmacy_id: input.pharmacyId,
        state: input.state,
        channel: input.channel ?? "form",
        still_taking: input.stillTaking ? 1 : 0,
        last_consumed: input.lastConsumed,
        dose_amount: input.doseAmount,
        symptoms_text: input.symptomsText,
        adverse: triage.adverse ? 1 : 0,
        symptom_severity: triage.symptomSeverity,
        triage_action: triage.action,
        triage_rationale: triage.rationale,
      },
    ],
    format: "JSONEachRow",
  });

  // Only adverse reports become pharmacy tasks (avoid noise for "I'm fine").
  let taskId: string | null = null;
  if (triage.adverse) {
    taskId = randomUUID();
    const coordination =
      triage.priority === "urgent"
        ? ` ${provider} and ${insurer} notified to fast-track an urgent visit.`
        : ` ${provider} (in-network) looped in for follow-up.`;
    await ch.insert({
      table: `${DB}.pharmacy_tasks`,
      values: [
        {
          task_id: taskId,
          recall_number: input.recallNumber,
          pharmacy_id: input.pharmacyId,
          patient_ref: patientRef,
          state: input.state,
          priority: triage.priority,
          reason: taskReason(triage) + coordination,
          status: "open",
        },
      ],
      format: "JSONEachRow",
    });
  }

  return { feedbackId, patientRef, triage, taskId, notified: { provider, insurer } };
}
