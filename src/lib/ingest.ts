import { getClickHouse } from "./clickhouse";
import { fetchRecallRows, type FetchOptions, type RecallRow } from "./openfda";

const DB = process.env.CLICKHOUSE_DATABASE ?? "safetyconnect";

/** recall_numbers already in the warehouse (the incremental boundary). */
export async function existingRecallNumbers(): Promise<string[]> {
  const rs = await getClickHouse().query({
    query: `SELECT DISTINCT recall_number FROM ${DB}.fda_recalls`,
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as { recall_number: string }[];
  return rows.map((r) => r.recall_number);
}

/** Keep only rows whose recall hasn't been ingested yet. */
export function filterNewRows(
  rows: RecallRow[],
  existing: Iterable<string>,
): RecallRow[] {
  const seen = new Set(existing);
  return rows.filter((r) => !seen.has(r.recall_number));
}

/** Insert recall rows. Each insert fires mv_patient_matches -> patient_alerts. */
export async function insertRecalls(rows: RecallRow[]): Promise<void> {
  if (rows.length === 0) return;
  await getClickHouse().insert({
    table: `${DB}.fda_recalls`,
    values: rows,
    format: "JSONEachRow",
  });
}

export interface IngestSummary {
  fetchedRows: number;
  recalls: number;
  newRows: number;
  skipped: number;
}

/** Convenience: fetch -> filter new -> insert. Used by the CLI script. */
export async function ingestRecalls(
  opts: FetchOptions = {},
): Promise<IngestSummary> {
  const rows = await fetchRecallRows(opts);
  const existing = await existingRecallNumbers();
  const newRows = filterNewRows(rows, existing);
  await insertRecalls(newRows);
  return {
    fetchedRows: rows.length,
    recalls: new Set(rows.map((r) => r.recall_number)).size,
    newRows: newRows.length,
    skipped: rows.length - newRows.length,
  };
}
