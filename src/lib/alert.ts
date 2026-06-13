import type { Severity } from "./severity";

// Optional real-world alert to ONE demo recipient via Telegram, while the
// nationwide cohort dispatch stays simulated. A tangible stand-in for a Wireless
// Emergency Alert (real Amber Alerts go through FEMA IPAWS and can't be triggered
// by third parties). Safe no-op when unconfigured.

const SIREN = "\u{1F6A8}";

export function isAlertConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.TELEGRAM_CHAT_ID?.trim(),
  );
}

export function buildEmergencyMessage(
  severity: Severity,
  recallingFirm: string,
  productNdc: string,
  recallNumber: string,
): string {
  const headline: Record<Severity, string> = {
    Lethal: "LIFE-THREATENING DRUG RECALL",
    Moderate: "URGENT DRUG RECALL",
    Minor: "DRUG RECALL NOTICE",
  };
  return (
    `${SIREN} SAFETYCONNECT ALERT ${SIREN}\n` +
    `${headline[severity] ?? headline.Minor}\n` +
    `A medication you filled (NDC ${productNdc}, ${recallingFirm}) was recalled ` +
    `by the U.S. FDA. Do not take another dose — contact your pharmacy now.\n` +
    `Recall ${recallNumber}. Reply STOP to opt out.`
  ).slice(0, 1400);
}

export interface AlertResult {
  sent: boolean;
  channel: string;
  to?: string;
  reason?: string;
}

/** Send one real Telegram alert to the demo recipient. De-identified status. */
export async function sendDemoAlert(
  severity: Severity,
  recallingFirm: string,
  productNdc: string,
  recallNumber: string,
): Promise<AlertResult> {
  if (!isAlertConfigured()) {
    return { sent: false, channel: "telegram", reason: "not_configured" };
  }
  const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID!.trim();
  const body = buildEmergencyMessage(severity, recallingFirm, productNdc, recallNumber);

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: body }),
    });
    const json = (await resp.json()) as { ok?: boolean; description?: string };
    if (resp.ok && json.ok) {
      return { sent: true, channel: "telegram", to: `chat ${chatId}` };
    }
    return {
      sent: false,
      channel: "telegram",
      reason: `HTTP ${resp.status}: ${json.description ?? "unknown"}`,
    };
  } catch (err) {
    return { sent: false, channel: "telegram", reason: (err as Error).message };
  }
}
