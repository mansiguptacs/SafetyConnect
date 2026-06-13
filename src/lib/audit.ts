import { getClickHouse } from "./clickhouse";

const DB = process.env.CLICKHOUSE_DATABASE ?? "safetyconnect";

/** Append a grounded audit entry for a processed recall (replaces cited.md). */
export async function cite(
  recallNumber: string,
  severity: string,
  sourceUrl: string,
  summary: string,
): Promise<void> {
  await getClickHouse().insert({
    table: `${DB}.audit_log`,
    values: [
      {
        recall_number: recallNumber,
        severity,
        source_url: sourceUrl,
        summary,
      },
    ],
    format: "JSONEachRow",
  });
}
