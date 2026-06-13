import { getClickHouse } from "./clickhouse";

const DB = process.env.CLICKHOUSE_DATABASE ?? "safetyconnect";

async function rows<T>(
  query: string,
  query_params?: Record<string, unknown>,
): Promise<T[]> {
  const rs = await getClickHouse().query({
    query,
    query_params,
    format: "JSONEachRow",
  });
  return (await rs.json()) as T[];
}

export interface GlobalStats {
  patients: number;
  pharmacies: number;
  recalls: number;
  states: number;
}

/** Headline scale metrics for the dashboard header. */
export async function globalStats(): Promise<GlobalStats> {
  const [r] = await rows<{
    patients: string;
    pharmacies: string;
    recalls: string;
    states: string;
  }>(`
    SELECT
      (SELECT count() FROM ${DB}.patient_ehr) AS patients,
      (SELECT count() FROM ${DB}.pharmacies) AS pharmacies,
      (SELECT count(DISTINCT recall_number) FROM ${DB}.fda_recalls) AS recalls,
      (SELECT count(DISTINCT state) FROM ${DB}.pharmacies) AS states
  `);
  return {
    patients: Number(r?.patients ?? 0),
    pharmacies: Number(r?.pharmacies ?? 0),
    recalls: Number(r?.recalls ?? 0),
    states: Number(r?.states ?? 0),
  };
}

export interface MatchRecall {
  recall_number: string;
  product_ndc: string;
  reason_for_recall: string;
  classification: string;
  severity: string;
  severity_confidence: number;
  severity_rationale: string;
  recalling_firm: string;
  status: string;
  report_date: string;
  source_url: string;
  customers: number;
}

/**
 * Recalls whose product NDC actually appears in the patient cohort, ranked by
 * how many customers they reach. This is the candidate set the orchestrator
 * fans out across (and what the demo leads with).
 */
export async function listMatchRecalls(limit = 25): Promise<MatchRecall[]> {
  const data = await rows<MatchRecall & { customers: string }>(
    `
    SELECT
      r.recall_number       AS recall_number,
      r.product_ndc         AS product_ndc,
      any(r.reason_for_recall)   AS reason_for_recall,
      any(r.classification)      AS classification,
      any(r.severity)            AS severity,
      any(r.severity_confidence) AS severity_confidence,
      any(r.severity_rationale)  AS severity_rationale,
      any(r.recalling_firm)      AS recalling_firm,
      any(r.status)              AS status,
      any(r.report_date)         AS report_date,
      any(r.source_url)          AS source_url,
      count()                    AS customers
    FROM ${DB}.fda_recalls AS r
    INNER JOIN ${DB}.patient_ehr AS p
      ON r.product_ndc = p.prescribed_ndc_code
    GROUP BY r.recall_number, r.product_ndc
    ORDER BY customers DESC
    LIMIT {limit:UInt32}
  `,
    { limit },
  );
  return data.map((d) => ({
    ...d,
    severity_confidence: Number(d.severity_confidence ?? 0),
    customers: Number(d.customers ?? 0),
  }));
}

export interface CohortSummary {
  customers: number;
  pharmacies: number;
  states: number;
}

/** De-identified reach for a single recall (from the geo rollup, no PII). */
export async function cohortSummary(
  recallNumber: string,
): Promise<CohortSummary> {
  const [r] = await rows<{
    customers: string;
    pharmacies: string;
    states: string;
  }>(
    `
    SELECT
      countMerge(affected_customers)  AS customers,
      uniqMerge(affected_pharmacies)  AS pharmacies,
      count(DISTINCT state)           AS states
    FROM ${DB}.alert_geo_rollup
    WHERE recall_number = {recall:String}
  `,
    { recall: recallNumber },
  );
  return {
    customers: Number(r?.customers ?? 0),
    pharmacies: Number(r?.pharmacies ?? 0),
    states: Number(r?.states ?? 0),
  };
}

export interface StateRollup {
  state: string;
  customers: number;
  pharmacies: number;
}

/** Per-state breakdown for the map choropleth (no PII). */
export async function geoByState(recallNumber: string): Promise<StateRollup[]> {
  const data = await rows<{
    state: string;
    customers: string;
    pharmacies: string;
  }>(
    `
    SELECT
      state,
      countMerge(affected_customers) AS customers,
      uniqMerge(affected_pharmacies) AS pharmacies
    FROM ${DB}.alert_geo_rollup
    WHERE recall_number = {recall:String}
    GROUP BY state
    ORDER BY customers DESC
  `,
    { recall: recallNumber },
  );
  return data.map((d) => ({
    state: d.state,
    customers: Number(d.customers),
    pharmacies: Number(d.pharmacies),
  }));
}

export interface PharmacyPoint {
  pharmacy_id: string;
  lat: number;
  lon: number;
  state: string;
  state_name: string;
  customers: number;
}

/** Affected pharmacy coordinates for a recall (map highlight + sizing). */
export async function affectedPharmacyPoints(
  recallNumber: string,
  limit = 2000,
): Promise<PharmacyPoint[]> {
  const data = await rows<{
    pharmacy_id: string;
    lat: number;
    lon: number;
    state: string;
    state_name: string;
    customers: string;
  }>(
    `
    SELECT
      a.pharmacy_id   AS pharmacy_id,
      ph.lat          AS lat,
      ph.lon          AS lon,
      ph.state        AS state,
      ph.state_name   AS state_name,
      count()         AS customers
    FROM ${DB}.patient_alerts AS a
    INNER JOIN ${DB}.pharmacies AS ph ON a.pharmacy_id = ph.pharmacy_id
    WHERE a.recall_number = {recall:String}
    GROUP BY a.pharmacy_id, ph.lat, ph.lon, ph.state, ph.state_name
    ORDER BY customers DESC
    LIMIT {limit:UInt32}
  `,
    { recall: recallNumber, limit },
  );
  return data.map((d) => ({ ...d, customers: Number(d.customers) }));
}

export interface NetworkPoint {
  pharmacy_id: string;
  lat: number;
  lon: number;
  state: string;
  customers: number;
}

/** The full pharmacy network with per-pharmacy customer counts (base map). */
export async function pharmacyNetwork(): Promise<NetworkPoint[]> {
  const data = await rows<{
    pharmacy_id: string;
    lat: number;
    lon: number;
    state: string;
    customers: string;
  }>(`
    SELECT
      ph.pharmacy_id AS pharmacy_id,
      ph.lat         AS lat,
      ph.lon         AS lon,
      ph.state       AS state,
      count(p.customer_id) AS customers
    FROM ${DB}.pharmacies AS ph
    LEFT JOIN ${DB}.patient_ehr AS p ON ph.pharmacy_id = p.pharmacy_id
    GROUP BY ph.pharmacy_id, ph.lat, ph.lon, ph.state
  `);
  return data.map((d) => ({ ...d, customers: Number(d.customers) }));
}
