import { inngest } from "./client";

// Placeholder function used to verify the Inngest dev server connection in Phase 0.
// Real ingestion + orchestration functions are added in Phases 2 and 4.
export const helloWorld = inngest.createFunction(
  { id: "hello-world", triggers: [{ event: "test/hello" }] },
  async ({ event, step }) => {
    const greeting = await step.run("greet", async () => {
      return `SafetyConnect online — received ${event.name}`;
    });
    return { ok: true, greeting };
  },
);

export const functions = [helloWorld];
