import OpenAI from "openai";

// xAI Grok is OpenAI-compatible: same SDK, different base URL + key.
// Used in Phase 3 for severity classification and patient-card generation.
export const xai = new OpenAI({
  apiKey: process.env.XAI_API_KEY ?? "",
  baseURL: "https://api.x.ai/v1",
});

export const XAI_MODEL = process.env.XAI_MODEL ?? "grok-4.3";

export function isXaiConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}
