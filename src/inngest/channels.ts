import { channel, staticSchema } from "inngest/realtime";

export type StageName =
  | "fda_alert"
  | "ingested"
  | "severity_classified"
  | "cohort_identified"
  | "message_drafted"
  | "dispatched"
  | "card_rendered"
  | "cited";

export type StageMessage = {
  stage: StageName;
  recallNumber: string;
  recallIndex: number;
  recallTotal: number;
  data: Record<string, unknown>;
};

export type LifecycleMessage = {
  type: "run_started" | "run_complete";
  recalls: number;
};

// One channel per launch (scoped by runId) so each "live defense" is isolated.
// Two topics: lifecycle (run start/complete) and stage (the animated trace).
export const runChannel = channel({
  name: (runId: string) => `run:${runId}`,
  topics: {
    lifecycle: { schema: staticSchema<LifecycleMessage>() },
    stage: { schema: staticSchema<StageMessage>() },
  },
});
