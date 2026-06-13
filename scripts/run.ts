/**
 * Phase 4 check: trigger the orchestration and capture its Realtime stream.
 * Requires the Next app + the Inngest dev server running.
 *
 *   npm run run-defense -- --limit 2 --hold 300
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import WebSocket from "ws";
// Node 18 has no global WebSocket (added in Node 21+); the browser uses its
// native one. Polyfill here so this CLI verification can subscribe.
const globalForWs = globalThis as unknown as { WebSocket?: unknown };
if (!globalForWs.WebSocket) globalForWs.WebSocket = WebSocket;

import { subscribe } from "inngest/realtime";
import { inngest } from "../src/inngest/client";
import { runChannel } from "../src/inngest/channels";

function arg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

async function main() {
  const runId = randomUUID();
  const limit = arg("--limit", 2);
  const holdMs = arg("--hold", 300);

  let resolveDone: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const sub = await subscribe({
    app: inngest,
    channel: runChannel(runId),
    topics: ["lifecycle", "stage"],
    onMessage: (msg) => {
      if (msg.topic === "lifecycle") {
        const d = msg.data as { type: string; recalls: number };
        console.log(`[lifecycle] ${d.type} (recalls=${d.recalls})`);
        if (d.type === "run_complete") resolveDone();
      } else if (msg.topic === "stage") {
        const d = msg.data as {
          stage: string;
          recallNumber: string;
          recallIndex: number;
          recallTotal: number;
          data: Record<string, unknown>;
        };
        let extra = "";
        if (d.stage === "severity_classified")
          extra = `-> ${d.data.severity} (conf ${d.data.confidence})`;
        else if (d.stage === "cohort_identified")
          extra = `-> ${d.data.customers} customers / ${d.data.pharmacies} pharmacies / ${d.data.states} states`;
        else if (d.stage === "dispatched")
          extra = `-> demoAlert=${JSON.stringify(d.data.demoAlert)}`;
        else if (d.stage === "card_rendered") {
          const card = d.data.card as { generatedBy: string; headline: string };
          extra = `-> [${card.generatedBy}] "${card.headline}"`;
        }
        console.log(
          `  [${String(d.stage).padEnd(20)}] ${d.recallNumber} (${d.recallIndex + 1}/${d.recallTotal}) ${extra}`,
        );
      }
    },
  });

  console.log(`Subscribed to run ${runId}. Sending run event (limit=${limit})...\n`);
  await inngest.send({
    name: "safetyconnect/run.requested",
    data: { runId, limit, holdMs },
  });

  const timeout = setTimeout(() => {
    console.error("\nTimed out waiting for run_complete (120s).");
    process.exit(1);
  }, 120_000);

  await done;
  clearTimeout(timeout);
  sub.close();
  console.log("\nRun complete. Phase 4 stream verified.");
  process.exit(0);
}

main().catch((err) => {
  console.error("run-defense check failed:", err);
  process.exit(1);
});
