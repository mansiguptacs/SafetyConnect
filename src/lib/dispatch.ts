import { cohortSummary } from "./queries";
import type { Severity } from "./severity";

/** Cohort-wide SMS copy (the message every matched patient would receive). */
export function buildMessage(
  severity: Severity,
  recallingFirm: string,
  productNdc: string,
): string {
  const urgency: Record<Severity, string> = {
    Lethal: "URGENT SAFETY RECALL — STOP USE IMMEDIATELY",
    Moderate: "Important medication recall notice",
    Minor: "Medication recall notification",
  };
  return (
    `${urgency[severity] ?? urgency.Minor}: A medication you filled ` +
    `(NDC ${productNdc}, ${recallingFirm}) has been recalled by the FDA. ` +
    `Please contact your pharmacy before taking another dose. Reply STOP to opt out.`
  );
}

export interface DispatchResult {
  channel: string;
  dispatched: number;
  pharmacies: number;
  states: number;
}

/**
 * Simulated nationwide dispatch. Resolves the de-identified cohort aggregates at
 * the data layer and "sends" — only counts leave the data layer, never PII.
 * (A real Twilio/Composio executor would slot in behind this same signature.)
 */
export async function dispatchToCohort(
  recallNumber: string,
): Promise<DispatchResult> {
  const summary = await cohortSummary(recallNumber);
  return {
    channel: "sms_simulated",
    dispatched: summary.customers,
    pharmacies: summary.pharmacies,
    states: summary.states,
  };
}
