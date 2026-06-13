import type { Severity } from "./severity";

// Optional real-world alert to ONE demo recipient via Telegram, while the
// nationwide cohort dispatch stays simulated. A tangible stand-in for a Wireless
// Emergency Alert (real Amber Alerts go through FEMA IPAWS and can't be triggered
// by third parties). Safe no-op when unconfigured.

const SIREN = "\u{1F6A8}";
const SPEECH = "\u{1F4AC}";
const POINT = "\u{1F449}";

export function isAlertConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.TELEGRAM_CHAT_ID?.trim(),
  );
}

/** Escape the few characters Telegram's HTML parse mode cares about. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function surveyLink(recallNumber: string): string {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${appUrl}/feedback/${encodeURIComponent(recallNumber)}`;
}

/** Message 1: the urgent recall alert (no survey link — that's its own message). */
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
    `${SIREN} <b>SAFETYCONNECT ALERT</b> ${SIREN}\n` +
    `<b>${headline[severity] ?? headline.Minor}</b>\n` +
    `A medication you filled (NDC ${esc(productNdc)}, ${esc(recallingFirm)}) was ` +
    `recalled by the U.S. FDA. Do not take another dose — contact your pharmacy now.\n` +
    `Recall ${esc(recallNumber)}. Reply STOP to opt out.`
  ).slice(0, 1400);
}

/**
 * Message 2: the feedback ask. Explains plainly WHAT we want and HOW it helps the
 * patient, with a tappable link to their 30-second check-in.
 */
export function buildFeedbackMessage(recallNumber: string): string {
  const url = surveyLink(recallNumber);
  return (
    `${SPEECH} <b>One quick favor — how are you feeling?</b>\n` +
    `You may have already taken this medicine, so a 30-second check-in helps us keep you safe:\n` +
    `• If you're having a reaction, we get you to care <b>fast</b>.\n` +
    `• Your pharmacist is alerted to follow up with you personally.\n` +
    `• It tells the FDA how many people this recall really affected.\n` +
    `Your answers are private and confidential.\n\n` +
    `${POINT} Start my check-in (takes 30 seconds):\n` +
    // Show the URL as the visible link text so it's always present + copyable.
    // Telegram only makes it tappable for public URLs (localhost shows as text).
    `<a href="${url}">${esc(url)}</a>`
  ).slice(0, 1400);
}

export interface AlertResult {
  sent: boolean;
  channel: string;
  to?: string;
  reason?: string;
  feedbackSent?: boolean;
}

async function sendTelegram(
  token: string,
  chatId: string,
  text: string,
  surveyButtonUrl?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  // Inline buttons require a public http(s) URL — Telegram rejects localhost.
  if (surveyButtonUrl && /^https:\/\//.test(surveyButtonUrl)) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "Open my check-in", url: surveyButtonUrl }]],
    };
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await resp.json()) as { ok?: boolean; description?: string };
    if (resp.ok && json.ok) return { ok: true };
    return { ok: false, reason: `HTTP ${resp.status}: ${json.description ?? "unknown"}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/**
 * Send two real Telegram messages to the demo recipient: (1) the urgent recall
 * alert, then (2) a separate, clearly-explained feedback request with a tappable
 * check-in link. De-identified status only.
 */
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

  const alert = await sendTelegram(
    token,
    chatId,
    buildEmergencyMessage(severity, recallingFirm, productNdc, recallNumber),
  );
  if (!alert.ok) {
    return { sent: false, channel: "telegram", reason: alert.reason };
  }

  const feedback = await sendTelegram(
    token,
    chatId,
    buildFeedbackMessage(recallNumber),
    surveyLink(recallNumber),
  );

  return {
    sent: true,
    channel: "telegram",
    to: `chat ${chatId}`,
    feedbackSent: feedback.ok,
  };
}
