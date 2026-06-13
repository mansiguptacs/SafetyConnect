import { getXai, XAI_MODEL, isXaiConfigured } from "./xai";
import type { Severity } from "./severity";

export interface SeverityTheme {
  bg: string;
  accent: string;
  label: string;
  action: string;
}

export const SEVERITY_THEME: Record<Severity, SeverityTheme> = {
  Lethal: {
    bg: "#fff5f5",
    accent: "#e5484d",
    label: "LETHAL RECALL · CLASS I",
    action:
      "Stop using this medication immediately and seek medical advice. Contact your pharmacy now.",
  },
  Moderate: {
    bg: "#fffaf0",
    accent: "#d97706",
    label: "MODERATE RECALL · CLASS II",
    action:
      "Stop taking this medication and contact your pharmacy for guidance before your next dose.",
  },
  Minor: {
    bg: "#eff6ff",
    accent: "#2563eb",
    label: "MINOR RECALL · CLASS III",
    action:
      "Please check with your pharmacy before taking your next dose of this medication.",
  },
};

export interface CardContext {
  recall_number: string;
  severity: Severity;
  product_ndc: string;
  recalling_firm: string;
  reason_for_recall: string;
}

/**
 * Structured, patient-facing alert card. Rendered by React with the severity
 * theme — no raw HTML from the model, so it's safe and on-brand.
 */
export interface PatientCard {
  severity: Severity;
  theme: SeverityTheme;
  headline: string;
  body: string; // one plain-language sentence
  reason: string; // FDA reason for recall (verbatim, trimmed)
  actionTitle: string;
  action: string;
  footer: string;
  generatedBy: string; // "xai:<model>" | "template_fallback"
}

function trimReason(reason: string, max = 320): string {
  const r = (reason ?? "").trim();
  return r.length > max ? `${r.slice(0, max - 1)}…` : r;
}

function fallbackCard(ctx: CardContext, generatedBy = "template_fallback"): PatientCard {
  const theme = SEVERITY_THEME[ctx.severity] ?? SEVERITY_THEME.Minor;
  return {
    severity: ctx.severity,
    theme,
    headline: "Your medication has been recalled",
    body: `A medication you filled — ${ctx.recalling_firm} (NDC ${ctx.product_ndc}) — has been recalled by the U.S. FDA.`,
    reason: trimReason(ctx.reason_for_recall),
    actionTitle: "WHAT YOU SHOULD DO",
    action: theme.action,
    footer: `Recall ${ctx.recall_number} · Source: U.S. FDA openFDA`,
    generatedBy,
  };
}

const SYSTEM_PROMPT =
  "You write short, calm, plain-language safety notifications that a PATIENT " +
  "receives about a drug recall (not an admin dashboard). No medical jargon, " +
  "no internal metrics. Respond with STRICT JSON only.";

/** Generate patient-facing card copy with xAI Grok; deterministic fallback otherwise. */
export async function generatePatientCard(ctx: CardContext): Promise<PatientCard> {
  const theme = SEVERITY_THEME[ctx.severity] ?? SEVERITY_THEME.Minor;
  if (!isXaiConfigured()) return fallbackCard(ctx);

  try {
    const resp = await getXai().chat.completions.create({
      model: XAI_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Severity: ${ctx.severity}\n` +
            `Recalling firm: ${ctx.recalling_firm}\n` +
            `Product NDC: ${ctx.product_ndc}\n` +
            `FDA reason for recall: "${ctx.reason_for_recall}"\n\n` +
            "Write the notification. Return JSON with exactly these keys:\n" +
            '{ "headline": "reassuring but clear, <= 8 words", ' +
            '"body": "one sentence naming the firm + NDC and that the FDA recalled it", ' +
            `"action": "what the patient should do now, consistent with ${ctx.severity} severity" }`,
        },
      ],
    });

    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}") as {
      headline?: string;
      body?: string;
      action?: string;
    };

    const base = fallbackCard(ctx, `xai:${XAI_MODEL}`);
    return {
      ...base,
      headline: parsed.headline?.trim() || base.headline,
      body: parsed.body?.trim() || base.body,
      action: parsed.action?.trim() || theme.action,
    };
  } catch {
    return fallbackCard(ctx, "template_fallback");
  }
}
