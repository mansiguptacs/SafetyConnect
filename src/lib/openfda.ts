// openFDA drug-enforcement (recall) ingestion. Replaces the old PyAirbyte
// declarative source with a direct, paginated fetch. Same shape: search by
// report_date window, page via skip/limit, flatten to one row per product NDC.

export const OPENFDA_ENFORCEMENT = "https://api.fda.gov/drug/enforcement.json";

// openFDA Class I/II/III -> our base severity. xAI refines this in Phase 3.
export const CLASSIFICATION_TO_SEVERITY: Record<string, string> = {
  "Class I": "Lethal",
  "Class II": "Moderate",
  "Class III": "Minor",
};

export interface RecallRow {
  recall_number: string;
  product_ndc: string;
  reason_for_recall: string;
  classification: string;
  severity: string;
  status: string;
  recalling_firm: string;
  distribution_pattern: string;
  report_date: string;
  source_url: string;
}

interface OpenFdaRecord {
  recall_number?: string;
  reason_for_recall?: string;
  classification?: string;
  status?: string;
  recalling_firm?: string;
  distribution_pattern?: string;
  report_date?: string;
  openfda?: { product_ndc?: string[] };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** One openFDA recall -> one RecallRow per product_ndc (drops NDC-less recalls). */
export function flatten(rec: OpenFdaRecord): RecallRow[] {
  const ndcs = rec.openfda?.product_ndc ?? [];
  if (ndcs.length === 0) return [];
  const classification = rec.classification ?? "";
  const severity = CLASSIFICATION_TO_SEVERITY[classification] ?? "Minor";
  const recall_number = rec.recall_number ?? "";
  const source_url = `${OPENFDA_ENFORCEMENT}?search=recall_number:${recall_number}`;
  return ndcs.map((ndc) => ({
    recall_number,
    product_ndc: ndc,
    reason_for_recall: rec.reason_for_recall ?? "",
    classification,
    severity,
    status: rec.status ?? "",
    recalling_firm: rec.recalling_firm ?? "",
    distribution_pattern: rec.distribution_pattern ?? "",
    report_date: rec.report_date ?? "",
    source_url,
  }));
}

export interface FetchOptions {
  lookbackDays?: number;
  maxRecords?: number;
}

/**
 * Fetch recent drug recalls from openFDA and flatten them. Paginates with
 * skip/limit; treats 404 (empty window) as "no records". Returns NDC-bearing
 * rows only.
 */
export async function fetchRecallRows(
  opts: FetchOptions = {},
): Promise<RecallRow[]> {
  const lookbackDays = opts.lookbackDays ?? 365;
  const maxRecords = opts.maxRecords ?? 2000;

  const end = new Date();
  const start = new Date(Date.now() - lookbackDays * 86_400_000);
  const pageSize = 1000;

  const rows: RecallRow[] = [];
  let fetched = 0;
  let skip = 0;

  while (fetched < maxRecords) {
    const url = new URL(OPENFDA_ENFORCEMENT);
    url.searchParams.set("search", `report_date:[${ymd(start)} TO ${ymd(end)}]`);
    url.searchParams.set("sort", "report_date:asc");
    url.searchParams.set("limit", String(Math.min(pageSize, maxRecords - fetched)));
    url.searchParams.set("skip", String(skip));
    const apiKey = process.env.OPENFDA_API_KEY?.trim();
    if (apiKey) url.searchParams.set("api_key", apiKey);

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 404) break; // openFDA: zero matches in window
    if (!res.ok) throw new Error(`openFDA request failed: ${res.status}`);

    const json = (await res.json()) as { results?: OpenFdaRecord[] };
    const results = json.results ?? [];
    if (results.length === 0) break;

    for (const rec of results) rows.push(...flatten(rec));
    fetched += results.length;
    skip += results.length;

    if (results.length < pageSize) break; // last page
    if (skip >= 25_000) break; // openFDA skip ceiling
  }

  return rows;
}
