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

export interface PharmacyLocation {
  lat: number;
  lon: number;
  state: string;
}

/** Fast coords-only pharmacy list for the base map layer (no patient join). */
export async function pharmacyLocations(): Promise<PharmacyLocation[]> {
  return rows<PharmacyLocation>(
    `SELECT lat, lon, state FROM ${DB}.pharmacies`,
  );
}

export interface RecallDetail {
  recall_number: string;
  product_ndc: string;
  reason_for_recall: string;
  classification: string;
  severity: string;
  recalling_firm: string;
  source_url: string;
}

/** Single recall's details (for the patient survey page). */
export async function recallByNumber(
  recallNumber: string,
): Promise<RecallDetail | null> {
  const [r] = await rows<RecallDetail>(
    `
    SELECT recall_number, product_ndc, reason_for_recall, classification,
           severity, recalling_firm, source_url
    FROM ${DB}.fda_recalls
    WHERE recall_number = {recall:String}
    LIMIT 1
  `,
    { recall: recallNumber },
  );
  return r ?? null;
}

export interface AffectedContext {
  pharmacy_id: string;
  state: string;
}

/**
 * Pick a representative affected pharmacy/state for a recall, used to attach a
 * demo patient's feedback. (No PII — only pharmacy + state.)
 */
export async function sampleAffectedContext(
  recallNumber: string,
): Promise<AffectedContext | null> {
  const [r] = await rows<AffectedContext>(
    `
    SELECT pharmacy_id, state
    FROM ${DB}.patient_alerts
    WHERE recall_number = {recall:String}
    ORDER BY rand()
    LIMIT 1
  `,
    { recall: recallNumber },
  );
  return r ?? null;
}

export interface FeedbackAggregate {
  total: number;
  adverse: number;
  adverseRate: number; // 0..1
  bySeverity: Record<"None" | "Mild" | "Moderate" | "Severe", number>;
}

/** Aggregated outcome feedback for a recall — the view the FDA acts on. */
export async function feedbackAggregate(
  recallNumber: string,
): Promise<FeedbackAggregate> {
  const data = await rows<{ symptom_severity: string; n: string; adverse: string }>(
    `
    SELECT symptom_severity, count() AS n, sum(adverse) AS adverse
    FROM ${DB}.patient_feedback
    WHERE recall_number = {recall:String}
    GROUP BY symptom_severity
  `,
    { recall: recallNumber },
  );
  const bySeverity = { None: 0, Mild: 0, Moderate: 0, Severe: 0 };
  let total = 0;
  let adverse = 0;
  for (const d of data) {
    const n = Number(d.n);
    total += n;
    adverse += Number(d.adverse);
    if (d.symptom_severity in bySeverity) {
      bySeverity[d.symptom_severity as keyof typeof bySeverity] = n;
    }
  }
  return {
    total,
    adverse,
    adverseRate: total > 0 ? adverse / total : 0,
    bySeverity,
  };
}

export interface FeedbackEntry {
  patient_ref: string;
  state: string;
  channel: string;
  symptom_severity: string;
  adverse: number;
  symptoms_text: string;
  last_consumed: string;
  dose_amount: string;
  created_at: string;
}

/** Recent de-identified feedback entries for a recall. */
export async function recentFeedback(
  recallNumber: string,
  limit = 20,
): Promise<FeedbackEntry[]> {
  const data = await rows<FeedbackEntry & { adverse: string }>(
    `
    SELECT patient_ref, state, channel, symptom_severity, adverse,
           symptoms_text, last_consumed, dose_amount,
           toString(created_at) AS created_at
    FROM ${DB}.patient_feedback
    WHERE recall_number = {recall:String}
    ORDER BY created_at DESC
    LIMIT {limit:UInt32}
  `,
    { recall: recallNumber, limit },
  );
  return data.map((d) => ({ ...d, adverse: Number(d.adverse) }));
}

export interface NetworkFeedbackEntry extends FeedbackEntry {
  recall_number: string;
}

/**
 * Most recent de-identified check-ins across ALL recalls — a network-wide view
 * so the demo never looks empty if a patient responds to a different recall than
 * the one currently on screen. Each entry carries its own recall_number.
 */
export async function latestFeedbackGlobal(
  limit = 8,
): Promise<NetworkFeedbackEntry[]> {
  const data = await rows<NetworkFeedbackEntry & { adverse: string }>(
    `
    SELECT recall_number, patient_ref, state, channel, symptom_severity, adverse,
           symptoms_text, last_consumed, dose_amount,
           toString(created_at) AS created_at
    FROM ${DB}.patient_feedback
    ORDER BY created_at DESC
    LIMIT {limit:UInt32}
  `,
    { limit },
  );
  return data.map((d) => ({ ...d, adverse: Number(d.adverse) }));
}

export interface PharmacyTask {
  task_id: string;
  pharmacy_id: string;
  patient_ref: string;
  state: string;
  priority: string;
  reason: string;
  status: string;
  created_at: string;
  recall_number?: string;
}

/** Pharmacy action queue for a recall (urgent first). */
export async function pharmacyTasks(
  recallNumber: string,
  limit = 20,
): Promise<PharmacyTask[]> {
  return rows<PharmacyTask>(
    `
    SELECT task_id, pharmacy_id, patient_ref, state, priority, reason, status,
           toString(created_at) AS created_at
    FROM ${DB}.pharmacy_tasks
    WHERE recall_number = {recall:String}
    ORDER BY priority = 'urgent' DESC, created_at DESC
    LIMIT {limit:UInt32}
  `,
    { recall: recallNumber, limit },
  );
}

/** Pharmacy action queue across ALL recalls (urgent first) — network-wide view. */
export async function pharmacyTasksGlobal(limit = 20): Promise<PharmacyTask[]> {
  return rows<PharmacyTask>(
    `
    SELECT task_id, recall_number, pharmacy_id, patient_ref, state, priority,
           reason, status, toString(created_at) AS created_at
    FROM ${DB}.pharmacy_tasks
    ORDER BY priority = 'urgent' DESC, created_at DESC
    LIMIT {limit:UInt32}
  `,
    { limit },
  );
}

/** Aggregated outcome feedback across ALL recalls — network-wide signal. */
export async function feedbackAggregateGlobal(): Promise<FeedbackAggregate> {
  const data = await rows<{ symptom_severity: string; n: string; adverse: string }>(
    `
    SELECT symptom_severity, count() AS n, sum(adverse) AS adverse
    FROM ${DB}.patient_feedback
    GROUP BY symptom_severity
  `,
  );
  const bySeverity = { None: 0, Mild: 0, Moderate: 0, Severe: 0 };
  let total = 0;
  let adverse = 0;
  for (const d of data) {
    const n = Number(d.n);
    total += n;
    adverse += Number(d.adverse);
    if (d.symptom_severity in bySeverity) {
      bySeverity[d.symptom_severity as keyof typeof bySeverity] = n;
    }
  }
  return {
    total,
    adverse,
    adverseRate: total > 0 ? adverse / total : 0,
    bySeverity,
  };
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
