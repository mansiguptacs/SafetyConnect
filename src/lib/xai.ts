import OpenAI from "openai";

// xAI Grok is OpenAI-compatible: same SDK, different base URL + key.
// Lazily constructed so importing this module never throws when XAI_API_KEY is
// unset (callers guard with isXaiConfigured() and fall back deterministically).
let client: OpenAI | null = null;

export const XAI_MODEL = process.env.XAI_MODEL ?? "grok-4.3";

export function isXaiConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

export function getXai(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.XAI_API_KEY ?? "",
      baseURL: "https://api.x.ai/v1",
    });
  }
  return client;
}
