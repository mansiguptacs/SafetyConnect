import { getXai, XAI_MODEL, isXaiConfigured } from "./xai";

export type SymptomSeverity = "None" | "Mild" | "Moderate" | "Severe";
export const SYMPTOM_SEVERITIES: SymptomSeverity[] = [
  "None",
  "Mild",
  "Moderate",
  "Severe",
];

export interface FeedbackInput {
  stillTaking: boolean;
  lastConsumed: string;
  doseAmount: string;
  symptomsText: string;
  recallReason?: string;
  recallingFirm?: string;
}

export interface TriageResult {
  adverse: boolean;
  symptomSeverity: SymptomSeverity;
  action: string;
  rationale: string;
  priority: "urgent" | "routine";
  source: string;
}

function priorityFor(sev: SymptomSeverity, adverse: boolean): "urgent" | "routine" {
  if (sev === "Severe") return "urgent";
  if (sev === "Moderate" && adverse) return "urgent";
  return "routine";
}

function fallback(input: FeedbackInput, source: string): TriageResult {
  const text = input.symptomsText.trim();
  const adverse = text.length > 0;
  const sev: SymptomSeverity = adverse ? "Mild" : "None";
  return {
    adverse,
    symptomSeverity: sev,
    action: adverse
      ? "Record the report and let the pharmacy follow up as needed."
      : "No symptoms reported; record and stop using the recalled medication.",
    rationale: "Heuristic triage (xAI not available).",
    priority: priorityFor(sev, adverse),
    source,
  };
}

const SYSTEM_PROMPT =
  "You are a pharmacovigilance triage nurse. A patient who took a RECALLED " +
  "medication reports how they feel. Judge whether they describe an adverse " +
  "reaction and how severe it is. Severity: 'None' (no symptoms), 'Mild' " +
  "(minor, self-limiting), 'Moderate' (needs medical attention soon), 'Severe' " +
  "(emergency / could be life-threatening — e.g. trouble breathing, chest pain, " +
  "severe bleeding, fainting, anaphylaxis). Recommend a concrete next step. " +
  "Respond with STRICT JSON only.";

/** Triage a patient's symptom report with xAI Grok; deterministic fallback. */
export async function triageFeedback(input: FeedbackInput): Promise<TriageResult> {
  if (!isXaiConfigured()) return fallback(input, "heuristic_fallback");

  try {
    const resp = await getXai().chat.completions.create({
      model: XAI_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Recalled medication: ${input.recallingFirm ?? "unknown"}\n` +
            `Recall reason: ${input.recallReason ?? "unknown"}\n` +
            `Still taking it: ${input.stillTaking ? "yes" : "no"}\n` +
            `Last dose: ${input.lastConsumed || "unknown"}\n` +
            `Amount taken: ${input.doseAmount || "unknown"}\n` +
            `How they feel (their words): "${input.symptomsText || "(no symptoms reported)"}"\n\n` +
            "Return JSON with exactly these keys:\n" +
            '{ "adverse": boolean, ' +
            '"symptomSeverity": "None"|"Mild"|"Moderate"|"Severe", ' +
            '"action": "one concrete next step for the pharmacy/patient", ' +
            '"rationale": "one concise clinical sentence" }',
        },
      ],
    });

    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}") as {
      adverse?: boolean;
      symptomSeverity?: string;
      action?: string;
      rationale?: string;
    };

    const symptomSeverity = (
      SYMPTOM_SEVERITIES.includes(parsed.symptomSeverity as SymptomSeverity)
        ? parsed.symptomSeverity
        : "None"
    ) as SymptomSeverity;
    const adverse = Boolean(parsed.adverse) || symptomSeverity !== "None";

    return {
      adverse,
      symptomSeverity,
      action: parsed.action?.trim() || "Record the report.",
      rationale: parsed.rationale?.trim() || "No rationale provided.",
      priority: priorityFor(symptomSeverity, adverse),
      source: `xai:${XAI_MODEL}`,
    };
  } catch {
    return fallback(input, "xai_error_fallback");
  }
}
