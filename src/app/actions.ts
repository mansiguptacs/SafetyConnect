"use server";

import { randomUUID } from "node:crypto";
import { getSubscriptionToken } from "inngest/realtime";
import { inngest } from "@/inngest/client";
import { runChannel } from "@/inngest/channels";

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
