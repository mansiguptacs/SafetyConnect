import { inngest } from "./client";
import { fetchRecallRows } from "@/lib/openfda";
import {
  existingRecallNumbers,
  filterNewRows,
  insertRecalls,
} from "@/lib/ingest";

interface IngestEventData {
  lookbackDays?: number;
  maxRecords?: number;
}

/**
 * Scheduled openFDA ingestion. Runs on a cron and can also be triggered on
 * demand via the `fda/ingest.requested` event. Durable steps: fetch -> diff
 * against the warehouse -> insert only new recalls (idempotent re-runs).
 */
export const ingestRecalls = inngest.createFunction(
  {
    id: "ingest-openfda-recalls",
    triggers: [{ cron: "0 */6 * * *" }, { event: "fda/ingest.requested" }],
  },
  async ({ event, step }) => {
    const data = (event?.data ?? {}) as IngestEventData;
    const lookbackDays = data.lookbackDays ?? 365;
    const maxRecords = data.maxRecords ?? 2000;

    const rows = await step.run("fetch-openfda", () =>
      fetchRecallRows({ lookbackDays, maxRecords }),
    );

    const existing = await step.run("load-existing", () =>
      existingRecallNumbers(),
    );

    const newRows = filterNewRows(rows, existing);

    await step.run("insert-new", () => insertRecalls(newRows));

    return {
      fetchedRows: rows.length,
      recalls: new Set(rows.map((r) => r.recall_number)).size,
      newRows: newRows.length,
      skipped: rows.length - newRows.length,
    };
  },
);
