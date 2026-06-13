import { Inngest } from "inngest";

// Central Inngest client. Realtime channels + publishing are wired in Phase 4.
export const inngest = new Inngest({ id: "safetyconnect" });
