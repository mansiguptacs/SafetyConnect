"use server";

import { randomUUID } from "node:crypto";
import { getSubscriptionToken } from "inngest/realtime";
import { inngest } from "@/inngest/client";
import { runChannel } from "@/inngest/channels";
import { processFeedback, type ProcessFeedbackResult } from "@/lib/feedback";
import {
  feedbackAggregate,
  feedbackAggregateGlobal,
  latestFeedbackGlobal,
  pharmacyTasks,
  pharmacyTasksGlobal,
  recentFeedback,
  type FeedbackAggregate,
  type FeedbackEntry,
  type NetworkFeedbackEntry,
  type PharmacyTask,
} from "@/lib/queries";

export interface LaunchResult {
  runId: string;
}

/** Kick off a live defense run; returns the runId the client subscribes to. */
export async function launchDefense(opts?: {
  limit?: number;
  holdMs?: number;
}): Promise<LaunchResult> {
  const runId = randomUUID();
  await inngest.send({
    name: "safetyconnect/run.requested",
    data: {
      runId,
      // Demo walks through ONE headline recall end-to-end (keep it simple).
      limit: opts?.limit ?? 1,
      holdMs: opts?.holdMs ?? 1600,
    },
  });
  return { runId };
}

export interface RealtimeToken {
  key: string;
  apiBaseUrl?: string;
}

/**
 * Mint a short-lived subscription token for this run's Realtime channel.
 * Returns only the serializable bits (key + apiBaseUrl) — the full token object
 * carries schema validator functions that can't cross the server→client boundary.
 */
export async function getRealtimeToken(runId: string): Promise<RealtimeToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: runChannel(runId),
    topics: ["lifecycle", "stage"],
  });
  return { key: token.key as string, apiBaseUrl: token.apiBaseUrl };
}

export interface SubmitFeedbackInput {
  recallNumber: string;
  pharmacyId: string;
  state: string;
  stillTaking: boolean;
  lastConsumed: string;
  doseAmount: string;
  symptomsText: string;
  recallReason?: string;
  recallingFirm?: string;
  channel?: "form" | "voice";
}

/**
 * Patient survey submit: Grok triages the report, it's persisted de-identified,
 * and adverse cases are routed to the pharmacy. Returns the triage outcome so
 * the patient immediately sees guidance.
 */
export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<ProcessFeedbackResult> {
  return processFeedback({ ...input, channel: input.channel ?? "form" });
}

export interface VoiceToken {
  value: string;
  expiresAt: number;
  model: string;
}

/**
 * Mint a short-lived xAI Realtime ephemeral token so the browser can open the
 * Grok voice WebSocket without ever seeing the real API key.
 */
export async function getVoiceToken(): Promise<VoiceToken> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY not configured");
  const model = process.env.XAI_VOICE_MODEL?.trim() || "grok-voice-latest";
  const resp = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ expires_after: { seconds: 600 }, model }),
  });
  if (!resp.ok) {
    throw new Error(`voice token request failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as { value: string; expires_at: number };
  return { value: json.value, expiresAt: json.expires_at, model };
}

export interface FeedbackLoop {
  aggregate: FeedbackAggregate;
  tasks: PharmacyTask[];
  recent: FeedbackEntry[];
  /** Recent check-ins across all recalls (each labeled with its recall_number). */
  network: NetworkFeedbackEntry[];
}

/** Live feedback-loop state for a recall (polled by the dashboard panel). */
export async function getFeedbackLoop(
  recallNumber: string,
): Promise<FeedbackLoop> {
  const [aggregate, tasks, recent, network] = await Promise.all([
    feedbackAggregate(recallNumber),
    pharmacyTasks(recallNumber, 8),
    recentFeedback(recallNumber, 8),
    latestFeedbackGlobal(8),
  ]);
  return { aggregate, tasks, recent, network };
}

/**
 * Network-wide feedback-loop state across ALL recalls — lets the dashboard show
 * live pharmacy-side activity even before a demo run is launched.
 */
export async function getGlobalFeedbackLoop(): Promise<FeedbackLoop> {
  const [aggregate, tasks, network] = await Promise.all([
    feedbackAggregateGlobal(),
    pharmacyTasksGlobal(8),
    latestFeedbackGlobal(8),
  ]);
  // In global mode the recent list IS the network list (each labeled by recall).
  return { aggregate, tasks, recent: [], network };
}
