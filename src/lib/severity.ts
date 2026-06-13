import { getXai, XAI_MODEL, isXaiConfigured } from "./xai";
import { CLASSIFICATION_TO_SEVERITY } from "./openfda";

export type Severity = "Lethal" | "Moderate" | "Minor";
export const SEVERITIES: Severity[] = ["Lethal", "Moderate", "Minor"];

export interface SeverityResult {
  severity: Severity;
  confidence: number; // 0..1
  proba: Record<Severity, number>; // distribution over the three labels
  rationale: string;
  source: string; // "xai:<model>" | "classification_fallback" | ...
}

function oneHot(sev: Severity): Record<Severity, number> {
  return {
    Lethal: sev === "Lethal" ? 1 : 0,
    Moderate: sev === "Moderate" ? 1 : 0,
    Minor: sev === "Minor" ? 1 : 0,
  };
}

function fallback(classification?: string, source = "classification_fallback"): SeverityResult {
  const sev = (CLASSIFICATION_TO_SEVERITY[classification ?? ""] ?? "Minor") as Severity;
  return {
    severity: sev,
    confidence: 0.5,
    proba: oneHot(sev),
    rationale: `Mapped from openFDA ${classification || "classification"} (no model rationale available).`,
    source,
  };
}

function normalizeProba(raw: unknown): Record<Severity, number> {
  const p = (raw ?? {}) as Record<string, unknown>;
  const vals = SEVERITIES.map((s) => Math.max(0, Number(p[s]) || 0));
  const sum = vals.reduce((a, b) => a + b, 0);
  const norm = sum > 0 ? vals.map((v) => v / sum) : [0, 0, 0];
  return {
    Lethal: Math.round(norm[0] * 1000) / 1000,
    Moderate: Math.round(norm[1] * 1000) / 1000,
    Minor: Math.round(norm[2] * 1000) / 1000,
  };
}

const SYSTEM_PROMPT =
  "You are a pharmacovigilance triage assistant. Given the FDA's free-text " +
  "reason for a drug recall, judge the danger to a patient still taking the " +
  "medication. Labels: 'Lethal' (life-threatening / could cause death or " +
  "serious irreversible harm — typically Class I), 'Moderate' (temporary or " +
  "reversible harm, medically reversible — typically Class II), 'Minor' " +
  "(unlikely to cause harm — typically Class III). Respond with STRICT JSON " +
  "only.";

/**
 * Classify a recall reason into Lethal / Moderate / Minor using xAI Grok, with
 * a probability distribution + a one-line rationale. Falls back to the openFDA
 * classification mapping when xAI is not configured or the call fails.
 */
export async function classifySeverity(
  reason: string,
  classification?: string,
): Promise<SeverityResult> {
  const text = (reason ?? "").trim();
  if (!isXaiConfigured() || text.length === 0) {
    return fallback(classification, isXaiConfigured() ? "empty_text_fallback" : "classification_fallback");
  }

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
            `openFDA classification (hint, may be wrong): ${classification || "unknown"}\n` +
            `Reason for recall: "${text}"\n\n` +
            "Return JSON with exactly these keys:\n" +
            '{ "severity": "Lethal"|"Moderate"|"Minor", ' +
            '"confidence": number 0..1, ' +
            '"proba": { "Lethal": number, "Moderate": number, "Minor": number } (sums ~1), ' +
            '"rationale": "one concise sentence a clinician would accept" }',
        },
      ],
    });

    const content = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as {
      severity?: string;
      confidence?: number;
      proba?: Record<string, number>;
      rationale?: string;
    };

    const severity = (SEVERITIES.includes(parsed.severity as Severity)
      ? parsed.severity
      : "Minor") as Severity;
    const proba = normalizeProba(parsed.proba);
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : proba[severity];

    return {
      severity,
      confidence: Math.round(confidence * 1000) / 1000,
      proba,
      rationale: parsed.rationale?.trim() || "No rationale provided.",
      source: `xai:${XAI_MODEL}`,
    };
  } catch (err) {
    const fb = fallback(classification, "xai_error_fallback");
    fb.rationale = `xAI call failed (${(err as Error).message}); used classification mapping.`;
    return fb;
  }
}
