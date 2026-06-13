-- SafetyConnect ClickHouse schema.
-- Ported from the original lakehouse design; database renamed to `safetyconnect`
-- and the recalls table carries xAI Grok severity fields (label + confidence +
-- rationale) instead of an ML model's output.

CREATE DATABASE IF NOT EXISTS safetyconnect;

-- ---------------------------------------------------------------------------
-- fda_recalls: one row per recalled product NDC. Fed by the Inngest cron
-- ingestion (Phase 2) and enriched with xAI severity (Phase 3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safetyconnect.fda_recalls
(
    recall_number        String,
    product_ndc          String,
    reason_for_recall    String,
    classification       String,            -- openFDA Class I / II / III
    severity             String,            -- xAI: Lethal / Moderate / Minor
    severity_confidence  Float64 DEFAULT 0, -- xAI confidence 0..1
    severity_rationale   String DEFAULT '', -- xAI one-line explanation
    status               String,
    recalling_firm       String,
    distribution_pattern String,
    report_date          String,            -- YYYYMMDD (openFDA format)
    source_url           String,
    ingested_at          DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (product_ndc, recall_number);

-- ---------------------------------------------------------------------------
-- pharmacies: static reference data (~5k rows), carries geography for the map.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safetyconnect.pharmacies
(
    pharmacy_id  String,
    name         String,
    chain        String,
    state        String,
    state_name   String,
    zip          String,
    lat          Float64,
    lon          Float64
)
ENGINE = MergeTree
ORDER BY pharmacy_id;

-- ---------------------------------------------------------------------------
-- patient_ehr: ~1M synthetic customer-prescription rows. Keyed by NDC so the
-- recall join is fast. PII stays here and in patient_alerts only; never in the UI.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safetyconnect.patient_ehr
(
    customer_id          String,
    name                 String,
    phone_number         String,
    pharmacy_id          String,
    state                String,
    prescribed_ndc_code  String
)
ENGINE = MergeTree
ORDER BY (prescribed_ndc_code, pharmacy_id);

-- ---------------------------------------------------------------------------
-- patient_alerts: target table fed by the materialized view whenever a recall
-- intersects a customer's prescription. The high-velocity automatic trigger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safetyconnect.patient_alerts
(
    recall_number     String,
    product_ndc       String,
    severity          String,
    customer_id       String,
    name              String,
    phone_number      String,
    pharmacy_id       String,
    state             String,
    reason_for_recall String,
    source_url        String,
    matched_at        DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (severity, state, recall_number);

-- ---------------------------------------------------------------------------
-- alert_geo_rollup: per-recall, per-state aggregate counts (NO PII). Powers the
-- live US map + scale metrics.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safetyconnect.alert_geo_rollup
(
    recall_number       String,
    severity            String,
    state               String,
    affected_customers  AggregateFunction(count, UInt64),
    affected_pharmacies AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (recall_number, severity, state);

-- ---------------------------------------------------------------------------
-- audit_log: grounded action trail (replaces the old cited.md file; ephemeral
-- serverless filesystems can't persist a file). One row per processed recall.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safetyconnect.audit_log
(
    recall_number String,
    severity      String,
    source_url    String,
    summary       String,
    ts            DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY ts;

-- ---------------------------------------------------------------------------
-- patient_feedback: first-person outcome reports gathered after the alert
-- (the closing feedback loop). De-identified: patient_ref is a pseudonymous
-- token, never a real identity. Grok triages symptom_severity + action.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safetyconnect.patient_feedback
(
    feedback_id      String,
    recall_number    String,
    patient_ref      String,            -- pseudonymous (e.g. PT-AB12)
    pharmacy_id      String,
    state            String,
    channel          String,            -- 'form' | 'voice'
    still_taking     UInt8,
    last_consumed    String,            -- freeform, e.g. "this morning"
    dose_amount      String,            -- freeform, e.g. "2 tablets"
    symptoms_text    String,
    adverse          UInt8,
    symptom_severity String,            -- None | Mild | Moderate | Severe
    triage_action    String,            -- recommended next step (Grok)
    triage_rationale String,
    created_at       DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (recall_number, created_at);

-- ---------------------------------------------------------------------------
-- pharmacy_tasks: actions routed to pharmacies from patient feedback. Severe
-- cases become 'urgent' (prioritize a primary-care visit); the rest 'routine'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safetyconnect.pharmacy_tasks
(
    task_id       String,
    recall_number String,
    pharmacy_id   String,
    patient_ref   String,
    state         String,
    priority      String,               -- urgent | routine
    reason        String,
    status        String DEFAULT 'open',
    created_at    DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (recall_number, created_at);

-- ---------------------------------------------------------------------------
-- mv_patient_matches: fires on every INSERT into fda_recalls. Joins the new
-- recall block against the full patient_ehr table on NDC and writes every
-- affected customer into patient_alerts. (An MV sees only the newly inserted
-- block of its FROM table, so each recall insert emits just that recall's matches.)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS safetyconnect.mv_patient_matches
TO safetyconnect.patient_alerts
AS
SELECT
    r.recall_number       AS recall_number,
    r.product_ndc         AS product_ndc,
    r.severity            AS severity,
    p.customer_id         AS customer_id,
    p.name                AS name,
    p.phone_number        AS phone_number,
    p.pharmacy_id         AS pharmacy_id,
    p.state               AS state,
    r.reason_for_recall   AS reason_for_recall,
    r.source_url          AS source_url,
    now()                 AS matched_at
FROM safetyconnect.fda_recalls AS r
INNER JOIN safetyconnect.patient_ehr AS p
    ON r.product_ndc = p.prescribed_ndc_code;

-- ---------------------------------------------------------------------------
-- mv_alert_geo_rollup: fires on inserts into patient_alerts and maintains
-- per-recall, per-state aggregates with NO PII.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS safetyconnect.mv_alert_geo_rollup
TO safetyconnect.alert_geo_rollup
AS
SELECT
    recall_number,
    severity,
    state,
    countState()           AS affected_customers,
    uniqState(pharmacy_id) AS affected_pharmacies
FROM safetyconnect.patient_alerts
GROUP BY recall_number, severity, state;
