/**
 * Phase 1 acceptance check: prove the materialized view fans a single recall
 * insert out into patient_alerts + the geo rollup, then exercise the TS query
 * module end-to-end. Inserts (and cleans up) a synthetic recall so it is safe
 * to re-run.
 *
 *   npm run db:verify
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { getClickHouse } from "../src/lib/clickhouse";
import {
  globalStats,
  listMatchRecalls,
  cohortSummary,
  geoByState,
  affectedPharmacyPoints,
} from "../src/lib/queries";

const DB = process.env.CLICKHOUSE_DATABASE ?? "safetyconnect";
const RECALL = "PHASE1-VERIFY";

async function main() {
  const ch = getClickHouse();

  // 1. Pick a real NDC that exists in the cohort so the join matches.
  const ndcRs = await ch.query({
    query: `
      SELECT prescribed_ndc_code AS ndc, count() AS c
      FROM ${DB}.patient_ehr
      GROUP BY ndc ORDER BY c DESC LIMIT 1`,
    format: "JSONEachRow",
  });
  const [{ ndc, c }] = (await ndcRs.json()) as { ndc: string; c: string }[];
  console.log(`Most-prescribed NDC: ${ndc} (${c} customers)`);

  // Clean any prior verify run so this is idempotent.
  await ch.command({
    query: `ALTER TABLE ${DB}.fda_recalls DELETE WHERE recall_number = {r:String}`,
    query_params: { r: RECALL },
  });
  await ch.command({
    query: `ALTER TABLE ${DB}.patient_alerts DELETE WHERE recall_number = {r:String}`,
    query_params: { r: RECALL },
  });
  // The geo rollup is an aggregate fed by a MV; source deletes don't propagate,
  // so clear it explicitly to keep re-runs idempotent. (The Phase 4 orchestrator
  // processes each recall once, so this only matters for repeated manual tests.)
  await ch.command({
    query: `ALTER TABLE ${DB}.alert_geo_rollup DELETE WHERE recall_number = {r:String}`,
    query_params: { r: RECALL },
  });

  // 2. Insert ONE recall -> mv_patient_matches fans it out automatically.
  await ch.insert({
    table: `${DB}.fda_recalls`,
    values: [
      {
        recall_number: RECALL,
        product_ndc: ndc,
        reason_for_recall: "Synthetic Phase 1 verification recall.",
        classification: "Class I",
        severity: "Lethal",
        severity_confidence: 0.95,
        severity_rationale: "Manual test row.",
        status: "Ongoing",
        recalling_firm: "Verify Labs",
        distribution_pattern: "Nationwide",
        report_date: "20260613",
        source_url: "https://api.fda.gov/drug/enforcement.json",
      },
    ],
    format: "JSONEachRow",
  });
  console.log(`Inserted recall ${RECALL} on NDC ${ndc}.`);

  // 3. Confirm the MV produced alerts.
  const alertRs = await ch.query({
    query: `SELECT count() AS c FROM ${DB}.patient_alerts WHERE recall_number = {r:String}`,
    query_params: { r: RECALL },
    format: "JSONEachRow",
  });
  const [{ c: alertCount }] = (await alertRs.json()) as { c: string }[];
  console.log(`patient_alerts fanned out by MV: ${alertCount}`);

  // 4. Exercise the query module.
  console.log("\n-- globalStats --");
  console.log(await globalStats());

  console.log("\n-- cohortSummary (geo rollup MV) --");
  console.log(await cohortSummary(RECALL));

  console.log("\n-- geoByState (top 5) --");
  console.log((await geoByState(RECALL)).slice(0, 5));

  console.log("\n-- affectedPharmacyPoints (top 3) --");
  console.log((await affectedPharmacyPoints(RECALL)).slice(0, 3));

  console.log("\n-- listMatchRecalls --");
  console.log(await listMatchRecalls(5));

  await ch.close();
  console.log("\nVerification complete.");
}

main().catch(async (err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
